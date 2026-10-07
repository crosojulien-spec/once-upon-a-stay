import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import OpenAI from 'openai';
import { openDatabase, type Database } from '../server/db.ts';
import { seedHotels } from '../server/seed.ts';
import { CanopiaService } from '../server/service.ts';
import { createApp } from '../server/app.ts';
import { makeProvider, SimulationProvider, withdrawalNotice } from '../server/ai.ts';
import { AiBudget, approvedModel } from '../server/ai-budget.ts';
import { AppError } from '../server/security.ts';
import type { Config } from '../server/config.ts';
import type { ChatResult, GenerationInput } from '../shared/types.ts';
import { discoveryDomains } from '../shared/types.ts';

const config: Config = {
  port: 4312,
  host: '127.0.0.1',
  origin: 'http://127.0.0.1:4312',
  dataDir: ':memory:',
  secret: 'fictional-test-secret-never-for-production-123',
  production: false,
  aiMode: 'simulation',
  allowAiCalls: false,
  emailMode: 'preview',
  allowEmail: false,
  smtpPort: 587,
  testRecipients: [],
  realStays: false,
  guestLinkDays: 7,
};
class ObservedProvider extends SimulationProvider {
  inputs: GenerationInput[] = [];
  fail = false;
  nextChat: ChatResult | undefined;
  holdBrief: (() => Promise<void>) | undefined;
  override async chat(input: GenerationInput) {
    this.inputs.push(input);
    if (this.fail) throw new AppError(503, 'Fictional outage.');
    if (this.nextChat) {
      const response = this.nextChat;
      this.nextChat = undefined;
      return response;
    }
    return super.chat(input);
  }
  override async brief(input: GenerationInput) {
    this.inputs.push(input);
    if (this.holdBrief) await this.holdBrief();
    if (this.fail) throw new AppError(503, 'Fictional outage.');
    return super.brief(input);
  }
}
let db: Database,
  service: CanopiaService,
  app: ReturnType<typeof createApp>,
  ai: ObservedProvider,
  cookie: string;
before(async () => {
  db = await openDatabase(':memory:');
  await seedHotels(db);
  ai = new ObservedProvider();
  service = new CanopiaService(db, config, ai);
  app = createApp(service);
});
after(async () => {
  await service.idle();
  await db.close();
});
function call(method: 'get' | 'post' | 'put' | 'delete', path: string, authenticated = true) {
  const req = request(app)[method](path).set('Host', '127.0.0.1:4312').set('Origin', config.origin);
  if (authenticated && cookie) req.set('Cookie', cookie);
  return req;
}
async function stay(hotelId = 'sukhothai_bangkok') {
  const s = await service.createStay({
    hotelId,
    guestName: `Fictional Guest ${randomUUID().slice(0, 4)}`,
    email: 'fake@example.invalid',
    arrival: '2026-11-10',
    departure: '2026-11-13',
    partySize: 2,
    reservationNotes: 'Internal reservation reference XYZ; not a guest API field.',
    handoff: hotelId === 'sukhothai_bangkok' ? 'concierge' : 'reception',
    demo: true,
  });
  return { s, token: (await service.guestLink(s.id)).split('/g/')[1] };
}
test('operator authentication, origin checks and secret-free runtime', async () => {
  await call('get', '/api/stays', false).expect(401);
  const setup = await call('post', '/api/auth/setup', false)
    .send({ email: 'test@example.invalid', password: 'Fictional test password 123' })
    .expect(200);
  cookie = setup.headers['set-cookie'][0].split(';')[0];
  assert.match(setup.headers['set-cookie'][0], /HttpOnly/);
  await request(app)
    .post('/api/stays')
    .set('Host', '127.0.0.1:4312')
    .set('Origin', 'https://untrusted.example')
    .set('Cookie', cookie)
    .send({})
    .expect(403);
  await call('post', '/api/auth/setup')
    .send({ email: 'other@example.invalid', password: 'Another fake password' })
    .expect(409);
  const hotels = await call('get', '/api/hotels').expect(200);
  assert.equal(hotels.body.length, 6);
  const runtime = await call('get', '/api/runtime').expect(200);
  assert.equal(runtime.body.emailEnabled, false);
  assert.equal(runtime.body.realStaysEnabled, false);
  assert.ok(!JSON.stringify(runtime.body).includes(config.secret));
});
test('hotel isolation, immutable DNA and supporting documents in both AI inputs', async () => {
  const a = await stay(),
    b = await stay('golden_well_prague');
  const old = await service.hotel(a.s.hotelId);
  const updated = await service.saveHotel(
    old.id,
    {
      dna: old.dna + '\nNew source test.',
      conciergeStatus: old.conciergeStatus,
      reviewed: true,
      documents: [{ id: 'source', name: 'Test source.txt', text: 'Fictional added capability.' }],
    },
    old.version,
  );
  const c = await stay();
  await service.chat(a.token, 'I enjoy quiet mornings.', randomUUID());
  await service.chat(b.token, 'A theatre weekend.', randomUUID());
  await service.chat(c.token, 'I like thoughtful walks.', randomUUID());
  const inputA = ai.inputs.find((i) => i.stay.id === a.s.id)!;
  assert.equal(inputA.hotel.version, old.version);
  assert.equal(inputA.hotel.documents.length, 0);
  const inputB = ai.inputs.find((i) => i.stay.id === b.s.id)!;
  assert.equal(inputB.hotel.id, 'golden_well_prague');
  assert.ok(!inputB.messages.some((m) => m.content === 'I enjoy quiet mornings.'));
  const inputC = ai.inputs.find((i) => i.stay.id === c.s.id)!;
  assert.equal(inputC.hotel.version, updated.version);
  assert.equal(inputC.hotel.documents[0].text, 'Fictional added capability.');
  await service.finish(c.token);
  await service.idle();
  assert.equal(ai.inputs.at(-1)!.hotel.version, updated.version);
  await assert.rejects(
    service.saveHotel(
      old.id,
      { dna: old.dna, conciergeStatus: old.conciergeStatus, reviewed: false, documents: [] },
      old.version,
    ),
    /another window/,
  );
  const guest = await call('get', `/api/guest/${a.token}`, false).expect(200);
  assert.equal(guest.body.hotelName, a.s.hotelName);
  for (const hidden of [
    'email',
    'reservationNotes',
    'token_cipher',
    'token_hash',
    'facts',
    'briefs',
    'hotel_snapshot',
    'dna',
  ])
    assert.equal(guest.body[hidden], undefined);
  await call('get', '/api/guest/bad-token', false).expect(404);
  await service.revoke(a.s.id);
  await call('get', `/api/guest/${a.token}`, false).expect(410);
  await service.db.transaction((tx) => service.patch(tx, b.s.id, { expiresAt: '2020-01-01T00:00:00.000Z' }));
  await call('get', `/api/guest/${b.token}`, false).expect(410);
});
test('saved messages survive provider failure; retries and duplicate requests do not duplicate content', async () => {
  const { s, token } = await stay(),
    clientId = randomUUID();
  ai.fail = true;
  const failed = await service.chat(token, 'A quiet room, please.', clientId);
  assert.equal(failed.chatError, 'Fictional outage.');
  await assert.rejects(service.finish(token), /unanswered/);
  ai.fail = false;
  await service.chat(token, 'A quiet room, please.', clientId);
  assert.equal((await service.messages(s.id)).filter((m) => m.role === 'user').length, 1);
  await service.chat(token, undefined, undefined);
  assert.equal((await service.guest(token)).chatError, null);
  assert.equal((await service.messages(s.id)).filter((m) => m.role === 'user').length, 1);
  await assert.rejects(
    service.chat(token, 'Changed message after a network retry', clientId),
    /already saved/,
  );
  await assert.rejects(service.chat(token, undefined, undefined), /no unanswered/);
  assert.equal((await service.guest(token)).chatError, null);
});
test('recorded example is explicit, readable and preserves model provenance', async () => {
  const response = await call('post', '/api/examples/work-and-running').send({}).expect(201);
  assert.equal(response.body.stay.demo, true);
  assert.ok(response.body.messages.some((m: { role: string }) => m.role === 'user'));
  assert.equal(response.body.briefs[0].source, 'recorded-example');
  assert.equal(response.body.briefs[0].promptVersion, 'brief-v4.2');
  assert.equal(response.body.briefs[0].provenance.exampleId, 'work-and-running');
});
test('automatic brief, saved human revisions, regeneration and export of selected version', async () => {
  const { s, token } = await stay();
  await service.chat(token, 'Please keep breakfast late.', randomUUID());
  await service.finish(token);
  await service.idle();
  const first = (await service.detail(s.id)).briefs[0];
  assert.equal(first.version, 1);
  assert.equal(first.source, 'simulation');
  const edited = await service.saveBrief(
    s.id,
    first.id,
    first.text + '\nHuman correction: confirm breakfast timing.',
    first.revision,
  );
  await assert.rejects(
    service.saveBrief(s.id, first.id, 'Stale editor overwrite', first.revision),
    /another window/,
  );
  await service.generate(s.id, true);
  await service.idle();
  const detail = await service.detail(s.id);
  assert.equal(detail.briefs.length, 2);
  assert.equal(detail.briefs[1].text, edited.text);
  assert.equal(detail.briefs[1].generatedText, first.text);
  await assert.rejects(service.exportBrief(s.id, first.id), /Select/);
  await service.selectBrief(s.id, first.id);
  assert.equal((await service.exportBrief(s.id, first.id)).text, edited.text);
  const response = await call('get', `/api/stays/${s.id}/briefs/${first.id}/export`).expect(200);
  assert.equal(response.text, edited.text);
  assert.match(response.headers['content-disposition'], /attachment/);
  await service.stop(token);
  const stopped = await service.detail(s.id);
  assert.equal(stopped.briefs.length, 3);
  assert.equal(stopped.briefs[0].kind, 'minimal');
  assert.ok(stopped.briefs[0].text.startsWith(withdrawalNotice));
  await assert.rejects(service.selectBrief(s.id, first.id), /declined/);
  await assert.rejects(service.generate(s.id, true), /completed/);
});
test('refusal produces minimal collected record even when AI extraction failed', async () => {
  const { s, token } = await stay();
  ai.fail = true;
  await service.chat(
    token,
    'I prefer a quiet room. Please do not use this to personalize my stay.',
    randomUUID(),
  );
  ai.fail = false;
  await service.stop(token);
  const d = await service.detail(s.id);
  const brief = d.briefs[0];
  assert.equal(d.stay.status, 'stopped');
  assert.equal(brief.source, 'minimal-record');
  assert.match(brief.text, /I prefer a quiet room/);
  assert.ok(brief.text.startsWith(withdrawalNotice));
  assert.match(brief.text, /No experience suggestions or research requests/);
  const edit = await service.saveBrief(s.id, brief.id, 'Only a human note.', brief.revision);
  assert.ok(edit.text.startsWith(withdrawalNotice));
  await service.stop(token);
  assert.equal((await service.detail(s.id)).briefs.length, 1);
});
test('late generation cannot restore personalization after refusal or deletion', async () => {
  const { s, token } = await stay();
  await service.chat(token, 'A calm stay.', randomUUID());
  let release!: () => void;
  ai.holdBrief = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  await service.finish(token);
  while (!release) await new Promise((r) => setTimeout(r, 5));
  await service.stop(token);
  release();
  await service.idle();
  let d = await service.detail(s.id);
  assert.equal(d.stay.status, 'stopped');
  assert.equal(d.briefs.length, 1);
  assert.equal(d.briefs[0].kind, 'minimal');
  ai.holdBrief = undefined;
  const other = await stay();
  await service.chat(other.token, 'A short break.', randomUUID());
  release = undefined!;
  ai.holdBrief = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  await service.finish(other.token);
  while (!release) await new Promise((r) => setTimeout(r, 5));
  await service.deleteStay(other.s.id);
  release();
  await service.idle();
  ai.holdBrief = undefined;
  await assert.rejects(service.detail(other.s.id), /not found/);
});
test('invitations remain previews and interrupted jobs have actionable status after restart', async () => {
  const { s, token } = await stay();
  await service.invitation(s.id, 'Your stay', 'A fictional invitation preview.');
  await call('post', `/api/stays/${s.id}/invitation/send`).send({}).expect(409);
  let d = await service.detail(s.id);
  assert.equal(d.invitations[0].status, 'preview');
  assert.equal(d.stay.status, 'draft');
  await db.query('UPDATE stays SET chat_busy=true WHERE id=$1', [s.id]);
  await service.recover();
  assert.match((await service.guest(token)).chatError!, /restarted/);
  await service.db.transaction((tx) =>
    service.patch(tx, s.id, { status: 'completed', briefStatus: 'generating' }),
  );
  await db.query('UPDATE invitations SET data=$2 WHERE stay_id=$1', [
    s.id,
    JSON.stringify({ ...d.invitations[0], status: 'sending' }),
  ]);
  await service.recover();
  d = await service.detail(s.id);
  assert.equal(d.stay.briefStatus, 'failed');
  assert.equal(d.invitations[0].status, 'unknown');
  await assert.rejects(service.invitation(s.id, 'Retry', 'Retry body'), /confirmation/);
});

test('discovery survives turns and reaches the brief, corrections replace it, and guest output stays private', async () => {
  const { s, token } = await stay();
  const first = await service.chat(
    token,
    'We are celebrating; a private note would be lovely.',
    randomUUID(),
  );
  const userId = first.messages.find((m) => m.role === 'user')!.id;
  ai.nextChat = {
    reply: 'Would you like to add or correct anything before finishing?',
    readyToFinish: false,
    stopRequested: false,
    facts: [
      {
        label: 'Attention',
        value: 'Private note welcome',
        sourceMessageId: userId,
        sourceQuote: 'a private note would be lovely',
      },
    ],
    discovery: {
      nextMove: 'closing_invitation',
      focus: 'Final additions',
      threads: [
        {
          person: 'Guest',
          topic: 'Personal attention',
          status: 'understood',
          detail: 'Private note welcome.',
          sourceMessageIds: [userId],
        },
      ],
    },
  };
  const closing = await service.chat(token, 'We have no other plans.', randomUUID());
  assert.equal(closing.readyToFinish, true);
  assert.ok(!('discovery' in closing));
  const firstState = (await service.detail(s.id)).stay.discovery;
  assert.equal(firstState?.threads[0].detail, 'Private note welcome.');
  ai.nextChat = {
    reply: 'Of course, no note or surprise.',
    readyToFinish: false,
    stopRequested: false,
    facts: [],
    discovery: { nextMove: 'close', focus: 'Correction acknowledged', threads: [] },
  };
  await service.chat(token, 'Actually, no note or surprise please.', randomUUID());
  assert.deepEqual(ai.inputs.at(-1)!.stay.discovery, firstState);
  const corrected = await service.detail(s.id);
  assert.deepEqual(corrected.stay.discovery?.threads, []);
  assert.deepEqual(corrected.stay.facts, []);
  await service.finish(token);
  await service.idle();
  assert.equal(ai.inputs.at(-1)!.stay.discovery?.nextMove, 'close');
  assert.equal((await service.detail(s.id)).stay.briefStatus, 'ready');
});

test('real adapter contract passes prior discovery, grounds output and derives closure or withdrawal without network', async () => {
  const { s } = await stay();
  const input = await service.input(s.id);
  input.messages = [
    { id: 'host-message', role: 'assistant', content: 'Any flower preferences?', createdAt: '' },
    {
      id: 'guest-message',
      role: 'user',
      content: 'No flowers, please. I need to finish now.',
      createdAt: '',
    },
  ];
  input.stay.discovery = { threads: [], nextMove: 'bridge', focus: 'Comfort' };
  const thread = {
    person: 'Guest',
    topic: 'Flowers',
    status: 'declined',
    detail: 'No flowers.',
    sourceMessageIds: ['guest-message'],
  };
  let move = 'closing_invitation';
  let repairMode = false;
  let generations = 0;
  const client = new OpenAI({
    apiKey: 'fictional-key',
    maxRetries: 0,
    fetch: async (url, init) => {
      const requestBody = JSON.parse(String(init?.body));
      const context = JSON.parse(requestBody.input);
      assert.deepEqual(context.previousDiscovery, input.stay.discovery);
      assert.deepEqual(context.retainedFacts, input.stay.facts);
      assert.ok(!('email' in context.reservation));
      assert.equal(requestBody.model, 'gpt-6-luna');
      assert.equal(requestBody.reasoning.effort, 'medium');
      assert.match(requestBody.instructions, /Snacks and small pleasures/);
      assert.match(requestBody.instructions, /ILLUSTRATIVE DISCOVERY MOVES/);
      assert.deepEqual(requestBody.text.format.schema.$defs.guest_source_id.enum, ['guest-message']);
      assert.equal(
        requestBody.text.format.schema.properties.facts.items.properties.sourceMessageId.$ref,
        '#/$defs/guest_source_id',
      );
      if (!String(url).endsWith('/input_tokens')) generations++;
      if (repairMode && generations === 1) move = 'closing_invitation';
      if (repairMode && generations >= 2) {
        assert.match(requestBody.instructions, /APPLICATION CHECK/);
        move = 'bridge';
      }
      const value = String(url).endsWith('/input_tokens')
        ? { object: 'response.input_tokens', input_tokens: 100 }
        : {
            object: 'response',
            status: 'completed',
            service_tier: 'default',
            usage: { input_tokens: 100, output_tokens: 100 },
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      reply: 'Thank you.',
                      stopRequested: false,
                      facts: [
                        {
                          label: 'Flowers',
                          value: 'No flowers',
                          sourceMessageId: 'guest-message',
                          sourceQuote: 'No flowers',
                        },
                      ],
                      discovery: {
                        coverage: Object.fromEntries(
                          discoveryDomains.map((domain) => [
                            domain,
                            { status: 'unexplored', detail: '', sourceMessageIds: [] },
                          ]),
                        ),
                        closing: {
                          basis: repairMode ? 'sufficient' : 'guest_finished',
                          reason: repairMode ? 'Enough' : 'Guest needs to finish',
                          sourceMessageIds: ['guest-message'],
                        },
                        threads: [thread, { ...thread, sourceMessageIds: ['other-stay'] }],
                        nextMove: move,
                        focus: '',
                      },
                    }),
                  },
                ],
              },
            ],
          };
      return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    },
  });
  const provider = makeProvider(
    { ...config, aiMode: 'openai', apiKey: 'fictional-key', model: approvedModel, allowAiCalls: true },
    await AiBudget.open(db, 0.2),
    client,
  );
  const closing = await provider.chat(input);
  assert.equal(closing.readyToFinish, true);
  assert.equal(closing.discovery?.threads.length, 1);
  assert.equal(closing.facts.length, 1);
  move = 'clarify';
  assert.equal((await provider.chat(input)).readyToFinish, false);
  move = 'withdraw';
  const withdrawal = await provider.chat(input);
  assert.equal(withdrawal.stopRequested, true);
  assert.equal(withdrawal.readyToFinish, false);
  repairMode = true;
  generations = 0;
  const repaired = await provider.chat(input);
  assert.equal(generations, 2);
  assert.equal(repaired.discovery?.nextMove, 'bridge');
  assert.equal(repaired.readyToFinish, false);
});
