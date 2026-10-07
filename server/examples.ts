import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CanopiaService } from './service.ts';
import type { Brief, GenerationInput } from '../shared/types.ts';
import { assert } from './security.ts';

export const exampleIds = ['family-anniversary', 'prague-anniversary', 'work-and-running'] as const;
export async function loadExample(service: CanopiaService, id: string) {
  assert(exampleIds.includes(id as (typeof exampleIds)[number]), 404, 'Example not found.');
  const saved = JSON.parse(await readFile(`examples/${id}/case.json`, 'utf8')) as {
    input: GenerationInput;
    baseline: Brief;
  };
  const original = saved.input.stay;
  const stay = await service.createStay({
    hotelId: original.hotelId,
    guestName: original.guestName,
    email: '',
    arrival: original.arrival,
    departure: original.departure,
    partySize: original.partySize,
    reservationNotes: original.reservationNotes,
    handoff: original.handoff,
    demo: true,
  });
  const ids = new Map(saved.input.messages.map((m) => [m.id, randomUUID()]));
  // Keep provenance references internally consistent while making every import independent.
  const remap = (value: unknown): unknown =>
    typeof value === 'string'
      ? (ids.get(value) ?? value)
      : Array.isArray(value)
        ? value.map(remap)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]))
          : value;
  await service.db.transaction(async (tx) => {
    await tx.query('DELETE FROM messages WHERE stay_id=$1', [stay.id]);
    for (const m of saved.input.messages) {
      const message = { ...m, id: ids.get(m.id)! };
      await tx.query('INSERT INTO messages(id,stay_id,data) VALUES($1,$2,$3)', [
        message.id,
        stay.id,
        JSON.stringify(message),
      ]);
    }
    await tx.query('UPDATE stays SET hotel_snapshot=$2 WHERE id=$1', [
      stay.id,
      JSON.stringify(saved.input.hotel),
    ]);
    await service.patch(tx, stay.id, {
      status: 'completed',
      facts: remap(original.facts) as typeof original.facts,
      discovery: remap(original.discovery) as typeof original.discovery,
      dnaVersion: saved.input.hotel.version,
    });
  });
  const brief = await service.recordBrief(stay.id, saved.baseline.text, 'normal', 'recorded-example');
  if (brief) {
    const data = {
      ...brief,
      model: saved.baseline.model,
      promptVersion: saved.baseline.promptVersion,
      provenance: { exampleId: id, recordedOn: '2026-10-06', originalBriefId: saved.baseline.id },
    };
    await service.db.query('UPDATE briefs SET data=$2 WHERE id=$1', [brief.id, JSON.stringify(data)]);
  }
  return service.detail(stay.id);
}
