import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveryReady, groundedDiscovery, closureIssues } from '../server/discovery.ts';
import type { DiscoveryState, Message } from '../shared/types.ts';
import { discoveryDomains } from '../shared/types.ts';

test('unexplored tastes block host-led closure but never an evidenced guest-led ending', () => {
  const coverage = Object.fromEntries(
    discoveryDomains.map((domain) => [
      domain,
      {
        status: 'understood',
        detail: 'Explicit guest answer',
        sourceMessageIds: ['u1'],
      },
    ]),
  ) as NonNullable<DiscoveryState['coverage']>;
  coverage.snacks = { status: 'unexplored', detail: 'Not asked', sourceMessageIds: [] };
  const state: DiscoveryState = {
    threads: [],
    coverage,
    nextMove: 'closing_invitation',
    focus: '',
    closing: { basis: 'sufficient', reason: 'Enough', sourceMessageIds: [] },
  };
  assert.equal(discoveryReady(state), false);
  assert.match(closureIssues(state)[0], /snacks/);
  state.coverage!.snacks = { status: 'indifferent', detail: 'No preference', sourceMessageIds: ['u1'] };
  assert.equal(discoveryReady(state), true);
  state.coverage!.snacks.status = 'unexplored';
  state.closing = { basis: 'guest_short_on_time', reason: 'Meeting starts', sourceMessageIds: ['u1'] };
  assert.equal(discoveryReady(state), true);
  const grounded = groundedDiscovery(state, []);
  assert.equal(grounded.coverage!.food_and_drink.status, 'unexplored');
  assert.equal(discoveryReady(grounded), false);
});

test('a late substantive clarification removes readiness; uncertainty is not a compulsory question', () => {
  const state: DiscoveryState = { threads: [], nextMove: 'closing_invitation', focus: '' };
  assert.equal(discoveryReady(state), true);
  assert.equal(discoveryReady({ ...state, nextMove: 'clarify' }), false);
  assert.equal(discoveryReady({ ...state, nextMove: 'withdraw' }), false);
  assert.equal(
    discoveryReady({
      ...state,
      nextMove: 'close',
      threads: [
        {
          person: 'Companion',
          topic: 'Pillows',
          status: 'unknown',
          detail: 'Speaker does not know.',
          sourceMessageIds: ['u1'],
        },
      ],
    }),
    true,
  );
});

test('working topics cannot cite host suggestions, another stay or a mixture of valid and invalid evidence', () => {
  const messages: Message[] = [
    { id: 'u1', role: 'user', content: 'No flowers, please.', createdAt: '' },
    { id: 'a1', role: 'assistant', content: 'Would a note be welcome?', createdAt: '' },
  ];
  const base = { person: 'Guest', topic: 'Flowers', status: 'declined' as const, detail: 'No flowers.' };
  const state: DiscoveryState = {
    threads: [
      { ...base, sourceMessageIds: ['u1'] },
      { ...base, sourceMessageIds: ['a1'] },
      { ...base, sourceMessageIds: ['other-stay'] },
      { ...base, sourceMessageIds: ['u1', 'other-stay'] },
      { ...base, sourceMessageIds: [] },
    ],
    nextMove: 'bridge',
    focus: 'Exploring the city',
  };
  assert.deepEqual(groundedDiscovery(state, messages).threads, [state.threads[0]]);
  assert.equal(state.threads.length, 5);
});
