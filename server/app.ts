import { registerResearchRoutes } from './research.ts';
import { loadExample } from './examples.ts';
import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { CanopiaService } from './service.ts';
import { AppError, assert, hash, passwordHash, token, verifyPassword } from './security.ts';
import type { Brief, Fact, Message } from '../shared/types.ts';

const credentials = z.object({ email: z.email().max(200), password: z.string().min(12).max(200) });
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
const stayInput = z
  .object({
    hotelId: z.string().min(1),
    guestName: z.string().trim().min(1).max(150),
    email: z.union([z.email().max(200), z.literal('')]),
    arrival: isoDate,
    departure: isoDate,
    partySize: z.number().int().min(1).max(100),
    reservationNotes: z.string().max(5000),
    handoff: z.enum(['concierge', 'reception']),
    demo: z.boolean(),
  })
  .refine((s) => s.departure > s.arrival, { message: 'Departure must be after arrival.' });
const hotelInput = z.object({
  dna: z.string().min(30).max(60000),
  version: z.number().int().positive(),
  conciergeStatus: z.enum(['present', 'absent', 'unknown']),
  reviewed: z.boolean(),
  documents: z
    .array(
      z.object({
        id: z.string().max(100),
        name: z.string().min(1).max(200),
        text: z.string().min(1).max(40000),
      }),
    )
    .max(8),
});
const idSchema = z.uuid();
const parseId = (value: unknown) => idSchema.parse(value);

export function createApp(service: CanopiaService) {
  const app = express();
  const { config, db } = service;
  app.disable('x-powered-by');
  const windows = new Map<string, { count: number; reset: number }>();
  app.use((req, res, next) => {
    res.set({
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
    });
    if (req.path.startsWith('/api')) {
      const host = req.headers.host;
      if (host !== new URL(config.origin).host) return res.status(403).json({ error: 'Unexpected host.' });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin)
        return res.status(403).json({ error: 'This action must originate from the application.' });
      const category = req.path.startsWith('/api/auth')
        ? 'auth'
        : req.path.startsWith('/api/guest')
          ? 'guest'
          : 'api';
      const key = `${req.socket.remoteAddress}:${category}`,
        time = Date.now();
      if (windows.size > 5000) for (const [k, v] of windows) if (v.reset < time) windows.delete(k);
      let limit = windows.get(key);
      if (!limit || limit.reset < time) {
        limit = { count: 0, reset: time + 60000 };
        windows.set(key, limit);
      }
      if (++limit.count > (category === 'auth' ? 30 : category === 'guest' ? 180 : 500))
        return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }
    next();
  });
  app.use(express.json({ limit: '600kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  const cookie = (value: string) =>
    `canopia_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${config.production ? '; Secure' : ''}`;
  async function newSession(res: express.Response) {
    const raw = token();
    await db.query('INSERT INTO auth_sessions(token_hash,expires_at) VALUES($1,$2)', [
      hash(raw),
      Date.now() + 43200000,
    ]);
    res.setHeader('Set-Cookie', cookie(raw));
  }
  async function isAuthenticated(req: express.Request) {
    const raw = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('canopia_session='))
      ?.slice(16);
    if (!raw) return false;
    return (
      (
        await db.query('SELECT token_hash FROM auth_sessions WHERE token_hash=$1 AND expires_at>$2', [
          hash(raw),
          Date.now(),
        ])
      ).rows.length > 0
    );
  }
  app.get('/api/auth/status', async (req, res) => {
    const account = await db.query('SELECT id FROM operator_account');
    res.json({
      authenticated: await isAuthenticated(req),
      needsSetup: !account.rows.length,
      setupAllowed: !config.production,
    });
  });
  app.post('/api/auth/setup', async (req, res) => {
    assert(!config.production, 403, 'Initial setup is available only on the local installation.');
    assert(
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || ''),
      403,
      'Initial setup must run from this computer.',
    );
    const values = credentials.parse(req.body);
    const existing = await db.query('SELECT id FROM operator_account');
    assert(!existing.rows.length, 409, 'The operator account already exists.');
    const inserted = await db.query(
      "INSERT INTO operator_account(id,email,password_hash) VALUES('owner',$1,$2) ON CONFLICT DO NOTHING RETURNING id",
      [values.email.toLowerCase(), passwordHash(values.password)],
    );
    assert(inserted.rows.length, 409, 'The operator account already exists.');
    await newSession(res);
    res.json({ ok: true });
  });
  app.post('/api/auth/login', async (req, res) => {
    const values = credentials.parse(req.body),
      row = (
        await db.query<{ email: string; password_hash: string }>(
          "SELECT email,password_hash FROM operator_account WHERE id='owner'",
        )
      ).rows[0];
    assert(
      row && row.email === values.email.toLowerCase() && verifyPassword(values.password, row.password_hash),
      401,
      'Email or password not recognised.',
    );
    await newSession(res);
    res.json({ ok: true });
  });
  app.post('/api/auth/logout', async (req, res) => {
    const raw = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('canopia_session='))
      ?.slice(16);
    if (raw) await db.query('DELETE FROM auth_sessions WHERE token_hash=$1', [hash(raw)]);
    res.setHeader('Set-Cookie', 'canopia_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/guest/:token', async (req, res) => res.json(await service.guest(req.params.token)));
  app.post('/api/guest/:token/messages', async (req, res) => {
    const body = z
      .object({ content: z.string().trim().min(1).max(6000), clientId: z.uuid() })
      .parse(req.body);
    res.json(await service.chat(req.params.token, body.content, body.clientId));
  });
  app.post('/api/guest/:token/retry', async (req, res) =>
    res.json(await service.chat(req.params.token, undefined, undefined)),
  );
  app.post('/api/guest/:token/finish', async (req, res) => res.json(await service.finish(req.params.token)));
  app.post('/api/guest/:token/stop', async (req, res) => res.json(await service.stop(req.params.token)));
  app.use('/api', async (req, res, next) => {
    if (!(await isAuthenticated(req)))
      return res.status(401).json({ error: 'Please sign in to the operator console.' });
    next();
  });
  app.get('/api/runtime', async (_req, res) =>
    res.json({
      aiMode: service.ai.name,
      aiConfigured: service.ai.name === 'openai',
      emailMode: config.emailMode,
      emailEnabled: config.allowEmail && Boolean(config.smtpHost && config.emailFrom),
      realStaysEnabled: config.realStays,
      database: config.databaseUrl ? 'postgres' : 'local-postgres',
      model: config.model || null,
      aiBudget: (await service.ai.budget?.()) || null,
    }),
  );
  app.get('/api/hotels', async (_req, res) => res.json(await service.hotels()));
  app.put('/api/hotels/:id', async (req, res) => {
    const { version, ...values } = hotelInput.parse(req.body);
    res.json(await service.saveHotel(req.params.id, values, version));
  });
  app.get('/api/stays', async (_req, res) => res.json(await service.stays()));
  app.post('/api/stays', async (req, res) =>
    res.status(201).json(await service.createStay(stayInput.parse(req.body))),
  );
  app.get('/api/stays/:id', async (req, res) => res.json(await service.detail(parseId(req.params.id))));
  app.get('/api/stays/:id/link', async (req, res) =>
    res.json({ url: await service.guestLink(parseId(req.params.id)) }),
  );
  app.post('/api/stays/:id/revoke', async (req, res) =>
    res.json(await service.revoke(parseId(req.params.id))),
  );
  app.delete('/api/stays/:id', async (req, res) => {
    await service.deleteStay(parseId(req.params.id));
    res.json({ ok: true });
  });
  app.post('/api/stays/:id/generate', async (req, res) => {
    await service.generate(parseId(req.params.id), true);
    res.status(202).json({ ok: true });
  });
  app.put('/api/stays/:id/selection', async (req, res) => {
    const { briefId } = z.object({ briefId: z.uuid() }).parse(req.body);
    await service.selectBrief(parseId(req.params.id), briefId);
    res.json({ ok: true });
  });
  app.put('/api/stays/:id/briefs/:briefId', async (req, res) => {
    const { text, revision } = z
      .object({ text: z.string().min(1).max(60000), revision: z.number().int().positive() })
      .parse(req.body);
    res.json(await service.saveBrief(parseId(req.params.id), parseId(req.params.briefId), text, revision));
  });
  app.get('/api/stays/:id/briefs/:briefId/export', async (req, res) => {
    const out = await service.exportBrief(parseId(req.params.id), parseId(req.params.briefId));
    res
      .type('text/plain; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${out.name}"`)
      .send(out.text);
  });
  app.post('/api/stays/:id/invitation', async (req, res) => {
    const b = z
      .object({
        subject: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .refine((s) => !/[\r\n]/.test(s)),
        body: z.string().min(1).max(12000),
      })
      .parse(req.body);
    res.json(await service.invitation(parseId(req.params.id), b.subject, b.body));
  });
  app.post('/api/stays/:id/invitation/send', async (req, res) => {
    await service.sendInvitation(parseId(req.params.id));
    res.json({ ok: true });
  });
  registerResearchRoutes(app, service);
  app.post('/api/examples/:exampleId', async (req, res) =>
    res.status(201).json(await loadExample(service, req.params.exampleId)),
  );
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: error.issues.map((i) => `${i.path.join('.') || 'Input'}: ${i.message}`).join('; ') });
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
    if (error?.type === 'entity.too.large')
      return res.status(413).json({ error: 'The submitted content is too large.' });
    // Never log request bodies, links, provider errors or guest data.
    res
      .status(500)
      .json({ error: 'The request could not be completed. Please retry or contact the operator.' });
  };
  app.use(errors);
  return app;
}
