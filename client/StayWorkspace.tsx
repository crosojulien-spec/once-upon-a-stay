import { ResearchWorkspace } from './ResearchWorkspace.tsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileText,
  Link2,
  Mail,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type { Brief, RuntimeInfo, StayDetail } from '../shared/types.ts';
import { api, copy } from './api.ts';
import { Badge, Notice, StayBadge, date } from './App.tsx';
export function StayWorkspace({
  id,
  runtime,
  onBack,
  onDirty,
}: {
  id: string;
  runtime: RuntimeInfo | null;
  onBack: () => void;
  onDirty: (v: boolean) => void;
}) {
  const [detail, setDetail] = useState<StayDetail | null>(null),
    [tab, setTab] = useState<'brief' | 'conversation' | 'invitation' | 'research'>('brief'),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [busy, setBusy] = useState(false);
  const [researchDirty, setResearchDirty] = useState(false);
  function changeTab(next: typeof tab) {
    if (researchDirty && !confirm('Discard unsaved research edits?')) return;
    setTab(next);
  }
  const [text, setText] = useState(''),
    [dirty, setDirty] = useState(false),
    dirtyRef = useRef(false),
    [editor, setEditor] = useState<Brief | undefined>();
  const [link, setLink] = useState(''),
    [subject, setSubject] = useState(''),
    [body, setBody] = useState(''),
    [invitationDirty, setInvitationDirty] = useState(false);
  const loadedRef = useRef(false);
  const load = useCallback(async () => {
    try {
      const d = await api<StayDetail>(`/api/stays/${id}`);
      setDetail(d);
      if (!dirtyRef.current) {
        const b = d.briefs.find((b) => b.id === d.stay.selectedBriefId);
        setEditor(b);
        setText(b?.text || '');
      }
      if (!loadedRef.current) {
        loadedRef.current = true;
        const l = await api<{ url: string }>(`/api/stays/${id}/link`);
        setLink(l.url);
        const inv = d.invitations[0];
        setSubject(inv?.subject || `A few wishes before your stay at ${d.stay.hotelName}`);
        setBody(
          inv?.body ||
            `Hello ${d.stay.guestName.split(' ')[0]},\n\nWe would love to understand what matters to you before your stay at ${d.stay.hotelName} from ${d.stay.arrival} to ${d.stay.departure}.\n\nThis optional conversation takes around 3–5 minutes and helps the team prepare your welcome. Share only what you feel comfortable sharing; you can skip a question or stop at any time. Your answers are intended to help prepare this stay and are reviewed by a person.\n\nStart when you are ready:\n${l.url}\n\nYou can also contact the hotel directly if you prefer.\n\nWe look forward to welcoming you.\nThe ${d.stay.hotelName} team`,
        );
        if (!d.briefs.length) setTab('invitation');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    onDirty(dirty || invitationDirty || researchDirty);
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || invitationDirty || researchDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, invitationDirty, researchDirty]);
  async function act(fn: () => Promise<unknown>, message = '') {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await fn();
      setSuccess(message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!detail) return <div className="loading">Opening stay…{error && <Notice error>{error}</Notice>}</div>;
  const { stay, briefs, messages, invitations } = detail,
    brief = editor,
    invitation = invitations[0];
  async function select(briefId: string) {
    if (dirty && !confirm('Discard your unsaved edits and open this version?')) return;
    dirtyRef.current = false;
    setDirty(false);
    await act(() => api(`/api/stays/${id}/selection`, 'PUT', { briefId }));
  }
  async function save() {
    if (!brief) return;
    await act(async () => {
      const saved = await api<Brief>(`/api/stays/${id}/briefs/${brief.id}`, 'PUT', {
        text,
        revision: brief.revision,
      });
      await api(`/api/stays/${id}/selection`, 'PUT', { briefId: brief.id });
      setEditor(saved);
      setText(saved.text);
      dirtyRef.current = false;
      setDirty(false);
    }, 'Your edits are saved. This is the version used for export.');
  }
  async function preview() {
    await act(async () => {
      await api(`/api/stays/${id}/invitation`, 'POST', { subject, body });
      setInvitationDirty(false);
    }, 'Invitation saved for review. No email has been sent.');
  }
  const invitationsLocked = invitation && ['sent', 'sending', 'unknown'].includes(invitation.status);
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} />
        All stays
      </button>
      <div className="page-heading stay-heading">
        <div>
          <p className="eyebrow">{stay.hotelName}</p>
          <h1>{stay.guestName}</h1>
          <div className="stay-subline">
            <span>
              {date(stay.arrival)} — {date(stay.departure)}
            </span>
            <span>{stay.partySize} guests</span>
            <span>DNA v{stay.dnaVersion}</span>
            {stay.demo && <Badge>Fictional test</Badge>}
          </div>
        </div>
        <StayBadge stay={stay} />
      </div>
      {stay.status === 'stopped' && (
        <div className="withdrawal-banner">
          <ShieldAlert size={23} />
          <div>
            <strong>Personalization declined by the guest</strong>
            <p>
              The collected information is a minimal record only. Do not use it to prepare personalized
              attentions or experiences.
            </p>
          </div>
        </div>
      )}
      {stay.revoked && <Notice>This invitation has been withdrawn. The guest link is closed.</Notice>}
      {error && <Notice error>{error}</Notice>}
      {success && <Notice>{success}</Notice>}
      <div className="detail-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'brief'} onClick={() => changeTab('brief')}>
          <FileText size={16} />
          Brief & review{briefs.length > 0 && <span>{briefs.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'conversation'} onClick={() => changeTab('conversation')}>
          Conversation<span>{messages.filter((m) => m.role === 'user').length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'invitation'} onClick={() => changeTab('invitation')}>
          <Mail size={16} />
          Invitation
        </button>
        <button role="tab" aria-selected={tab === 'research'} onClick={() => changeTab('research')}>
          Research lab
        </button>
      </div>
      {tab === 'research' ? (
        <ResearchWorkspace
          stayId={id}
          onDirty={setResearchDirty}
          available={stay.status === 'completed' && !stay.revoked && Boolean(brief) && !dirty}
          onComposed={() => {
            void load();
            setTab('brief');
          }}
        />
      ) : tab === 'brief' ? (
        <div className="brief-layout">
          <section className="card brief-main">
            <div className="section-heading">
              <div>
                <p className="eyebrow">INTERNAL HOTEL BRIEF</p>
                <h2>{brief ? 'Read, refine, make it useful.' : 'Waiting for the conversation.'}</h2>
              </div>
              {brief && (
                <Badge tone={dirty ? 'amber' : 'green'}>{dirty ? 'Unsaved edits' : 'Saved version'}</Badge>
              )}
            </div>
            {stay.briefStatus === 'generating' && (
              <Notice>A new brief is being prepared. Existing versions remain available.</Notice>
            )}
            {stay.briefError && <Notice error>{stay.briefError}</Notice>}
            {brief ? (
              <>
                {brief.source === 'historical' && (
                  <Notice>
                    This is a historical simulation with known limitations. The original prompt and DNA
                    versions are not established.
                  </Notice>
                )}
                {brief.source === 'recorded-example' && (
                  <Notice>
                    Recorded AI output from a fictional Canopia test on 6 October 2026. It was loaded without
                    a new AI call and is not hotel-approved.
                  </Notice>
                )}
                {brief.source === 'research-preview' && (
                  <Notice>
                    {brief.research?.simulated
                      ? 'Simulated research additions. These are wiring fixtures, not real findings.'
                      : 'Research additions selected for hotel review.'}{' '}
                    The original baseline is preserved as a separate version.
                  </Notice>
                )}
                {brief.source === 'simulation' && (
                  <Notice>
                    Scripted rehearsal output. This does not validate AI quality or hotel feasibility.
                  </Notice>
                )}
                <textarea
                  className="brief-text"
                  aria-label="Brief text"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setDirty(true);
                    dirtyRef.current = true;
                    setSuccess('');
                  }}
                  spellCheck
                  rows={25}
                />
                <div className="editor-footer">
                  <span>{text.length.toLocaleString()} characters · English brief</span>
                  <button className="primary" disabled={busy || !dirty} onClick={save}>
                    <Check size={16} />
                    Save edits
                  </button>
                </div>
              </>
            ) : (
              <div className="brief-empty">
                <FileText size={38} strokeWidth={1.1} />
                <h3>A useful starting point for the team.</h3>
                <p>
                  The brief appears automatically when the guest finishes. You can then edit, copy and export
                  it here.
                </p>
                <button onClick={() => changeTab('invitation')}>
                  Prepare the invitation
                  <ArrowUpRight size={15} />
                </button>
              </div>
            )}
          </section>
          <aside className="stack">
            <section className="card">
              <p className="eyebrow">YOUR HANDOFF</p>
              <h3>Review before sharing</h3>
              <p className="muted">
                Experience proposals go to <strong>{stay.handoff}</strong>. Final formatting and delivery to
                the hotel remain yours.
              </p>
              <div className="action-stack">
                <button
                  disabled={!brief || dirty || busy}
                  onClick={() => void act(() => copy(text), 'Saved brief copied.')}
                >
                  <Copy size={16} />
                  Copy saved text
                </button>
                <button
                  disabled={!brief || dirty || busy}
                  onClick={() => {
                    if (brief) location.href = `/api/stays/${id}/briefs/${brief.id}/export`;
                  }}
                >
                  <Download size={16} />
                  Export .txt
                </button>
              </div>
              {dirty && <p className="fine">Save your edits before copying or exporting.</p>}
            </section>
            <section className="card">
              <h3>Versions</h3>
              {briefs.length ? (
                <div className="versions">
                  {briefs.map((b) => (
                    <button
                      key={b.id}
                      disabled={busy || (stay.status === 'stopped' && b.kind !== 'minimal')}
                      className={b.id === brief?.id ? 'selected' : ''}
                      onClick={() => select(b.id)}
                    >
                      <span>
                        <strong>Version {b.version}</strong>
                        <small>
                          {new Date(b.createdAt).toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          ·{' '}
                          {b.kind === 'minimal'
                            ? 'Minimal record'
                            : b.source === 'historical'
                              ? 'Historical example'
                              : b.source === 'simulation'
                                ? 'Rehearsal'
                                : 'AI draft'}
                        </small>
                      </span>
                      {b.id === brief?.id && <Check size={16} />}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="fine">No brief yet.</p>
              )}
              <button
                className="full"
                disabled={busy || dirty || stay.status !== 'completed' || stay.briefStatus === 'generating'}
                onClick={() =>
                  void act(
                    () => api(`/api/stays/${id}/generate`, 'POST', {}),
                    'New version requested. Previous versions are preserved.',
                  )
                }
              >
                <RefreshCw size={15} />
                Generate a new version
              </button>
              <p className="fine">
                Uses this stay’s original DNA snapshot. Earlier drafts and your saved edits remain intact.
              </p>
            </section>
            {brief && (
              <section className="card metadata">
                <h3>Generation record</h3>
                <dl>
                  <dt>DNA</dt>
                  <dd>Version {brief.dnaVersion}</dd>
                  <dt>Prompt</dt>
                  <dd>{brief.promptVersion}</dd>
                  <dt>Mode</dt>
                  <dd>{brief.source}</dd>
                  <dt>Model</dt>
                  <dd>{brief.model}</dd>
                </dl>
              </section>
            )}
          </aside>
        </div>
      ) : tab === 'conversation' ? (
        <div className="conversation-layout">
          <section className="card transcript">
            <div className="section-heading">
              <div>
                <p className="eyebrow">WHAT THE GUEST SHARED</p>
                <h2>The conversation</h2>
              </div>
              <Badge>{messages.length} messages</Badge>
            </div>
            {messages.map((m) => (
              <article className={`transcript-message ${m.role}`} key={m.id}>
                <span>{m.role === 'user' ? stay.guestName : 'Canopia'}</span>
                <p>{m.content}</p>
              </article>
            ))}
          </section>
          <aside className="stack">
            <section className="card">
              <h3>Reservation context</h3>
              <p>{stay.reservationNotes || 'No additional context supplied.'}</p>
              <p className="fine">
                The conversation receives this context and the hotel DNA, so the guest does not need to repeat
                it.
              </p>
            </section>
            <section className="card">
              <h3>Explicit preferences</h3>
              {stay.facts.length ? (
                stay.facts.map((f, i) => (
                  <div className="fact" key={i}>
                    <strong>{f.label}</strong>
                    <p>{f.value}</p>
                  </div>
                ))
              ) : (
                <p className="fine">No extracted preferences yet.</p>
              )}
            </section>
          </aside>
        </div>
      ) : (
        <div className="brief-layout">
          <section className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">A PERSONAL FIRST HELLO</p>
                <h2>Your invitation</h2>
              </div>
              <Badge tone={invitation?.status === 'sent' ? 'green' : 'neutral'}>
                {invitation?.status || 'Not sent'}
              </Badge>
            </div>
            <label>
              To
              <input readOnly value={stay.email || 'No email supplied for this test'} />
            </label>
            <label>
              Subject
              <input
                maxLength={160}
                value={subject}
                disabled={Boolean(invitationsLocked)}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setInvitationDirty(true);
                }}
              />
            </label>
            <label>
              Message
              <textarea
                className="invitation-text"
                rows={16}
                disabled={Boolean(invitationsLocked)}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setInvitationDirty(true);
                }}
              />
            </label>
            {invitation?.error && <Notice error>{invitation.error}</Notice>}
            <div className="editor-footer">
              <span>Sending always requires your action.</span>
              <button
                className="primary"
                disabled={busy || Boolean(invitationsLocked) || stay.revoked}
                onClick={preview}
              >
                <Check size={16} />
                Save invitation preview
              </button>
            </div>
          </section>
          <aside className="stack">
            <section className="card">
              <Link2 size={22} />
              <h3>The guest’s door</h3>
              <p className="muted">This link opens only this stay. It expires {date(stay.expiresAt)}.</p>
              <div className="action-stack">
                <button
                  disabled={stay.revoked || !link}
                  onClick={() => void act(() => copy(link), 'Guest link copied.')}
                >
                  <Copy size={16} />
                  Copy guest link
                </button>
                <a
                  className={`button ${stay.revoked ? 'disabled' : ''}`}
                  href={stay.revoked ? undefined : link}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open guest view
                  <ArrowUpRight size={15} />
                </a>
              </div>
            </section>
            <section className="card">
              <Mail size={22} />
              <h3>Send when ready</h3>
              <p className="muted">
                {runtime?.emailEnabled
                  ? 'Only explicitly configured test recipients can receive email.'
                  : 'Email sending is disabled. You can prepare and review the invitation now.'}
              </p>
              <button
                className="primary full"
                disabled={
                  busy ||
                  !runtime?.emailEnabled ||
                  !invitation ||
                  invitation.status !== 'preview' ||
                  invitationDirty ||
                  !stay.email ||
                  stay.revoked
                }
                onClick={() =>
                  void act(() => api(`/api/stays/${id}/invitation/send`, 'POST', {}), 'Invitation sent.')
                }
              >
                <Mail size={16} />
                Send invitation
              </button>
            </section>
            <section className="card danger-zone">
              <h3>Stay access</h3>
              <button
                disabled={stay.revoked || busy}
                onClick={() => {
                  if (confirm('Withdraw this guest link? It will stop working immediately.'))
                    void act(() => api(`/api/stays/${id}/revoke`, 'POST', {}), 'Guest access withdrawn.');
                }}
              >
                Withdraw link
              </button>
              <button
                onClick={() => {
                  if (confirm('Delete this stay, its conversation and every brief? This cannot be undone.'))
                    void act(async () => {
                      await api(`/api/stays/${id}`, 'DELETE');
                      onBack();
                    });
                }}
              >
                <Trash2 size={14} />
                Delete stay and data
              </button>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
