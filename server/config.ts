import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  host: string;
  origin: string;
  dataDir: string;
  databaseUrl?: string;
  secret: string;
  production: boolean;
  aiMode: 'disabled' | 'simulation' | 'openai';
  apiKey?: string;
  model?: string;
  allowAiCalls: boolean;
  aiBudgetUsd?: number;
  emailMode: 'preview' | 'smtp';
  allowEmail: boolean;
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPassword?: string;
  emailFrom?: string;
  testRecipients: string[];
  realStays: boolean;
  retentionDays?: number;
  guestLinkDays: number;
}
export function loadConfig(): Config {
  const production = process.env.NODE_ENV === 'production';
  const dataDir = resolve(process.env.CANOPIA_DATA_DIR || '.local/development');
  mkdirSync(dataDir, { recursive: true });
  let secret = process.env.CANOPIA_SECRET;
  if (!secret) {
    if (production) throw new Error('CANOPIA_SECRET must be configured in production.');
    const path = resolve(dataDir, 'installation.key');
    if (!existsSync(path))
      writeFileSync(path, randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
    secret = readFileSync(path, 'utf8').trim();
  }
  if (secret.length < 32) throw new Error('CANOPIA_SECRET must contain at least 32 characters.');
  const port = Number(process.env.PORT || 4320);
  const aiMode = process.env.CANOPIA_AI_MODE || 'disabled';
  if (!['disabled', 'simulation', 'openai'].includes(aiMode)) throw new Error('Invalid AI mode.');
  const realStays = process.env.CANOPIA_ALLOW_REAL_STAYS === 'true';
  const retentionDays = Number(process.env.CANOPIA_RETENTION_DAYS) || undefined;
  if (realStays)
    throw new Error(
      'Real stays are not available yet: retention rules and guest information must be agreed and implemented first.',
    );
  return {
    port,
    host: process.env.HOST || '127.0.0.1',
    origin: process.env.CANOPIA_ORIGIN || `http://127.0.0.1:${port}`,
    dataDir,
    secret,
    production,
    databaseUrl: process.env.DATABASE_URL,
    aiMode: aiMode as Config['aiMode'],
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
    allowAiCalls: process.env.CANOPIA_ALLOW_AI_CALLS === 'true',
    aiBudgetUsd: Number(process.env.CANOPIA_AI_BUDGET_USD) || 0,
    emailMode: process.env.CANOPIA_EMAIL_MODE === 'smtp' ? 'smtp' : 'preview',
    allowEmail: process.env.CANOPIA_ALLOW_EMAIL === 'true',
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER,
    smtpPassword: process.env.SMTP_PASSWORD,
    emailFrom: process.env.CANOPIA_EMAIL_FROM,
    testRecipients: (process.env.CANOPIA_TEST_RECIPIENTS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    realStays,
    retentionDays,
    guestLinkDays: Number(process.env.CANOPIA_GUEST_LINK_DAYS || 7),
  };
}
