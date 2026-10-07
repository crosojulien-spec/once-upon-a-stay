import { useEffect, useState } from 'react';
import { api } from './api.ts';
import type { ResearchRun, ResearchModule } from '../shared/research.ts';

export function ResearchWorkspace({
  stayId,
  available,
  onComposed,
  onDirty,
}: {
  stayId: string;
  available: boolean;
  onComposed: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { text: string; reason: string }>>({});
  const hasUnsaved = runs.some(
    (run) =>
      !run.composedBriefId &&
      run.decisions.some((decision) => {
        const draft = drafts[run.id + ':' + decision.proposalId];
        return draft && (draft.text !== decision.editedDescription || draft.reason !== decision.reason);
      }),
  );
  useEffect(() => {
    onDirty(hasUnsaved);
    return () => onDirty(false);
  }, [hasUnsaved, onDirty]);
  async function load() {
    setRuns(await api<ResearchRun[]>(`/api/stays/${stayId}/research`));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [stayId]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function run(module: ResearchModule, mode: 'simulation' | 'live') {
    await act(async () => {
      const r = await api<ResearchRun>(`/api/stays/${stayId}/research`, 'POST', { module, mode });
      if (r.output.proposals.length) setChosen((ids) => [...ids, r.id]);
    });
  }
  return (
    <section className="research-workspace stack">
      <div className="card">
        <p className="eyebrow">HACKATHON WORKBENCH</p>
        <h2>What does research add?</h2>
        <p>
          Keep the saved brief as a baseline. Review the evidence, edit each proposal and explain what you
          retain or reject.
        </p>
        <p className="fine">
          Both live research adapters are unimplemented. Simulated previews use invented fixtures and make no
          external calls. They test the workflow, not relevance or feasibility.
        </p>
        {!available && (
          <p role="status">
            Complete a conversation or load a recorded example, then save your brief edits before starting
            research.
          </p>
        )}
        <div className="research-actions">
          <button disabled={busy || !available} onClick={() => void run('local-discovery', 'simulation')}>
            Preview local discovery (simulated)
          </button>
          <button disabled={busy || !available} onClick={() => void run('context-enrichment', 'simulation')}>
            Preview context enrichment (simulated)
          </button>
          <button disabled={busy || !available} onClick={() => void run('context-enrichment', 'live')}>
            Check identity gate (no lookup)
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
      {runs.map((run) => (
        <article className="card" key={run.id}>
          <h3>
            {run.module === 'local-discovery' ? 'Local discovery' : 'Context enrichment'} · {run.mode}
          </h3>
          <p>{run.output.explanation}</p>
          <p className="fine">
            Outcome: {run.output.status}. Baseline prompt: {run.input.baseline.promptVersion}.{' '}
            {run.composedBriefId ? 'Already included in a new brief version.' : 'Review required.'}
          </p>
          {!run.composedBriefId && run.output.proposals.length > 0 && (
            <label className="research-choice">
              <input
                type="checkbox"
                checked={chosen.includes(run.id)}
                onChange={(e) =>
                  setChosen((ids) =>
                    e.target.checked ? [...ids, run.id] : ids.filter((id) => id !== run.id),
                  )
                }
              />{' '}
              Include this run in the new brief
            </label>
          )}
          <details>
            <summary>Baseline brief</summary>
            <pre className="research-text">{run.input.baseline.text}</pre>
          </details>
          {run.output.findings.map((f) => (
            <div key={f.id} className="research-evidence">
              <strong>{f.text}</strong>
              <p>{f.uncertainty}</p>
              {f.sourceIds.map((id) => {
                const s = run.output.sources.find((x) => x.id === id)!;
                return (
                  <p key={id}>
                    {s.kind === 'simulated' ? (
                      s.title
                    ) : (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.title}
                      </a>
                    )}{' '}
                    · checked {s.checkedAt}
                  </p>
                );
              })}
              <details>
                <summary>Guest evidence</summary>
                {f.messageIds.map((id) => (
                  <p key={id}>{run.input.messages.find((m) => m.id === id)?.content}</p>
                ))}
              </details>
            </div>
          ))}
          {run.output.proposals.map((proposal) => {
            const decision = run.decisions.find((d) => d.proposalId === proposal.id)!;
            const key = run.id + ':' + proposal.id;
            const draft = drafts[key] ?? { text: decision.editedDescription, reason: decision.reason };
            const locked = busy || !available || Boolean(run.composedBriefId);
            return (
              <div key={key} className="research-proposal">
                <h4>{proposal.title}</h4>
                <p>
                  Decision: <strong>{decision.choice}</strong>
                </p>
                <label>
                  Proposal text
                  <textarea
                    aria-label={`Proposal text ${run.module}`}
                    rows={4}
                    value={draft.text}
                    disabled={locked}
                    onChange={(e) => setDrafts((d) => ({ ...d, [key]: { ...draft, text: e.target.value } }))}
                  />
                </label>
                <p>Required capabilities: {proposal.requiredCapabilities.join('; ')}</p>
                <p>Still to confirm: {proposal.confirmations.join('; ')}</p>
                {proposal.localDetails && (
                  <details>
                    <summary>Booking, availability and costs</summary>
                    <pre className="research-text">{JSON.stringify(proposal.localDetails, null, 2)}</pre>
                  </details>
                )}
                <label>
                  Reason for your decision
                  <input
                    aria-label={`Decision reason ${run.module}`}
                    value={draft.reason}
                    disabled={locked}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [key]: { ...draft, reason: e.target.value } }))
                    }
                  />
                </label>
                <div className="research-actions">
                  {(['retained', 'rejected'] as const).map((choice) => (
                    <button
                      key={choice}
                      disabled={locked || !draft.reason.trim() || !draft.text.trim()}
                      onClick={() =>
                        void act(() =>
                          api(`/api/stays/${stayId}/research/${run.id}/decision`, 'PUT', {
                            revision: run.revision,
                            proposalId: proposal.id,
                            choice,
                            editedDescription: draft.text,
                            reason: draft.reason,
                          }),
                        )
                      }
                    >
                      {choice === 'retained' ? 'Retain proposal' : 'Reject proposal'}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </article>
      ))}
      {runs.length > 0 && (
        <div className="card">
          <p>
            Only retained proposals from the selected runs enter the new brief. The baseline stays unchanged.
          </p>
          {hasUnsaved && (
            <p role="status">Save each edited proposal with Retain or Reject before creating a brief.</p>
          )}
          <button
            className="primary"
            disabled={busy || !available || !chosen.length || hasUnsaved}
            onClick={() =>
              void act(async () => {
                await api(`/api/stays/${stayId}/research/compose`, 'POST', { runIds: chosen });
                setChosen([]);
                onComposed();
              })
            }
          >
            Create brief with selected research
          </button>
        </div>
      )}
    </section>
  );
}
