import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Hotel, Source } from '../shared/types.ts';

export interface PreparedHotel {
  hotel: Hotel;
  previousUnreviewedHashes: string[];
}
export const dnaHash = (dna: string) =>
  createHash('sha256').update(dna.replace(/\r\n/g, '\n').trim()).digest('hex');

export async function loadHotelProfiles(): Promise<PreparedHotel[]> {
  const selection = JSON.parse(await readFile(resolve('data/hotel_selection.json'), 'utf8'));
  const release = JSON.parse(await readFile(resolve('data/dna/release.json'), 'utf8'));
  return Promise.all(
    selection.hotels.map(async (item: { id: string; name: string; city: string; country: string }) => {
      const profile = release.profiles[item.id];
      const dna = await readFile(resolve(profile.file), 'utf8');
      const sources: Source[] = [
        ...dna.matchAll(
          /^- ([A-Z]\d+) \| (public|historical|reported) \| \[([^\]]+)\]\((https:\/\/[^)]+)\) \| (.+)$/gm,
        ),
      ].map((m) => ({
        title: `${m[1]} · ${m[3]} — ${m[5]}`,
        url: m[4],
        checkedAt: release.checkedAt,
        status: m[2] as Source['status'],
      }));
      if (!sources.length || dna.length > 60000) throw new Error(`Invalid prepared DNA: ${item.id}`);
      return {
        previousUnreviewedHashes: profile.previousUnreviewedHashes,
        hotel: {
          id: item.id,
          name: item.name,
          city: item.city,
          country: item.country,
          dna,
          version: 1,
          sources,
          conciergeStatus:
            item.id === 'pavillon_reine_paris' || item.id === 'sukhothai_bangkok' ? 'present' : 'unknown',
          reviewed: false,
          operationallyConfirmed: false,
          documents: [],
        } as Hotel,
      };
    }),
  );
}
