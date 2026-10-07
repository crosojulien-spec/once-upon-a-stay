import { test } from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { openDatabase } from '../server/db.ts';
import { AiBudget, approvedModel } from '../server/ai-budget.ts';
import { makeProvider } from '../server/ai.ts';
import type { Config } from '../server/config.ts';
import type { GenerationInput } from '../shared/types.ts';
import { loadHotelProfiles } from '../server/hotel-profiles.ts';

test('Luna migration preserves settled and uncertain Sol entries and uses each call model rates', async () => {
  const db = await openDatabase(':memory:');
  try {
    const budget = await AiBudget.open(db, 5);
    await db.query(
      "INSERT INTO ai_calls(id,model,purpose,reserved_micro,accounted_micro) VALUES('settled','gpt-6.1-sol','chat',90000,30000),('pending','gpt-6.1-sol','chat',90000,NULL),('uncertain','gpt-6.1-sol','chat',90000,NULL)",
    );
    const id = await budget.reserve(approvedModel, 100, 200, 'chat');
    await budget.settle(id, { input_tokens: 100, output_tokens: 200 }, 'luna', 'default');
    await budget.settle('pending', { input_tokens: 100, output_tokens: 200 }, 'sol', 'default');
    const rows = (
      await db.query<{ id: string; accounted_micro: number | null; reserved_micro: number }>(
        'SELECT id,accounted_micro,reserved_micro FROM ai_calls',
      )
    ).rows;
    assert.equal(rows.find((r) => r.id === id)!.accounted_micro, 135);
    assert.equal(rows.find((r) => r.id === 'pending')!.accounted_micro, 2700);
    assert.equal(rows.find((r) => r.id === 'settled')!.accounted_micro, 30000);
    assert.equal(rows.find((r) => r.id === 'uncertain')!.accounted_micro, null);
    assert.equal(rows.find((r) => r.id === 'uncertain')!.reserved_micro, 90000);
    assert.equal((await budget.status()).uncertainCalls, 1);
    await assert.rejects(budget.reserve('gpt-6.1-sol', 100, 200, 'chat'));
  } finally {
    await db.close();
  }
});

test('trial budget reserves concurrent maximum costs and cannot refill on restart', async () => {
  const db = await openDatabase(':memory:');
  try {
    const budget = await AiBudget.open(db, 0.005);
    const calls = await Promise.allSettled(
      [0, 1, 2].map(() => budget.reserve(approvedModel, 0, 4000, 'chat')),
    );
    const accepted = calls.filter((c) => c.status === 'fulfilled');
    assert.equal(accepted.length, 2);
    assert.equal(calls.filter((c) => c.status === 'rejected').length, 1);
    const reserved = (await budget.status()).accountedUsd;
    assert.ok(reserved < 0.005 && reserved > 0.0045);
    await budget.settle(accepted[0].value, { input_tokens: 100, output_tokens: 200 }, 'fictional', 'default');
    const settled = await budget.status();
    assert.ok(settled.accountedUsd < reserved);
    await budget.settle(accepted[0].value, { input_tokens: 0, output_tokens: 0 }, 'fictional', 'default');
    assert.deepEqual(await budget.status(), settled);
    await budget.settle(accepted[1].value, undefined, undefined, undefined);
    assert.deepEqual(await budget.status(), settled);
    const restarted = await AiBudget.open(db, 5);
    assert.deepEqual(await restarted.status(), settled);
    assert.equal(settled.limitUsd, 0.005);
    assert.equal(settled.uncertainCalls, 1);
    await assert.rejects(budget.reserve('unapproved-model', 100, 4000, 'chat'));
    await assert.rejects(budget.reserve(approvedModel, 100001, 4000, 'chat'));
  } finally {
    await db.close();
  }
});

test('unexpected usage blocks further calls persistently', async () => {
  const db = await openDatabase(':memory:');
  try {
    const budget = await AiBudget.open(db, 5);
    const id = await budget.reserve(approvedModel, 10, 10, 'chat');
    await assert.rejects(
      budget.settle(id, { input_tokens: 10000, output_tokens: 10 }, 'fictional', 'default'),
    );
    assert.equal((await (await AiBudget.open(db, 5)).status()).blocked, true);
    await assert.rejects(budget.reserve(approvedModel, 10, 10, 'chat'), /budget/);
  } finally {
    await db.close();
  }
});

test('provider fails closed before dispatch and retains uncertain cost after network failure', async () => {
  const db = await openDatabase(':memory:');
  try {
    const config: Config = {
      port: 4312,
      host: '127.0.0.1',
      origin: 'http://127.0.0.1:4312',
      dataDir: ':memory:',
      secret: 'fictional-secret-for-provider-tests-only',
      production: false,
      aiMode: 'openai',
      apiKey: 'fictional-key',
      model: approvedModel,
      allowAiCalls: true,
      aiBudgetUsd: 0.009,
      emailMode: 'preview',
      allowEmail: false,
      smtpPort: 587,
      testRecipients: [],
      realStays: false,
      guestLinkDays: 7,
    };
    const hotel = (await loadHotelProfiles())[0].hotel;
    const input: GenerationInput = {
      hotel,
      messages: [],
      stay: {
        id: 'fictional-stay',
        hotelId: hotel.id,
        hotelName: hotel.name,
        email: 'fictional@example.invalid',
        demo: true,
        status: 'in_progress',
        briefStatus: 'none',
        dnaVersion: hotel.version,
        createdAt: '2026-10-05',
        updatedAt: '2026-10-05',
        expiresAt: '2026-10-12',
        revoked: false,
        facts: [],
        chatError: null,
        briefError: null,
        readyToFinish: false,
        selectedBriefId: null,
        revision: 1,
        guestName: 'Fictional Guest',
        arrival: '2026-11-10',
        departure: '2026-11-12',
        partySize: 2,
        reservationNotes: 'Fictional trial',
        handoff: 'reception',
      },
    };
    let generationCalls = 0;
    let preflightFails = true;
    const client = new OpenAI({
      apiKey: 'fictional-key',
      maxRetries: 0,
      fetch: async (url) => {
        if (String(url).endsWith('/input_tokens')) {
          if (preflightFails) throw new Error('Fictional preflight outage');
          return new Response(JSON.stringify({ object: 'response.input_tokens', input_tokens: 100 }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        generationCalls++;
        throw new Error('Fictional network outage after dispatch');
      },
    });
    const budget = await AiBudget.open(db, 0.009);
    const ai = makeProvider(config, budget, client);
    await assert.rejects(ai.chat(input));
    assert.equal(generationCalls, 0);
    assert.equal((await budget.status()).accountedUsd, 0);
    preflightFails = false;
    await assert.rejects(ai.chat(input));
    assert.equal(generationCalls, 1);
    assert.ok((await budget.status()).accountedUsd > 0);
    await ai.chat(input).catch(() => {});
    await assert.rejects(ai.chat(input), /budget/);
    assert.equal(generationCalls, 2);
    assert.equal((await budget.status()).uncertainCalls, 2);
    assert.throws(() => makeProvider(config), /budget/);
  } finally {
    await db.close();
  }
});
