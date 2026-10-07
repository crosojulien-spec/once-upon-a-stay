import type { Database } from './db.ts';
import type { Hotel } from '../shared/types.ts';
import { dnaHash, loadHotelProfiles, type PreparedHotel } from './hotel-profiles.ts';

export async function seedHotels(db: Database) {
  return installHotelProfiles(db, await loadHotelProfiles());
}

export async function installHotelProfiles(db: Database, profiles: PreparedHotel[]) {
  const results: { id: string; action: 'created' | 'updated' | 'unchanged' | 'preserved' }[] = [];
  for (const profile of profiles) {
    const action = await db.transaction(async (tx) => {
      const existing = (
        await tx.query<{ data: Hotel }>('SELECT data FROM hotels WHERE id=$1 FOR UPDATE', [profile.hotel.id])
      ).rows[0]?.data;
      if (existing && dnaHash(existing.dna) === dnaHash(profile.hotel.dna)) return 'unchanged' as const;
      // Only replace the exact original unreviewed preparation. Never overwrite
      // operator text, attachments or a hotel-confirmed/reviewed profile on startup.
      if (
        existing &&
        (existing.reviewed ||
          existing.operationallyConfirmed ||
          existing.documents.length > 0 ||
          !profile.previousUnreviewedHashes.includes(dnaHash(existing.dna)))
      ) {
        return 'preserved' as const;
      }
      const hotel: Hotel = existing
        ? {
            ...existing,
            dna: profile.hotel.dna,
            sources: profile.hotel.sources,
            version: existing.version + 1,
            reviewed: false,
            operationallyConfirmed: false,
          }
        : profile.hotel;
      if (existing) {
        await tx.query('UPDATE hotels SET data=$2 WHERE id=$1', [hotel.id, JSON.stringify(hotel)]);
      } else {
        await tx.query('INSERT INTO hotels(id,data) VALUES($1,$2)', [hotel.id, JSON.stringify(hotel)]);
      }
      await tx.query('INSERT INTO dna_versions(hotel_id,version,data) VALUES($1,$2,$3)', [
        hotel.id,
        hotel.version,
        JSON.stringify(hotel),
      ]);
      return existing ? ('updated' as const) : ('created' as const);
    });
    results.push({ id: profile.hotel.id, action });
  }
  return results;
}
