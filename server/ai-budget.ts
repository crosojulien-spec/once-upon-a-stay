import { randomUUID } from 'node:crypto';
import type { Database, Queryable } from './db.ts';
import type { AiBudgetStatus } from '../shared/types.ts';
import { AppError, assert } from './security.ts';

// Inherited conservative Canopia budget guard. No hackathon spending is enabled or authorised by this code.
// Conservative Standard rates, including cache-write headroom; no cache discount.
// Keep Sol rates for settling historical calls. Migration never rewrites the ledger.
const rates: Record<string, [number, number]> = {
  'gpt-6.1-sol': [3, 12],
  'gpt-6-luna': [0.15, 0.6],
};
const microDollars = (model: string, input: number, output: number) => {
  assert(rates[model], 503, 'No approved accounting rates exist for this model.');
  return Math.ceil(input * rates[model][0] + output * rates[model][1]);
};
export const approvedModel = 'gpt-6-luna';
export class AiBudget {
  private constructor(private db: Database) {}
  static async open(db: Database, dollars: number) {
    assert(
      Number.isFinite(dollars) && dollars > 0 && dollars <= 5,
      503,
      'Configure the authorised AI trial budget (up to USD 5) before activation.',
    );
    const limit = Math.floor(dollars * 1_000_000);
    await db.query(
      "INSERT INTO ai_budget(id,limit_micro) VALUES('initial-trial',$1) ON CONFLICT(id) DO NOTHING",
      [limit],
    );
    // Restarting or changing .env can lower the cap, never replenish or raise it.
    await db.query("UPDATE ai_budget SET limit_micro=LEAST(limit_micro,$1) WHERE id='initial-trial'", [
      limit,
    ]);
    return new AiBudget(db);
  }
  private async total(tx: Queryable) {
    return Number(
      (
        await tx.query<{ amount: string }>(
          'SELECT COALESCE(SUM(COALESCE(accounted_micro,reserved_micro)),0) AS amount FROM ai_calls',
        )
      ).rows[0].amount,
    );
  }
  async status(): Promise<AiBudgetStatus> {
    const row = (
      await this.db.query<{ limit_micro: number; blocked: boolean }>(
        "SELECT limit_micro,blocked FROM ai_budget WHERE id='initial-trial'",
      )
    ).rows[0];
    const used = await this.total(this.db);
    const pending = Number(
      (await this.db.query<{ n: string }>('SELECT COUNT(*) AS n FROM ai_calls WHERE accounted_micro IS NULL'))
        .rows[0].n,
    );
    return {
      limitUsd: row.limit_micro / 1e6,
      accountedUsd: used / 1e6,
      remainingUsd: Math.max(0, row.limit_micro - used) / 1e6,
      uncertainCalls: pending,
      blocked: row.blocked || used >= row.limit_micro,
    };
  }
  async reserve(model: string, inputTokens: number, maxOutputTokens: number, purpose: 'chat' | 'brief') {
    assert(model === approvedModel, 503, 'New trial calls are configured for GPT-6 Luna only.');
    assert(
      Number.isSafeInteger(inputTokens) &&
        inputTokens >= 0 &&
        inputTokens <= 100_000 &&
        Number.isSafeInteger(maxOutputTokens) &&
        maxOutputTokens > 0 &&
        maxOutputTokens <= 7000,
      503,
      'This AI request exceeds the supported trial size.',
    );
    // Include framing headroom beyond the provider's preflight count. The input
    // remains well below the 272K threshold for long-context pricing.
    const reserved = microDollars(model, inputTokens + 512, maxOutputTokens);
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      const row = (
        await tx.query<{ limit_micro: number; blocked: boolean }>(
          "SELECT limit_micro,blocked FROM ai_budget WHERE id='initial-trial' FOR UPDATE",
        )
      ).rows[0];
      assert(
        !row.blocked && (await this.total(tx)) + reserved <= row.limit_micro,
        503,
        'The AI trial budget cannot cover another response. Your message is saved; ask the operator to review the budget.',
      );
      await tx.query('INSERT INTO ai_calls(id,model,purpose,reserved_micro) VALUES($1,$2,$3,$4)', [
        id,
        model,
        purpose,
        reserved,
      ]);
    });
    return id;
  }
  async settle(
    id: string,
    usage: { input_tokens: number; output_tokens: number } | undefined | null,
    requestId: string | undefined | null,
    serviceTier: string | undefined | null,
  ) {
    // Timeout, cancellation, missing usage or an unexpected tier retains the
    // full reservation across restarts. We cannot assume that it was unbilled.
    if (!usage) return;
    const { input_tokens: input, output_tokens: output } = usage;
    if (![input, output].every((n) => Number.isSafeInteger(n) && n >= 0)) return;
    const needsReview = await this.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM ai_budget WHERE id='initial-trial' FOR UPDATE");
      const call = (
        await tx.query<{ model: string; reserved_micro: number; accounted_micro: number | null }>(
          'SELECT model,reserved_micro,accounted_micro FROM ai_calls WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (!call || call.accounted_micro !== null) return false;
      const amount = microDollars(call.model, input, output);
      if ((serviceTier && serviceTier !== 'default') || amount > call.reserved_micro) {
        await tx.query("UPDATE ai_budget SET blocked=true WHERE id='initial-trial'");
        return true;
      }
      await tx.query(
        'UPDATE ai_calls SET accounted_micro=$2,input_tokens=$3,output_tokens=$4,request_id=$5 WHERE id=$1',
        [id, amount, input, output, requestId || null],
      );
      return false;
    });
    if (needsReview) throw new AppError(503, 'AI usage needs an operator review before further calls.');
  }
}
