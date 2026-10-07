import { readFile } from 'node:fs/promises';
import express from 'express';
import { resolve } from 'node:path';
import { loadConfig } from './config.ts';
import { openDatabase } from './db.ts';
import { seedHotels } from './seed.ts';
import { makeProvider } from './ai.ts';
import { AiBudget } from './ai-budget.ts';
import { CanopiaService } from './service.ts';
import { createApp } from './app.ts';
const config = loadConfig();
const db = await openDatabase(config.dataDir, config.databaseUrl);
const profileUpdates = await seedHotels(db);
for (const result of profileUpdates) {
  if (result.action === 'updated' || result.action === 'preserved') {
    console.log(
      `Hotel DNA ${result.id}: ${result.action}${result.action === 'preserved' ? ' — operator review needed to merge the research edition' : ''}`,
    );
  }
}
const budget =
  config.aiMode === 'openai' && config.allowAiCalls
    ? await AiBudget.open(db, config.aiBudgetUsd || 0)
    : undefined;
const service = new CanopiaService(db, config, makeProvider(config, budget));
await service.recover();
const app = createApp(service);
if (config.production || process.env.CANOPIA_SERVE_BUILD === 'true') {
  app.use(express.static(resolve('dist'), { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  app.use(vite.middlewares);
  app.get('/{*path}', async (req, res, next) => {
    try {
      const html = await vite.transformIndexHtml(req.originalUrl, await readFile('index.html', 'utf8'));
      res.type('html').send(html);
    } catch (e) {
      next(e);
    }
  });
}
const server = app.listen(config.port, config.host, () =>
  console.log(
    `Canopia local: ${config.origin} | AI: ${service.ai.name} | email: ${config.allowEmail ? 'configured' : 'disabled'}`,
  ),
);
async function shutdown() {
  server.close();
  await service.idle();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
