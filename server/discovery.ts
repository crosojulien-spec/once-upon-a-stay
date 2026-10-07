import { z } from 'zod';
import type { DiscoveryState, Message } from '../shared/types.ts';
import { discoveryDomains } from '../shared/types.ts';

const coverageItem = z.object({
  status: z.enum(['unexplored', 'open', 'understood', 'unknown', 'indifferent', 'declined', 'not_relevant']),
  detail: z.string().max(240),
  sourceMessageIds: z.array(z.string().min(1)).max(4),
});
const coverageSchema = z.object(
  Object.fromEntries(discoveryDomains.map((domain) => [domain, coverageItem])) as Record<
    (typeof discoveryDomains)[number],
    typeof coverageItem
  >,
);

export const discoverySchema = z.object({
  coverage: coverageSchema,
  closing: z.object({
    basis: z.enum(['continue', 'sufficient', 'guest_finished', 'guest_short_on_time', 'guest_disengaging']),
    reason: z.string().max(240),
    sourceMessageIds: z.array(z.string().min(1)).max(4),
  }),
  threads: z
    .array(
      z.object({
        person: z.string().min(1).max(100),
        topic: z.string().min(1).max(80),
        status: z.enum(['open', 'understood', 'unknown', 'indifferent', 'declined']),
        detail: z.string().min(1).max(220),
        sourceMessageIds: z.array(z.string().min(1)).min(1).max(4),
      }),
    )
    .max(12),
  nextMove: z.enum([
    'answer',
    'clarify',
    'deepen',
    'include',
    'bridge',
    'closing_invitation',
    'close',
    'withdraw',
  ]),
  focus: z.string().max(180),
});

// References must exist in this stay's user messages. This checks provenance,
// not semantic truth: the transcript remains authoritative for both prompts.
export function groundedDiscovery(state: DiscoveryState, messages: Message[]): DiscoveryState {
  const userIds = new Set(messages.filter((m) => m.role === 'user').map((m) => m.id));
  return {
    ...state,
    ...(state.coverage
      ? {
          coverage: Object.fromEntries(
            discoveryDomains.map((domain) => {
              const item = state.coverage![domain];
              const valid = item.sourceMessageIds.filter((id) => userIds.has(id));
              const needsEvidence = ['understood', 'unknown', 'indifferent', 'declined'].includes(
                item.status,
              );
              return [
                domain,
                needsEvidence && (!valid.length || valid.length !== item.sourceMessageIds.length)
                  ? {
                      status: 'unexplored',
                      detail: 'No valid guest evidence retained.',
                      sourceMessageIds: [],
                    }
                  : { ...item, sourceMessageIds: valid },
              ];
            }),
          ) as NonNullable<DiscoveryState['coverage']>,
        }
      : {}),
    ...(state.closing
      ? {
          closing: {
            ...state.closing,
            sourceMessageIds: state.closing.sourceMessageIds.filter((id) => userIds.has(id)),
          },
        }
      : {}),
    threads: state.threads.filter(
      (thread) =>
        thread.sourceMessageIds.length > 0 && thread.sourceMessageIds.every((id) => userIds.has(id)),
    ),
  };
}

export function discoveryReady(state: DiscoveryState): boolean {
  return (
    (state.nextMove === 'closing_invitation' || state.nextMove === 'close') &&
    closureIssues(state).length === 0
  );
}

// Checks the declared coverage, not the truth of every interpretation. Guests can
// still finish at any time. Legacy state has no coverage-based gate.
export function closureIssues(state: DiscoveryState): string[] {
  if (!['closing_invitation', 'close'].includes(state.nextMove) || !state.coverage) return [];
  if (!state.closing || state.closing.basis === 'continue') return ['Closing has no declared basis.'];
  if (state.closing.basis !== 'sufficient') {
    return state.closing.sourceMessageIds.length ? [] : ['Guest-led ending needs guest evidence.'];
  }
  return discoveryDomains
    .filter((domain) => ['unexplored', 'open'].includes(state.coverage![domain].status))
    .map((domain) => `Discovery is not yet sufficient: ${domain}.`);
}
