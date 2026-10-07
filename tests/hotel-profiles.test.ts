import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.ts';
import { dnaHash, loadHotelProfiles } from '../server/hotel-profiles.ts';
import { installHotelProfiles } from '../server/seed.ts';
import type { Hotel } from '../shared/types.ts';

test('research refresh preserves edits, reviews, attachments, confirmation, versions and stay snapshots', async () => {
  const db = await openDatabase(':memory:');
  try {
    const profiles = await loadHotelProfiles();
    assert.equal(profiles.length, 6);
    for (const { hotel } of profiles) {
      assert.equal((hotel.dna.match(/^## \d+\./gm) || []).length, 11);
      assert.ok(hotel.sources.length >= 10);
      assert.ok(hotel.dna.length < 60000);
      assert.equal(hotel.reviewed, false);
      assert.equal(hotel.operationallyConfirmed, false);
    }
    const old = profiles.slice(1).map((p) => ({
      ...p,
      hotel: { ...p.hotel, dna: `Original preparation for ${p.hotel.id}` },
    }));
    await installHotelProfiles(db, old);
    const untouched = old[0].hotel;
    await db.query(
      'INSERT INTO stays(id,hotel_id,data,token_hash,token_cipher,hotel_snapshot) VALUES($1,$2,$3,$4,$5,$6)',
      [
        'fictional-stay',
        untouched.id,
        '{}',
        'fictional-token-hash',
        'fictional-cipher',
        JSON.stringify(untouched),
      ],
    );
    const protectedHotels = [
      { ...old[1].hotel, dna: 'Operator correction' },
      { ...old[2].hotel, reviewed: true },
      { ...old[3].hotel, documents: [{ id: 'manual', name: 'Hotel note', text: 'Operator attachment' }] },
      { ...old[4].hotel, operationallyConfirmed: true },
    ];
    for (const hotel of protectedHotels) {
      await db.query('UPDATE hotels SET data=$2 WHERE id=$1', [hotel.id, JSON.stringify(hotel)]);
    }
    const release = profiles.map((p) => ({
      ...p,
      previousUnreviewedHashes: old.filter((o) => o.hotel.id === p.hotel.id).map((o) => dnaHash(o.hotel.dna)),
    }));
    const results = await installHotelProfiles(db, release);
    assert.equal(results.filter((r) => r.action === 'created').length, 1);
    assert.equal(results.filter((r) => r.action === 'updated').length, 1);
    assert.equal(results.filter((r) => r.action === 'preserved').length, 4);
    const versions = (
      await db.query<{ data: Hotel }>('SELECT data FROM dna_versions WHERE hotel_id=$1 ORDER BY version', [
        untouched.id,
      ])
    ).rows;
    assert.equal(versions.length, 2);
    assert.equal(versions[0].data.dna, untouched.dna);
    assert.equal(versions[1].data.version, 2);
    const snapshot = (
      await db.query<{ hotel_snapshot: Hotel }>('SELECT hotel_snapshot FROM stays WHERE id=$1', [
        'fictional-stay',
      ])
    ).rows[0];
    assert.deepEqual(snapshot.hotel_snapshot, untouched);
    for (const hotel of protectedHotels) {
      const saved = (await db.query<{ data: Hotel }>('SELECT data FROM hotels WHERE id=$1', [hotel.id]))
        .rows[0].data;
      assert.deepEqual(saved, hotel);
    }
    const again = await installHotelProfiles(db, release);
    assert.equal(again.filter((r) => r.action === 'unchanged').length, 2);
    assert.equal(again.filter((r) => r.action === 'updated').length, 0);
  } finally {
    await db.close();
  }
});
