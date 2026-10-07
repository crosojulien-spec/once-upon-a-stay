import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { resolve } from 'node:path';
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Database extends Queryable {
  transaction<T>(fn: (db: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function openDatabase(dataDir: string, url?: string): Promise<Database> {
  let db: Database;
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 6 });
    db = {
      query: async <T>(sql: string, params?: unknown[]) => ({
        rows: (await pool.query(sql, params)).rows as T[],
      }),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({
            query: async <T>(sql: string, params?: unknown[]) => ({
              rows: (await client.query(sql, params)).rows as T[],
            }),
          });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const local = await PGlite.create(dataDir === ':memory:' ? 'memory://' : resolve(dataDir, 'postgres'));
    db = {
      query: async <T>(sql: string, params?: unknown[]) => ({
        rows: (await local.query<T>(sql, params)).rows,
      }),
      transaction: (fn) =>
        local.transaction((tx) =>
          fn({
            query: async <T>(sql: string, params?: unknown[]) => ({
              rows: (await tx.query<T>(sql, params)).rows,
            }),
          }),
        ),
      close: () => local.close(),
    };
  }
  // Each statement separately works with both node-postgres and PGlite prepared queries.
  for (const sql of schema) await db.query(sql);
  return db;
}
const schema = [
  `CREATE TABLE IF NOT EXISTS ai_budget (id text PRIMARY KEY CHECK (id='initial-trial'), limit_micro integer NOT NULL CHECK(limit_micro>0 AND limit_micro<=5000000), blocked boolean NOT NULL DEFAULT false)`,
  `CREATE TABLE IF NOT EXISTS ai_calls (id text PRIMARY KEY, model text NOT NULL, purpose text NOT NULL, reserved_micro integer NOT NULL, accounted_micro integer, input_tokens integer, output_tokens integer, request_id text, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS operator_account (id text PRIMARY KEY CHECK (id='owner'), email text NOT NULL, password_hash text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (token_hash text PRIMARY KEY, expires_at bigint NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS hotels (id text PRIMARY KEY, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS dna_versions (hotel_id text REFERENCES hotels(id), version integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY(hotel_id,version))`,
  `CREATE TABLE IF NOT EXISTS stays (id text PRIMARY KEY, hotel_id text REFERENCES hotels(id), data jsonb NOT NULL, token_hash text UNIQUE NOT NULL, token_cipher text NOT NULL, hotel_snapshot jsonb NOT NULL, chat_busy boolean NOT NULL DEFAULT false)`,
  `CREATE INDEX IF NOT EXISTS stays_hotel_id ON stays(hotel_id)`,
  `CREATE TABLE IF NOT EXISTS messages (id text PRIMARY KEY, stay_id text REFERENCES stays(id) ON DELETE CASCADE, client_id text, data jsonb NOT NULL, sequence bigserial, UNIQUE(stay_id,client_id))`,
  `CREATE TABLE IF NOT EXISTS briefs (id text PRIMARY KEY, stay_id text REFERENCES stays(id) ON DELETE CASCADE, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS research_runs (id text PRIMARY KEY, stay_id text REFERENCES stays(id) ON DELETE CASCADE, data jsonb NOT NULL, created_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS invitations (id text PRIMARY KEY, stay_id text REFERENCES stays(id) ON DELETE CASCADE, data jsonb NOT NULL, UNIQUE(stay_id))`,
];
