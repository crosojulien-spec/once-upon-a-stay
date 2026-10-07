import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDatabase, type Database } from '../server/db.ts';
import { seedHotels } from '../server/seed.ts';
import { CanopiaService } from '../server/service.ts';
import { SimulationProvider } from '../server/ai.ts';
import { createApp } from '../server/app.ts';
import { loadExample } from '../server/examples.ts';
import { ResearchService } from '../server/research.ts';
import { validateResearchOutput, type ResearchRun } from '../shared/research.ts';
import { simulateResearch } from '../extensions/simulation.ts';
import type { Config } from '../server/config.ts';

let db: Database,
  core: CanopiaService,
  research: ResearchService,
  app: ReturnType<typeof createApp>,
  cookie: string;
const config: Config = {
  port: 4322,
  host: '127.0.0.1',
  origin: 'http://127.0.0.1:4322',
  dataDir: ':memory:',
  secret: 'fictional-research-test-only-secret-123456',
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
before(async () => {
  db = await openDatabase(':memory:');
  await seedHotels(db);
  core = new CanopiaService(db, config, new SimulationProvider());
  research = new ResearchService(core);
  app = createApp(core);
  const r = await request(app)
    .post('/api/auth/setup')
    .set('Host', '127.0.0.1:4322')
    .set('Origin', config.origin)
    .send({ email: 'research@example.invalid', password: 'Fictional research password 123' })
    .expect(200);
  cookie = r.headers['set-cookie'][0].split(';')[0];
});
after(async () => {
  await core.idle();
  await db.close();
});
const example = async () => (await loadExample(core, 'prague-anniversary')).stay.id;
const decide = (run: ResearchRun, choice: 'retained' | 'rejected' = 'retained') =>
  research.decide(run.stayId, run.id, {
    revision: run.revision,
    proposalId: run.output.proposals[0].id,
    choice,
    editedDescription: 'Reviewed fixture description.',
    reason: 'Testing the review workflow; not a real hotel recommendation.',
  });

test('examples preserve frozen evidence without sharing IDs or importing private data', async () => {
  for (const id of ['family-anniversary', 'prague-anniversary', 'work-and-running']) {
    const a = await loadExample(core, id),
      b = await loadExample(core, id);
    assert.notEqual(a.stay.id, b.stay.id);
    assert.notEqual(a.messages[0].id, b.messages[0].id);
    assert.equal(a.stay.email, '');
    assert.equal(a.invitations.length, 0);
    assert.equal(a.briefs[0].source, 'recorded-example');
    assert.equal(a.briefs[0].promptVersion, 'brief-v4.2');
    assert.equal(a.briefs[0].text, b.briefs[0].text);
    assert.ok(a.stay.facts.every((f) => a.messages.some((m) => m.id === f.sourceMessageId)));
    assert.equal((await core.input(a.stay.id)).hotel.version, a.stay.dnaVersion);
  }
});
test('research requires authentication, origin and stay-scoped run IDs', async () => {
  const id = await example(),
    other = await example();
  await request(app).get(`/api/stays/${id}/research`).set('Host', '127.0.0.1:4322').expect(401);
  await request(app)
    .post(`/api/stays/${id}/research`)
    .set('Host', '127.0.0.1:4322')
    .set('Origin', 'https://example.invalid')
    .set('Cookie', cookie)
    .send({ module: 'local-discovery', mode: 'simulation' })
    .expect(403);
  const r = await request(app)
    .post(`/api/stays/${id}/research`)
    .set('Host', '127.0.0.1:4322')
    .set('Origin', config.origin)
    .set('Cookie', cookie)
    .send({ module: 'local-discovery', mode: 'simulation' })
    .expect(201);
  assert.equal('email' in r.body.input.stay, false);
  await assert.rejects(research.compose(other, [r.body.id]), /not found/);
});
test('live adapters explicitly abstain or report unimplemented work without changing a brief', async () => {
  const id = await example(),
    before = await core.detail(id);
  assert.equal((await research.run(id, 'context-enrichment', 'live')).output.status, 'abstained');
  assert.equal((await research.run(id, 'local-discovery', 'live')).output.status, 'not-implemented');
  assert.deepEqual((await core.detail(id)).briefs, before.briefs);
});
test('evidence cannot refer to foreign messages or missing sources, or pass simulation as live', async () => {
  const id = await example(),
    run = await research.run(id, 'local-discovery', 'simulation');
  let out = simulateResearch('local-discovery', run.input);
  out.findings[0].messageIds = ['foreign-message'];
  assert.throws(() => validateResearchOutput(out, run.input, 'simulation'), /guest message/);
  out = simulateResearch('local-discovery', run.input);
  out.findings[0].sourceIds = ['missing'];
  assert.throws(() => validateResearchOutput(out, run.input, 'simulation'), /source/);
  out = simulateResearch('local-discovery', run.input);
  assert.throws(() => validateResearchOutput(out, run.input, 'live'), /Simulated/);
});
test('review rejects pending, all-rejected and stale decisions; baseline edits force a new run', async () => {
  const id = await example(),
    run = await research.run(id, 'local-discovery', 'simulation');
  await assert.rejects(research.compose(id, [run.id]), /every proposal/);
  await decide(run, 'rejected');
  await assert.rejects(research.compose(id, [run.id]), /No proposal/);
  await assert.rejects(decide(run), /another window/);
  const newRun = await research.run(id, 'local-discovery', 'simulation');
  await decide(newRun);
  const baseline = (await core.detail(id)).briefs[0];
  await core.saveBrief(id, baseline.id, baseline.text + '\nHuman correction.', baseline.revision);
  await assert.rejects(research.compose(id, [newRun.id]), /baseline was edited/);
});
test('both extensions compose once into a new version, keeping the original baseline and decisions', async () => {
  const id = await example(),
    baseline = (await core.detail(id)).briefs[0];
  const a = await research.run(id, 'local-discovery', 'simulation'),
    b = await research.run(id, 'context-enrichment', 'simulation');
  await decide(a);
  await decide(b);
  const composed = await research.compose(id, [a.id, b.id]);
  assert.equal(composed.version, 2);
  assert.equal(composed.source, 'research-preview');
  assert.match(composed.text, /SIMULATED RESEARCH PREVIEW/);
  assert.ok(composed.text.startsWith(baseline.text));
  assert.deepEqual(composed.research?.runIds, [a.id, b.id]);
  assert.equal((await core.detail(id)).briefs.find((x) => x.id === baseline.id)?.text, baseline.text);
  assert.equal((await core.exportBrief(id, composed.id)).text, composed.text);
  await assert.rejects(research.compose(id, [a.id, b.id]), /already composed/);
  await assert.rejects(decide((await research.list(id))[0]), /already composed/);
});
test('refusal, revocation and deletion stop research use and clean up saved runs', async () => {
  const id = await example(),
    run = await research.run(id, 'local-discovery', 'simulation');
  await decide(run);
  await core.stopById(id);
  await assert.rejects(research.run(id, 'local-discovery', 'simulation'), /completed/);
  await assert.rejects(research.compose(id, [run.id]), /no longer/);
  const revoked = await example(),
    r = await research.run(revoked, 'local-discovery', 'simulation');
  await core.revoke(revoked);
  await assert.rejects(decide(r), /no longer/);
  await core.deleteStay(id);
  assert.equal((await db.query('SELECT id FROM research_runs WHERE stay_id=$1', [id])).rows.length, 0);
});
