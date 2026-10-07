import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { z } from 'zod';
import type { Brief } from '../shared/types.ts';
import {
  moduleSchema,
  validateResearchOutput,
  type ResearchInput,
  type ResearchRun,
  type ResearchModule,
} from '../shared/research.ts';
import { contextEnrichment } from '../extensions/context-enrichment/index.ts';
import { localDiscovery } from '../extensions/local-discovery/index.ts';
import { simulateResearch } from '../extensions/simulation.ts';
import type { CanopiaService } from './service.ts';
import { assert } from './security.ts';

export class ResearchService {
  constructor(private core: CanopiaService) {}
  async list(stayId: string): Promise<ResearchRun[]> {
    await this.core.row(stayId);
    return (
      await this.core.db.query<{ data: ResearchRun }>(
        'SELECT data FROM research_runs WHERE stay_id=$1 ORDER BY created_at DESC',
        [stayId],
      )
    ).rows.map((r) => r.data);
  }
  async run(stayId: string, module: ResearchModule, mode: ResearchRun['mode']) {
    const { stay, hotel, messages } = await this.core.input(stayId);
    assert(
      stay.status === 'completed' && !stay.revoked,
      409,
      'Research requires a completed, active fictional stay.',
    );
    assert(stay.demo, 409, 'This workbench supports fictional stays only.');
    const detail = await this.core.detail(stayId);
    const baseline = detail.briefs.find((b) => b.id === stay.selectedBriefId);
    assert(baseline && baseline.kind === 'normal', 409, 'Select a saved baseline brief first.');
    const input: ResearchInput = {
      stay: {
        id: stay.id,
        hotelId: stay.hotelId,
        guestName: stay.guestName,
        arrival: stay.arrival,
        departure: stay.departure,
        partySize: stay.partySize,
        reservationNotes: stay.reservationNotes,
        handoff: stay.handoff,
        demo: stay.demo,
      },
      hotel,
      messages,
      declaredInterests: stay.facts,
      baseline: {
        id: baseline.id,
        revision: baseline.revision,
        text: baseline.text,
        model: baseline.model,
        promptVersion: baseline.promptVersion,
      },
      identity: { status: 'unverified', publicUrls: [] },
    };
    const adapter = module === 'local-discovery' ? localDiscovery : contextEnrichment;
    const value = mode === 'simulation' ? simulateResearch(module, input) : await adapter.run(input);
    const output = validateResearchOutput(value, input, mode);
    const run: ResearchRun = {
      id: randomUUID(),
      stayId,
      module,
      mode,
      createdAt: new Date().toISOString(),
      revision: 1,
      input,
      output,
      decisions: output.proposals.map((p) => ({
        proposalId: p.id,
        choice: 'pending',
        editedDescription: p.description,
        reason: '',
      })),
    };
    await this.core.db.transaction(async (tx) => {
      const row = await this.core.row(stayId, tx, true);
      assert(
        row.data.status === 'completed' && !row.data.revoked,
        409,
        'The stay is no longer available for research.',
      );
      await tx.query('INSERT INTO research_runs(id,stay_id,data,created_at) VALUES($1,$2,$3,$4)', [
        run.id,
        stayId,
        JSON.stringify(run),
        run.createdAt,
      ]);
    });
    return run;
  }
  async decide(
    stayId: string,
    runId: string,
    body: {
      revision: number;
      proposalId: string;
      choice: 'retained' | 'rejected';
      editedDescription: string;
      reason: string;
    },
  ) {
    return this.core.db.transaction(async (tx) => {
      const row = await this.core.row(stayId, tx, true);
      assert(
        row.data.status === 'completed' && !row.data.revoked,
        409,
        'The stay is no longer available for research.',
      );
      const run = (
        await tx.query<{ data: ResearchRun }>(
          'SELECT data FROM research_runs WHERE id=$1 AND stay_id=$2 FOR UPDATE',
          [runId, stayId],
        )
      ).rows[0]?.data;
      assert(run, 404, 'Research run not found for this stay.');
      assert(
        !run.composedBriefId,
        409,
        'This run was already composed. Start a new run to change the decision.',
      );
      assert(
        run.revision === body.revision,
        409,
        'Research decisions changed in another window. Reload before saving.',
      );
      const decision = run.decisions.find((d) => d.proposalId === body.proposalId);
      assert(decision, 404, 'Proposal not found.');
      Object.assign(decision, {
        choice: body.choice,
        editedDescription: body.editedDescription,
        reason: body.reason,
      });
      run.revision++;
      await tx.query('UPDATE research_runs SET data=$2 WHERE id=$1', [runId, JSON.stringify(run)]);
      return run;
    });
  }
  async compose(stayId: string, runIds: string[]) {
    assert(
      runIds.length > 0 && new Set(runIds).size === runIds.length,
      400,
      'Select distinct research runs.',
    );
    return this.core.db.transaction(async (tx) => {
      const row = await this.core.row(stayId, tx, true);
      assert(
        row.data.status === 'completed' && !row.data.revoked,
        409,
        'The stay is no longer available for composition.',
      );
      const runs: ResearchRun[] = [];
      for (const id of runIds) {
        const run = (
          await tx.query<{ data: ResearchRun }>(
            'SELECT data FROM research_runs WHERE id=$1 AND stay_id=$2 FOR UPDATE',
            [id, stayId],
          )
        ).rows[0]?.data;
        assert(run, 404, 'Research run not found for this stay.');
        runs.push(run);
      }
      assert(
        runs.every((r) => !r.composedBriefId),
        409,
        'A selected run was already composed.',
      );
      const first = runs[0].input.baseline;
      assert(
        runs.every((r) => r.input.baseline.id === first.id && r.input.baseline.revision === first.revision),
        409,
        'Combine runs from the same baseline version.',
      );
      const all = (
        await tx.query<{ data: Brief }>('SELECT data FROM briefs WHERE stay_id=$1', [stayId])
      ).rows.map((r) => r.data);
      const baseline = all.find((b) => b.id === first.id);
      assert(
        baseline && baseline.revision === first.revision,
        409,
        'The baseline was edited. Start research again to preserve those changes.',
      );
      assert(
        row.data.selectedBriefId === baseline.id,
        409,
        'Select the baseline used by these runs before composing.',
      );
      assert(
        runs.every((r) => r.decisions.every((d) => d.choice !== 'pending')),
        409,
        'Retain or reject every proposal in the selected runs first.',
      );
      const retained = runs.flatMap((r) =>
        r.decisions.filter((d) => d.choice === 'retained').map((d) => ({ run: r, decision: d })),
      );
      assert(retained.length > 0, 409, 'No proposal was retained. Keep the baseline brief.');
      const sections = retained.map(({ run, decision }) => {
        const proposal = run.output.proposals.find((p) => p.id === decision.proposalId)!;
        const findings = run.output.findings.filter((f) => proposal.findingIds.includes(f.id));
        const sources = run.output.sources.filter((s) => findings.some((f) => f.sourceIds.includes(s.id)));
        return `${proposal.title}\n${decision.editedDescription}\nReview reason: ${decision.reason}\nRequired capabilities: ${proposal.requiredCapabilities.join('; ')}\nStill to confirm: ${proposal.confirmations.join('; ')}\nEvidence: ${findings.map((f) => f.text + ' Uncertainty: ' + f.uncertainty).join('\n')}\nSources: ${sources.map((s) => s.url + ' (checked ' + s.checkedAt + '; ' + s.kind + ')').join('; ')}${proposal.localDetails ? '\nBooking and cost details: ' + JSON.stringify(proposal.localDetails, null, 2) : ''}`;
      });
      const simulated = runs.some((r) => r.mode === 'simulation');
      const text = `${baseline.text}\n\n${simulated ? 'SIMULATED RESEARCH PREVIEW — fixture evidence, not real findings.' : 'RESEARCH ADDITIONS — selected for hotel review.'}\nThe hotel must confirm feasibility and any final price.\n\n${sections.join('\n\n')}`;
      const now = new Date().toISOString();
      const brief: Brief = {
        id: randomUUID(),
        stayId,
        version: Math.max(...all.map((b) => b.version)) + 1,
        text,
        generatedText: text,
        kind: 'normal',
        source: 'research-preview',
        dnaVersion: row.data.dnaVersion,
        promptVersion: 'research-appendix-v1',
        model: 'deterministic-composition-no-ai',
        createdAt: now,
        updatedAt: now,
        revision: 1,
        research: { baselineId: baseline.id, baselineRevision: baseline.revision, runIds, simulated },
      };
      await tx.query('INSERT INTO briefs(id,stay_id,data) VALUES($1,$2,$3)', [
        brief.id,
        stayId,
        JSON.stringify(brief),
      ]);
      for (const run of runs) {
        run.composedBriefId = brief.id;
        run.revision++;
        await tx.query('UPDATE research_runs SET data=$2 WHERE id=$1', [run.id, JSON.stringify(run)]);
      }
      await this.core.patch(tx, stayId, { selectedBriefId: brief.id, briefStatus: 'ready' });
      return brief;
    });
  }
}

export function registerResearchRoutes(app: Express, core: CanopiaService) {
  const research = new ResearchService(core);
  const id = (v: unknown) => z.uuid().parse(v);
  app.get('/api/stays/:id/research', async (req, res) => res.json(await research.list(id(req.params.id))));
  app.post('/api/stays/:id/research', async (req, res) => {
    const b = z
      .object({ module: moduleSchema, mode: z.enum(['simulation', 'live']) })
      .strict()
      .parse(req.body);
    res.status(201).json(await research.run(id(req.params.id), b.module, b.mode));
  });
  app.put('/api/stays/:id/research/:runId/decision', async (req, res) => {
    const b = z
      .object({
        revision: z.number().int().positive(),
        proposalId: z.string(),
        choice: z.enum(['retained', 'rejected']),
        editedDescription: z.string().trim().min(1).max(3000),
        reason: z.string().trim().min(1).max(1000),
      })
      .strict()
      .parse(req.body);
    res.json(await research.decide(id(req.params.id), id(req.params.runId), b));
  });
  app.post('/api/stays/:id/research/compose', async (req, res) => {
    const b = z
      .object({ runIds: z.array(z.uuid()).min(1).max(10) })
      .strict()
      .parse(req.body);
    res.status(201).json(await research.compose(id(req.params.id), b.runIds));
  });
}
