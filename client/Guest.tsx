import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Check, Leaf, RefreshCw } from 'lucide-react';
import type { GuestView } from '../shared/types.ts';
import { api } from './api.ts';
import { Brand, Notice, date } from './App.tsx';
export function Guest({ token }: { token: string }) {
  const [view, setView] = useState<GuestView | null>(null),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stopping, setStopping] = useState(false);
  const end = useRef<HTMLDivElement>(null),
    draftId = useRef(crypto.randomUUID());
  const endpoint = `/api/guest/${token}`;
  useEffect(() => {
    api<GuestView>(endpoint)
      .then(setView)
      .catch((e) => setError(e.message));
  }, [token]);
  useEffect(() => {
    if (!view?.busy) return;
    const interval = setInterval(() => {
      void api<GuestView>(endpoint)
        .then(setView)
        .catch((e) => setError(e.message));
    }, 1500);
    return () => clearInterval(interval);
  }, [view?.busy, endpoint]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [view?.messages.length, busy]);
  async function action(path: string, body: unknown = {}) {
    setBusy(true);
    setError('');
    try {
      setView(await api<GuestView>(endpoint + path, 'POST', body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    const sent = text;
    setBusy(true);
    setError('');
    try {
      const result = await api<GuestView>(endpoint + '/messages', 'POST', {
        content: sent,
        clientId: draftId.current,
      });
      setView(result);
      setText('');
      draftId.current = crypto.randomUUID();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!view)
    return (
      <div className="guest-shell">
        <header>
          <Brand />
        </header>
        <div className="guest-unavailable">
          <Leaf size={35} />
          <h1>{error ? 'This invitation is not available.' : 'Preparing your welcome…'}</h1>
          <p>{error || 'One moment, please.'}</p>
        </div>
      </div>
    );
  const ended = ['completed', 'stopped'].includes(view.status);
  return (
    <div className="guest-shell">
      <header className="guest-header">
        <Brand />
        <span>YOUR STAY, THOUGHTFULLY PREPARED</span>
      </header>
      {view.demo && (
        <div className="guest-demo">
          Fictional test stay ·{' '}
          {view.aiMode === 'simulation'
            ? 'scripted rehearsal, no AI call'
            : view.aiMode === 'disabled'
              ? 'AI connection not enabled'
              : 'AI connected'}
        </div>
      )}
      <main className="guest-main">
        <div className="guest-intro">
          <p className="eyebrow">{view.hotelName}</p>
          <h1>{ended ? 'Thank you for sharing.' : 'A little about you.'}</h1>
          <p>
            {date(view.arrival)} — {date(view.departure)} · {view.partySize}{' '}
            {view.partySize === 1 ? 'guest' : 'guests'}
          </p>
          <div className="guest-divider">
            <Leaf size={18} />
          </div>
        </div>
        {error && <Notice error>{error}</Notice>}
        {ended ? (
          <section className="guest-done">
            <span className="done-icon">
              <Check size={26} />
            </span>
            <h2>{view.status === 'stopped' ? 'Your wish is clear.' : 'A thoughtful welcome starts here.'}</h2>
            <p>
              {view.status === 'stopped'
                ? 'The team will receive a minimal record with a prominent note that you do not want your information used for personalization. No new experience suggestions will be prepared.'
                : 'Your conversation has been saved for human review. The team will consider what you shared when preparing your stay.'}
            </p>
            <p className="muted">
              {view.status === 'stopped'
                ? 'You can contact the hotel directly if you would prefer a conversation with a person.'
                : 'Nothing has been booked or promised. You can close this page.'}
            </p>
          </section>
        ) : (
          <>
            <div className="guest-messages" aria-live="polite">
              {view.messages.map((m) => (
                <article className={`guest-message ${m.role}`} key={m.id}>
                  {m.role === 'assistant' && (
                    <span className="message-mark">
                      <Leaf size={15} />
                    </span>
                  )}
                  <div>
                    <span className="message-author">
                      {m.role === 'assistant' ? 'Canopia' : view.guestName.split(' ')[0]}
                    </span>
                    <p>{m.content}</p>
                  </div>
                </article>
              ))}
              {busy && (
                <div className="typing" role="status">
                  Preparing a reply
                  <span />
                  <span />
                  <span />
                </div>
              )}
              <div ref={end} />
            </div>
            {view.chatError && (
              <Notice error>
                {view.chatError}
                <button onClick={() => void action('/retry')} disabled={busy || view.busy}>
                  <RefreshCw size={14} />
                  Retry reply
                </button>
              </Notice>
            )}
            <form className="guest-composer" onSubmit={send}>
              <label className="sr-only" htmlFor="guest-answer">
                Your message
              </label>
              <textarea
                id="guest-answer"
                placeholder="Share what comes to mind…"
                value={text}
                maxLength={6000}
                rows={2}
                disabled={busy || view.busy}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(e);
                  }
                }}
              />
              <button
                className="send-button"
                disabled={busy || view.busy || !text.trim()}
                aria-label="Send message"
              >
                <ArrowUp size={20} />
              </button>
            </form>
            <div className="guest-actions">
              <span>No perfect answers needed.</span>
              {view.messages.some((m) => m.role === 'user') && (
                <button
                  className={view.readyToFinish ? 'primary' : 'text-button'}
                  disabled={busy || view.busy || Boolean(view.chatError)}
                  onClick={() => void action('/finish')}
                >
                  Finish and share
                  <Check size={15} />
                </button>
              )}
            </div>
            <details className="guest-privacy">
              <summary>About this conversation</summary>
              <p>
                Sharing is optional. Your answers help the operator and hotel team understand this stay, with
                human review before any preparation. You can skip a question or stop. If you decline
                personalization, a minimal record will clearly state that wish.
              </p>
              <p>No bookings or purchases are made here. Contact the hotel directly if you prefer.</p>
            </details>
            {stopping ? (
              <div className="stop-confirm">
                <p>Stop the exchange and tell the team not to use your answers for personalization?</p>
                <div>
                  <button onClick={() => setStopping(false)}>Continue conversation</button>
                  <button
                    className="danger-button"
                    onClick={() => {
                      setStopping(false);
                      void action('/stop');
                    }}
                  >
                    Stop personalization
                  </button>
                </div>
              </div>
            ) : (
              <button className="guest-stop" onClick={() => setStopping(true)}>
                I’d prefer to stop personalization
              </button>
            )}
          </>
        )}
      </main>
      <footer className="guest-footer">Prepared with care. Always in human hands.</footer>
    </div>
  );
}
