import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  ArrowLeft,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Download,
  FileText,
  Leaf,
  LogOut,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { Hotel, RuntimeInfo, Stay, StayDetail as Detail } from '../shared/types.ts';
import { api } from './api.ts';
import { StayWorkspace } from './StayWorkspace.tsx';
import { Guest } from './Guest.tsx';
import { DnaReview } from './DnaReview.tsx';

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Leaf size={23} strokeWidth={1.45} />
      </span>
      canopia<span className="brand-dot">.</span>
    </span>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div role={error ? 'alert' : 'status'} className={`notice ${error ? 'error' : ''}`}>
      {children}
    </div>
  );
}
export function App() {
  const guestToken = location.pathname.match(/^\/g\/([^/]+)$/)?.[1];
  const [auth, setAuth] = useState<{
      authenticated: boolean;
      needsSetup: boolean;
      setupAllowed: boolean;
    } | null>(null),
    [error, setError] = useState('');
  async function refreshAuth() {
    try {
      setAuth(await api('/api/auth/status'));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!guestToken) void refreshAuth();
  }, []);
  if (guestToken) return <Guest token={guestToken} />;
  if (error)
    return (
      <div className="center-screen">
        <Notice error>{error}</Notice>
        <button onClick={() => location.reload()}>Retry</button>
      </div>
    );
  if (!auth)
    return (
      <div className="center-screen">
        <Brand />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!auth.authenticated)
    return <SignIn setup={auth.needsSetup} setupAllowed={auth.setupAllowed} done={refreshAuth} />;
  return (
    <Console
      logout={async () => {
        await api('/api/auth/logout', 'POST', {});
        await refreshAuth();
      }}
    />
  );
}
function SignIn({
  setup,
  setupAllowed,
  done,
}: {
  setup: boolean;
  setupAllowed: boolean;
  done: () => Promise<void>;
}) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (setup && password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/auth/${setup ? 'setup' : 'login'}`, 'POST', { email, password });
      await done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div>
          <p className="eyebrow">THE SPACE BEFORE ARRIVAL</p>
          <h1>
            Good hospitality
            <br />
            starts with
            <br />
            <em>understanding.</em>
          </h1>
          <p>
            A conversation that listens.
            <br />A brief that helps your team care.
          </p>
        </div>
        <span className="fine">Once Upon a Stay · Canopia workbench</span>
      </section>
      <main className="auth-form">
        <div>
          <span className="section-number">01 / YOUR WORKSPACE</span>
          <h2>{setup ? 'Make yourself at home.' : 'Welcome back.'}</h2>
          <p className="muted">
            {setup
              ? 'Create the operator account for this installation.'
              : 'Sign in to prepare the next stay.'}
          </p>
          {error && <Notice error>{error}</Notice>}
          {setup && !setupAllowed ? (
            <Notice>Initial setup is available from the local installation only.</Notice>
          ) : (
            <form onSubmit={submit}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete={setup ? 'new-password' : 'current-password'}
                  minLength={12}
                  maxLength={200}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              {setup && (
                <>
                  <span className="fine">
                    Use at least 12 characters. This protects access to all six hotels.
                  </span>
                  <label>
                    Confirm password
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      required
                    />
                  </label>
                </>
              )}
              <button className="primary full" disabled={busy}>
                {busy ? 'Opening…' : setup ? 'Create operator account' : 'Sign in'}
                <ArrowUpRight size={17} />
              </button>
            </form>
          )}
          <p className="auth-foot">
            <ShieldCheck size={15} /> One private console. Each stay kept in context.
          </p>
        </div>
      </main>
    </div>
  );
}

function Console({ logout }: { logout: () => Promise<void> }) {
  const [tab, setTab] = useState<'stays' | 'hotels' | 'settings'>('stays'),
    [stays, setStays] = useState<Stay[]>([]),
    [hotels, setHotels] = useState<Hotel[]>([]),
    [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [newStay, setNewStay] = useState(false),
    [query, setQuery] = useState(''),
    [hotelFilter, setHotelFilter] = useState('all'),
    [statusFilter, setStatusFilter] = useState('all'),
    [error, setError] = useState(''),
    [dirty, setDirty] = useState(false),
    [exampleBusy, setExampleBusy] = useState(false);
  async function refresh() {
    try {
      const [a, b, c] = await Promise.all([
        api<Stay[]>('/api/stays'),
        api<Hotel[]>('/api/hotels'),
        api<RuntimeInfo>('/api/runtime'),
      ]);
      setStays(a);
      setHotels(b);
      setRuntime(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  function navigate(next: typeof tab, id: string | null = null) {
    if (dirty && !confirm('Leave this view without saving your edits?')) return;
    setDirty(false);
    setTab(next);
    setSelected(id);
    void refresh();
  }
  async function example(exampleId = 'prague-anniversary') {
    setExampleBusy(true);
    try {
      const result = await api<Detail>(`/api/examples/${exampleId}`, 'POST', {});
      setSelected(result.stay.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExampleBusy(false);
    }
  }
  const filtered = stays.filter(
    (s) =>
      (hotelFilter === 'all' || s.hotelId === hotelFilter) &&
      (statusFilter === 'all' ||
        (statusFilter === 'review' ? s.briefStatus === 'ready' : s.status === statusFilter)) &&
      `${s.guestName} ${s.hotelName}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">OPERATOR WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button className={tab === 'stays' ? 'active' : ''} onClick={() => navigate('stays')}>
            <CalendarDays size={18} />
            Stays<span>{stays.length}</span>
          </button>
          <button className={tab === 'hotels' ? 'active' : ''} onClick={() => navigate('hotels')}>
            <Building2 size={18} />
            Hotel DNA<span>{hotels.length}</span>
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}>
            <Settings2 size={18} />
            Connections
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="little-leaf">
            <Leaf size={22} />
          </span>
          <p>
            Different hotels.
            <br />
            Different possibilities.
          </p>
          <span>One place to prepare each stay.</span>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">JC</span>
          <div>
            <strong>Operator</strong>
            <span>Private workspace</span>
          </div>
          <button
            aria-label="Sign out"
            className="icon-button"
            onClick={() => {
              if (!dirty || confirm('Discard unsaved edits and sign out?')) void logout();
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            {tab === 'hotels'
              ? 'Know the hotel. Understand the possibilities.'
              : tab === 'settings'
                ? 'Your workspace, connected.'
                : 'A little understanding goes a long way.'}
          </span>
          <Badge tone="green">
            <span className="status-dot" />
            Local preparation
          </Badge>
        </header>
        <main className="main-content">
          {error && <Notice error>{error}</Notice>}
          {selected && tab === 'stays' ? (
            <StayWorkspace
              id={selected}
              runtime={runtime}
              onBack={() => navigate('stays')}
              onDirty={setDirty}
            />
          ) : tab === 'stays' ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">BEFORE THE WELCOME</p>
                  <h1>Your stays</h1>
                  <p className="muted">Bring the guest’s wishes and the hotel’s know-how together.</p>
                </div>
                <button className="primary" onClick={() => setNewStay(true)}>
                  <Plus size={17} />
                  New stay
                </button>
              </div>
              <div className="metrics">
                <Metric
                  label="Across your collection"
                  value={String(hotels.length).padStart(2, '0')}
                  detail="hotels, each with its own DNA"
                />
                <Metric
                  label="Conversations open"
                  value={String(
                    stays.filter((s) => ['draft', 'invited', 'in_progress'].includes(s.status)).length,
                  ).padStart(2, '0')}
                  detail="space for guests to share"
                />
                <Metric
                  label="Ready for your attention"
                  value={String(stays.filter((s) => s.briefStatus === 'ready').length).padStart(2, '0')}
                  detail="briefs to read and refine"
                />
              </div>
              {runtime?.aiMode !== 'openai' && (
                <div className="connection-strip">
                  <span className="status-dot amber" />
                  <span>
                    {runtime?.aiMode === 'simulation'
                      ? 'Local rehearsal: replies are scripted. No AI calls or emails are sent.'
                      : 'AI is not connected yet. You can prepare hotel DNA, stays and invitations.'}
                  </span>
                  <button className="text-button" onClick={() => navigate('settings')}>
                    View connections
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              )}
              <div className="example-actions card">
                <p className="eyebrow">RECORDED FICTIONAL CASES</p>
                <p>Load a complete conversation and its saved AI brief. No new AI call.</p>
                <div className="research-actions">
                  <button disabled={exampleBusy} onClick={() => void example('family-anniversary')}>
                    Load family example
                  </button>
                  <button disabled={exampleBusy} onClick={() => void example('prague-anniversary')}>
                    Load Prague example
                  </button>
                  <button disabled={exampleBusy} onClick={() => void example('work-and-running')}>
                    Load running example
                  </button>
                </div>
              </div>
              <section className="stays-panel">
                <div className="panel-toolbar">
                  <div className="segmented" role="group" aria-label="Filter stays">
                    <button
                      className={statusFilter === 'all' ? 'selected' : ''}
                      onClick={() => setStatusFilter('all')}
                    >
                      All stays
                    </button>
                    <button
                      className={statusFilter === 'in_progress' ? 'selected' : ''}
                      onClick={() => setStatusFilter('in_progress')}
                    >
                      In conversation
                    </button>
                    <button
                      className={statusFilter === 'review' ? 'selected' : ''}
                      onClick={() => setStatusFilter('review')}
                    >
                      Brief ready
                    </button>
                  </div>
                  <div className="toolbar-right">
                    <select
                      aria-label="Filter by hotel"
                      value={hotelFilter}
                      onChange={(e) => setHotelFilter(e.target.value)}
                    >
                      <option value="all">All hotels</option>
                      {hotels.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                    <label className="search-input">
                      <Search size={16} />
                      <input
                        aria-label="Search stays"
                        placeholder="Find a guest…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                </div>
                {filtered.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Guest & stay</th>
                          <th>Hotel</th>
                          <th>Dates</th>
                          <th>Progress</th>
                          <th>
                            <span className="sr-only">Open</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <button className="row-link" onClick={() => setSelected(s.id)}>
                                {s.guestName}
                              </button>
                              <div className="row-sub">
                                {s.partySize} {s.partySize === 1 ? 'guest' : 'guests'}
                                {s.demo ? ' · Fictional test' : ''}
                              </div>
                            </td>
                            <td>{s.hotelName}</td>
                            <td>
                              {date(s.arrival)}
                              <span className="date-arrow">→</span>
                              {date(s.departure)}
                            </td>
                            <td>
                              <StayBadge stay={s} />
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`Open ${s.guestName}`}
                                onClick={() => setSelected(s.id)}
                              >
                                <ChevronRight size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <CalendarDays size={30} strokeWidth={1.25} />
                    </span>
                    <h2>
                      {stays.length
                        ? 'No stays match these filters.'
                        : 'Your next thoughtful stay starts here.'}
                    </h2>
                    <p>
                      {stays.length
                        ? 'Try another guest name or hotel.'
                        : 'Choose a hotel, add the reservation and prepare a personal invitation.'}
                    </p>
                    <button className="primary" onClick={() => setNewStay(true)}>
                      <Plus size={16} />
                      Create a stay
                    </button>
                    {!stays.length && (
                      <button className="text-button" disabled={exampleBusy} onClick={() => void example()}>
                        {exampleBusy ? 'Loading…' : 'Or load the recorded Prague example'}
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                  </div>
                )}
              </section>
              <div className="workspace-foot">
                <span>
                  <ShieldCheck size={15} />
                  The hotel makes the final call.
                </span>
                <span>Invitation → conversation → brief → human review</span>
              </div>
            </>
          ) : tab === 'hotels' ? (
            <Hotels hotels={hotels} refresh={refresh} onDirty={setDirty} />
          ) : (
            <Connections runtime={runtime} />
          )}
        </main>
      </div>
      {newStay && (
        <NewStay
          hotels={hotels}
          runtime={runtime}
          close={() => setNewStay(false)}
          created={async (s) => {
            setNewStay(false);
            setSelected(s.id);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export function date(s: string) {
  return new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}
export function StayBadge({ stay }: { stay: Stay }) {
  return (
    <Badge
      tone={
        stay.status === 'stopped'
          ? 'red'
          : stay.briefStatus === 'ready'
            ? 'green'
            : stay.briefStatus === 'failed'
              ? 'red'
              : stay.status === 'in_progress'
                ? 'amber'
                : 'neutral'
      }
    >
      {stay.status === 'stopped'
        ? 'Personalization declined'
        : stay.briefStatus === 'ready'
          ? 'Brief ready'
          : stay.briefStatus === 'generating'
            ? 'Preparing brief'
            : stay.briefStatus === 'failed'
              ? 'Generation failed'
              : stay.status === 'draft'
                ? 'Invitation to prepare'
                : stay.status === 'in_progress'
                  ? 'In conversation'
                  : stay.status === 'invited'
                    ? 'Invitation sent'
                    : stay.status}
    </Badge>
  );
}

function NewStay({
  hotels,
  runtime,
  close,
  created,
}: {
  hotels: Hotel[];
  runtime: RuntimeInfo | null;
  close: () => void;
  created: (s: Stay) => Promise<void>;
}) {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    later = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const [values, setValues] = useState({
      hotelId: '',
      guestName: '',
      email: '',
      arrival: tomorrow,
      departure: later,
      partySize: 2,
      reservationNotes: '',
      handoff: '',
      demo: true,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const hotel = hotels.find((h) => h.id === values.hotelId);
  const change = (name: string, value: unknown) => setValues((v) => ({ ...v, [name]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await created(await api<Stay>('/api/stays', 'POST', values));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="new-stay-title">
        <header>
          <div>
            <p className="eyebrow">A NEW ARRIVAL</p>
            <h2 id="new-stay-title">Prepare a stay</h2>
          </div>
          <button className="icon-button" aria-label="Close new stay" onClick={close}>
            <X size={21} />
          </button>
        </header>
        <form onSubmit={submit}>
          {error && <Notice error>{error}</Notice>}
          <label>
            Hotel
            <select
              required
              value={values.hotelId}
              onChange={(e) => {
                const h = hotels.find((h) => h.id === e.target.value);
                setValues((v) => ({
                  ...v,
                  hotelId: e.target.value,
                  handoff:
                    h?.conciergeStatus === 'present'
                      ? 'concierge'
                      : h?.conciergeStatus === 'absent'
                        ? 'reception'
                        : '',
                }));
              }}
            >
              <option value="">Choose the hotel</option>
              {hotels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} · {h.city}
                </option>
              ))}
            </select>
          </label>
          {hotel && !hotel.reviewed && (
            <p className="inline-note">
              This hotel DNA still needs operator review. It is a preparation source, not a confirmed
              operating profile.
            </p>
          )}
          <label>
            Guest name
            <input
              required
              value={values.guestName}
              maxLength={150}
              onChange={(e) => change('guestName', e.target.value)}
              placeholder="Name on the reservation"
            />
          </label>
          <label>
            Email <span className="optional">optional for a local test</span>
            <input
              type="email"
              value={values.email}
              onChange={(e) => change('email', e.target.value)}
              placeholder="guest@example.com"
            />
          </label>
          <div className="form-grid">
            <label>
              Arrival
              <input
                type="date"
                required
                value={values.arrival}
                onChange={(e) => change('arrival', e.target.value)}
              />
            </label>
            <label>
              Departure
              <input
                type="date"
                required
                min={values.arrival}
                value={values.departure}
                onChange={(e) => change('departure', e.target.value)}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Number of guests
              <input
                type="number"
                min={1}
                max={100}
                required
                value={values.partySize}
                onChange={(e) => change('partySize', Number(e.target.value))}
              />
            </label>
            <label>
              Experience handoff
              <select required value={values.handoff} onChange={(e) => change('handoff', e.target.value)}>
                <option value="">Choose the responsible role</option>
                {hotel?.conciergeStatus !== 'absent' && <option value="concierge">Concierge</option>}
                <option value="reception">Reception</option>
              </select>
            </label>
          </div>
          {hotel?.conciergeStatus === 'unknown' && (
            <p className="fine">
              The hotel's concierge role is unconfirmed. Your choice assigns this stay; it does not confirm
              the hotel's organisation.
            </p>
          )}
          <label>
            Reservation context
            <textarea
              rows={3}
              value={values.reservationNotes}
              maxLength={5000}
              onChange={(e) => change('reservationNotes', e.target.value)}
              placeholder="What is already known, so the guest does not have to repeat it."
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={values.demo}
              disabled={!runtime?.realStaysEnabled}
              onChange={(e) => change('demo', e.target.checked)}
            />
            Fictional test stay
          </label>
          <p className="fine">
            Creating the stay does not send an email. The hotel and DNA version are fixed for this
            conversation.
          </p>
          <footer>
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create stay'}
              <ArrowUpRight size={16} />
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function Hotels({
  hotels,
  refresh,
  onDirty,
}: {
  hotels: Hotel[];
  refresh: () => Promise<void>;
  onDirty: (v: boolean) => void;
}) {
  const [selected, setSelected] = useState<Hotel | null>(null),
    [editing, setEditing] = useState(false),
    [dna, setDna] = useState(''),
    [role, setRole] = useState<Hotel['conciergeStatus']>('unknown'),
    [reviewed, setReviewed] = useState(false),
    [documents, setDocuments] = useState<Hotel['documents']>([]),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState('');
  const mark = () => {
    setDirty(true);
    onDirty(true);
    setSaved('');
  };
  function open(h: Hotel | null) {
    if (dirty && !confirm('Discard unsaved DNA edits?')) return;
    setSelected(h);
    setEditing(false);
    setDna(h?.dna || '');
    setRole(h?.conciergeStatus || 'unknown');
    setReviewed(h?.reviewed || false);
    setDocuments(h?.documents || []);
    setDirty(false);
    onDirty(false);
    setSaved('');
    setError('');
  }
  async function save() {
    if (!selected) return;
    try {
      const result = await api<Hotel>(`/api/hotels/${selected.id}`, 'PUT', {
        dna,
        conciergeStatus: role,
        reviewed,
        documents,
        version: selected.version,
      });
      setSelected(result);
      setDirty(false);
      onDirty(false);
      setSaved('New DNA version saved. Existing stays keep their original version.');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function attach(file: File | undefined) {
    if (!file) return;
    if (file.size > 40000 || !/\.(txt|md)$/i.test(file.name)) {
      setError('Use a .txt or .md source under 40 KB.');
      return;
    }
    if (documents.length >= 8) {
      setError('Use up to eight supporting documents per DNA version.');
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        setError('This source is empty.');
        return;
      }
      setDocuments((v) => [...v, { id: crypto.randomUUID(), name: file.name, text }]);
      mark();
    } catch {
      setError('The source could not be read.');
    }
  }
  if (selected)
    return (
      <>
        <button className="back-link" onClick={() => open(null)}>
          <ArrowLeft size={16} />
          All hotels
        </button>
        <div className="page-heading">
          <div>
            <p className="eyebrow">
              {selected.city} · DNA VERSION {selected.version}
            </p>
            <h1>{selected.name}</h1>
            <p className="muted">Identity, expertise, resources and room for adaptation.</p>
          </div>
          <button className="primary" onClick={save} disabled={!dirty}>
            <Check size={17} />
            Save new version
          </button>
        </div>
        {error && <Notice error>{error}</Notice>}
        {saved && <Notice>{saved}</Notice>}
        <div className="dna-layout">
          <section className="card dna-editor">
            <div className="dna-view-switch" role="group" aria-label="DNA display">
              <button type="button" aria-pressed={!editing} onClick={() => setEditing(false)}>
                Read profile
              </button>
              <button type="button" aria-pressed={editing} onClick={() => setEditing(true)}>
                Edit text
              </button>
            </div>
            {!editing ? (
              <DnaReview text={dna} key={`${selected.id}-${selected.version}`} />
            ) : (
              <label>
                Hotel DNA
                <textarea
                  aria-label="Hotel DNA text"
                  value={dna}
                  onChange={(e) => {
                    setDna(e.target.value);
                    mark();
                  }}
                  rows={28}
                />
              </label>
            )}
          </section>
          <aside className="stack">
            <section className="card">
              <h3>People & responsibilities</h3>
              <label>
                Concierge
                <select
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value as Hotel['conciergeStatus']);
                    mark();
                  }}
                >
                  <option value="unknown">Not yet confirmed</option>
                  <option value="present">Present</option>
                  <option value="absent">Absent — route to reception</option>
                </select>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => {
                    setReviewed(e.target.checked);
                    mark();
                  }}
                />
                Reviewed by the operator
              </label>
              <p className="fine">
                Operator review is separate from confirmation by the hotel. Operational confirmation: not
                established.
              </p>
            </section>
            <section className="card">
              <details className="dna-sources">
                <summary>Reference sources ({selected.sources.length})</summary>
                {selected.sources.map((s, i) => (
                  <a className="source-link" href={s.url} target="_blank" rel="noreferrer" key={i}>
                    {s.title}
                    <ArrowUpRight size={14} />
                    <small>
                      {s.status} · checked {s.checkedAt}
                    </small>
                  </a>
                ))}
              </details>
            </section>
            <section className="card">
              <h3>Supporting documents</h3>
              <p className="fine">
                Attach a text or Markdown extract. The content becomes part of the next DNA version.
              </p>
              {documents.map((d) => (
                <div className="document-row" key={d.id}>
                  <FileText size={15} />
                  <span>{d.name}</span>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${d.name}`}
                    onClick={() => {
                      setDocuments((v) => v.filter((x) => x.id !== d.id));
                      mark();
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <label className="file-label">
                Add a text source
                <input
                  type="file"
                  accept=".txt,.md"
                  onChange={(e) => {
                    void attach(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            </section>
          </aside>
        </div>
      </>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE COLLECTION</p>
          <h1>Six hotels. Six distinct worlds.</h1>
          <p className="muted">A living understanding of what each team can make possible.</p>
        </div>
      </div>
      <div className="hotel-grid">
        {hotels.map((h, i) => (
          <button className="hotel-card" key={h.id} onClick={() => open(h)}>
            <div className={`hotel-art art-${i % 3}`}>
              <span>{h.city}</span>
              <span className="hotel-initial">
                {h.name.replace(/^(The |Hotel |Hôtel |Le )/, '').slice(0, 1)}
              </span>
              <ArrowUpRight size={20} />
            </div>
            <div className="hotel-card-body">
              <span className="eyebrow">{h.country}</span>
              <h2>{h.name}</h2>
              <div>
                <Badge tone={h.reviewed ? 'green' : 'amber'}>
                  {h.reviewed ? 'Operator reviewed' : 'To review'}
                </Badge>
                <span className="fine">DNA v{h.version}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
      <p className="workspace-foot">
        Public sources and historical profiles are preparation material. Hotel feasibility remains a human
        decision.
      </p>
    </>
  );
}

function Connections({ runtime }: { runtime: RuntimeInfo | null }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE WORKSPACE</p>
          <h1>Ready locally. Connect when needed.</h1>
          <p className="muted">External services stay disabled until their access and use are agreed.</p>
        </div>
      </div>
      <div className="connections-grid">
        <section className="card">
          <Leaf size={24} />
          <h2>Conversation & briefs</h2>
          <Badge tone={runtime?.aiConfigured ? 'green' : 'amber'}>
            {runtime?.aiMode === 'simulation'
              ? 'Scripted rehearsal'
              : runtime?.aiConfigured
                ? 'OpenAI enabled'
                : 'Not connected'}
          </Badge>
          <p>
            One API connection powers the conversation and brief generation. The full hotel DNA is used in
            both.
          </p>
          <p className="fine">
            {runtime?.model
              ? `Model: ${runtime.model}`
              : 'Choose an API project, a model and a spending limit before activation.'}
          </p>
          {runtime?.aiBudget && (
            <>
              <p>
                <strong>Trial budget: USD {runtime.aiBudget.limitUsd.toFixed(2)}</strong>
                <br />
                USD {runtime.aiBudget.accountedUsd.toFixed(3)} accounted · USD{' '}
                {runtime.aiBudget.remainingUsd.toFixed(3)} remaining
              </p>
              <p className="fine">
                Conservative local allowance, including pending or uncertain calls. The provider invoice may
                be lower. New calls stop before their maximum cost would exceed this allowance.
              </p>
              {runtime.aiBudget.blocked && (
                <Notice error>AI calls are paused. Review the trial budget before continuing.</Notice>
              )}
            </>
          )}
        </section>
        <section className="card">
          <CalendarDays size={24} />
          <h2>Invitations</h2>
          <Badge tone={runtime?.emailEnabled ? 'green' : 'neutral'}>
            {runtime?.emailEnabled ? 'Test sending enabled' : 'Preview only'}
          </Badge>
          <p>
            Prepare a personal invitation and review the recipient. Sending always requires an operator
            action.
          </p>
          <p className="fine">
            The existing email account will be connected before a test to an explicitly authorised address.
          </p>
        </section>
        <section className="card">
          <ShieldCheck size={24} />
          <h2>Stay records</h2>
          <Badge tone="green">
            {runtime?.database === 'postgres' ? 'PostgreSQL connected' : 'Local PostgreSQL'}
          </Badge>
          <p>Conversations, DNA versions and saved briefs persist on this installation.</p>
          <p className="fine">
            Real stays:{' '}
            {runtime?.realStaysEnabled ? 'enabled' : 'disabled until retention and access rules are agreed'}.
            No hotel is contacted by this workspace automatically.
          </p>
        </section>
      </div>
      <section className="card setup-note">
        <h3>What comes next</h3>
        <p>
          Connect the API, verify a real generation on a fictional stay, then test email on an address you
          control. Hosting and the online database are a separate step before inviting travellers.
        </p>
        <p className="fine">
          Final formatting and delivery to the hotel remain manual. Live research adapters are not active.
        </p>
      </section>
    </>
  );
}
