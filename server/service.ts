import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import type { Database, Queryable } from './db.ts';
import type { Config } from './config.ts';
import type {
  AiProvider,
  Brief,
  Fact,
  GenerationInput,
  GuestView,
  Hotel,
  Invitation,
  Message,
  Stay,
  StayDetail,
} from '../shared/types.ts';
import { AppError, assert, hash, seal, token, unseal } from './security.ts';
import { briefPromptVersion, minimalBrief, withdrawalNotice } from './ai.ts';
import { discoveryReady, groundedDiscovery } from './discovery.ts';

type StayRow = { data: Stay; hotel_snapshot: Hotel; token_cipher: string; chat_busy: boolean };
const now = () => new Date().toISOString();
const json = JSON.stringify;
export class CanopiaService {
  private jobs = new Set<Promise<unknown>>();
  private requests = new Map<string, AbortController>();
  constructor(
    public db: Database,
    public config: Config,
    public ai: AiProvider,
  ) {}
  async idle() {
    await Promise.allSettled([...this.jobs]);
  }
  async hotels() {
    return (await this.db.query<{ data: Hotel }>("SELECT data FROM hotels ORDER BY data->>'name'")).rows.map(
      (r) => r.data,
    );
  }
  async hotel(id: string, db: Queryable = this.db) {
    const r = (await db.query<{ data: Hotel }>('SELECT data FROM hotels WHERE id=$1', [id])).rows[0];
    assert(r, 404, 'Hotel not found.');
    return r.data;
  }
  async saveHotel(
    id: string,
    values: Pick<Hotel, 'dna' | 'conciergeStatus' | 'reviewed' | 'documents'>,
    expectedVersion: number,
  ) {
    return this.db.transaction(async (tx) => {
      const result = (await tx.query<{ data: Hotel }>('SELECT data FROM hotels WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      assert(result, 404, 'Hotel not found.');
      assert(
        result.data.version === expectedVersion,
        409,
        'This hotel DNA changed in another window. Reload before saving.',
      );
      const hotel: Hotel = { ...result.data, ...values, version: expectedVersion + 1 };
      await tx.query('UPDATE hotels SET data=$2 WHERE id=$1', [id, json(hotel)]);
      await tx.query('INSERT INTO dna_versions(hotel_id,version,data) VALUES($1,$2,$3)', [
        id,
        hotel.version,
        json(hotel),
      ]);
      return hotel;
    });
  }
  async row(id: string, db: Queryable = this.db, lock = false): Promise<StayRow> {
    const row = (
      await db.query<StayRow>(
        `SELECT data,hotel_snapshot,token_cipher,chat_busy FROM stays WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
        [id],
      )
    ).rows[0];
    assert(row, 404, 'Stay not found.');
    return row;
  }
  async patch(tx: Queryable, id: string, updates: Partial<Stay>) {
    const row = await this.row(id, tx, true);
    const data = { ...row.data, ...updates, revision: row.data.revision + 1, updatedAt: now() };
    await tx.query('UPDATE stays SET data=$2 WHERE id=$1', [id, json(data)]);
    return data;
  }
  async stays() {
    return (
      await this.db.query<{ data: Stay }>("SELECT data FROM stays ORDER BY data->>'createdAt' DESC")
    ).rows.map((r) => r.data);
  }
  async messages(id: string) {
    return (
      await this.db.query<{ data: Message }>('SELECT data FROM messages WHERE stay_id=$1 ORDER BY sequence', [
        id,
      ])
    ).rows.map((r) => r.data);
  }
  async detail(id: string): Promise<StayDetail> {
    const [row, messages, briefs, invitations] = await Promise.all([
      this.row(id),
      this.messages(id),
      this.db.query<{ data: Brief }>(
        "SELECT data FROM briefs WHERE stay_id=$1 ORDER BY (data->>'version')::integer DESC",
        [id],
      ),
      this.db.query<{ data: Invitation }>('SELECT data FROM invitations WHERE stay_id=$1', [id]),
    ]);
    return {
      stay: row.data,
      messages,
      briefs: briefs.rows.map((r) => r.data),
      invitations: invitations.rows.map((r) => r.data),
    };
  }
  async createStay(
    values: Pick<
      Stay,
      | 'hotelId'
      | 'guestName'
      | 'email'
      | 'arrival'
      | 'departure'
      | 'partySize'
      | 'reservationNotes'
      | 'handoff'
      | 'demo'
    >,
  ) {
    assert(
      values.demo || this.config.realStays,
      409,
      'Real stays remain disabled until data rules and provider access are configured.',
    );
    assert(
      values.demo || this.ai.name !== 'simulation',
      409,
      'Scripted rehearsal cannot be used for real stays.',
    );
    const hotel = await this.hotel(values.hotelId);
    assert(
      hotel.conciergeStatus !== 'absent' || values.handoff === 'reception',
      400,
      'This hotel has no concierge. Select reception.',
    );
    const id = randomUUID(),
      rawToken = token(),
      createdAt = now();
    const stay: Stay = {
      ...values,
      id,
      hotelName: hotel.name,
      status: 'draft',
      briefStatus: 'none',
      dnaVersion: hotel.version,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(Date.now() + this.config.guestLinkDays * 86400000).toISOString(),
      revoked: false,
      facts: [],
      chatError: null,
      briefError: null,
      readyToFinish: false,
      selectedBriefId: null,
      revision: 1,
    };
    const intro: Message = {
      id: randomUUID(),
      role: 'assistant',
      createdAt,
      content: `Hello ${values.guestName.split(' ')[0]}! I'd love to get to know you a little before your stay at ${hotel.name}, so the team can think about the details that matter to you. This chat is optional; you can skip a question or finish whenever you like. What brings you here this time?`,
    };
    await this.db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO stays(id,hotel_id,data,token_hash,token_cipher,hotel_snapshot) VALUES($1,$2,$3,$4,$5,$6)',
        [id, hotel.id, json(stay), hash(rawToken), seal(rawToken, this.config.secret), json(hotel)],
      );
      await tx.query('INSERT INTO messages(id,stay_id,data) VALUES($1,$2,$3)', [intro.id, id, json(intro)]);
    });
    return stay;
  }
  async guestLink(id: string) {
    const row = await this.row(id);
    return `${this.config.origin}/g/${unseal(row.token_cipher, this.config.secret)}`;
  }
  async guestRow(rawToken: string) {
    assert(/^[A-Za-z0-9_-]{43}$/.test(rawToken), 404, 'This invitation could not be found.');
    const result = (
      await this.db.query<StayRow>(
        'SELECT data,hotel_snapshot,token_cipher,chat_busy FROM stays WHERE token_hash=$1',
        [hash(rawToken)],
      )
    ).rows[0];
    assert(result, 404, 'This invitation could not be found.');
    assert(
      !result.data.revoked && Date.parse(result.data.expiresAt) > Date.now(),
      410,
      'This invitation has expired or was withdrawn. Please contact the hotel.',
    );
    return result;
  }
  async guest(rawToken: string): Promise<GuestView> {
    const { data: stay, chat_busy } = await this.guestRow(rawToken);
    return {
      hotelName: stay.hotelName,
      guestName: stay.guestName,
      arrival: stay.arrival,
      departure: stay.departure,
      partySize: stay.partySize,
      status: stay.status,
      messages: await this.messages(stay.id),
      readyToFinish: stay.readyToFinish,
      chatError: stay.chatError,
      demo: stay.demo,
      aiMode: this.ai.name,
      busy: chat_busy,
    };
  }
  async chat(rawToken: string, content: string | undefined, clientId: string | undefined) {
    const initial = await this.guestRow(rawToken),
      id = initial.data.id;
    assert(
      ['draft', 'invited', 'in_progress'].includes(initial.data.status),
      409,
      'This conversation has ended.',
    );
    if (clientId) {
      const duplicate = (
        await this.db.query<{ data: Message }>(
          'SELECT data FROM messages WHERE stay_id=$1 AND client_id=$2',
          [id, clientId],
        )
      ).rows[0];
      if (duplicate) {
        assert(
          duplicate.data.content === content,
          409,
          'The earlier message was already saved. Reload the conversation before sending a changed message.',
        );
        return this.guest(rawToken);
      }
    }
    const acquired = await this.db.query(
      'UPDATE stays SET chat_busy=true WHERE id=$1 AND chat_busy=false RETURNING id',
      [id],
    );
    assert(acquired.rows.length, 409, 'A reply is already being prepared.');
    const controller = new AbortController();
    this.requests.set(id, controller);
    try {
      await this.db.transaction(async (tx) => {
        const row = await this.row(id, tx, true);
        assert(
          !row.data.revoked && ['draft', 'invited', 'in_progress'].includes(row.data.status),
          409,
          'This conversation has ended.',
        );
        if (content) {
          const message: Message = { id: randomUUID(), role: 'user', content, createdAt: now() };
          await tx.query('INSERT INTO messages(id,stay_id,client_id,data) VALUES($1,$2,$3,$4)', [
            message.id,
            id,
            clientId,
            json(message),
          ]);
        } else {
          const previous = await tx.query<{ data: Message }>(
            'SELECT data FROM messages WHERE stay_id=$1 ORDER BY sequence DESC LIMIT 1',
            [id],
          );
          assert(previous.rows[0]?.data.role === 'user', 409, 'There is no unanswered message to retry.');
        }
        await this.patch(tx, id, { status: 'in_progress', chatError: null });
      });
      const row = await this.row(id),
        messages = await this.messages(id);
      const response = await this.ai.chat(
        { stay: row.data, hotel: row.hotel_snapshot, messages },
        controller.signal,
      );
      await this.db.transaction(async (tx) => {
        const current = await this.row(id, tx, true);
        if (current.data.status === 'stopped' || current.data.revoked) return;
        const facts = response.facts.filter(
          (f) =>
            f.sourceQuote &&
            messages.some(
              (m) => m.role === 'user' && m.id === f.sourceMessageId && m.content.includes(f.sourceQuote),
            ),
        );
        const message: Message = {
          id: randomUUID(),
          role: 'assistant',
          content: response.reply,
          createdAt: now(),
        };
        await tx.query('INSERT INTO messages(id,stay_id,data) VALUES($1,$2,$3)', [
          message.id,
          id,
          json(message),
        ]);
        const discovery = response.discovery && groundedDiscovery(response.discovery, messages);
        await this.patch(tx, id, {
          facts,
          ...(discovery ? { discovery } : {}),
          readyToFinish:
            !response.stopRequested && (discovery ? discoveryReady(discovery) : response.readyToFinish),
        });
      });
      if (response.stopRequested) await this.stopById(id);
    } catch (error) {
      const current = (await this.db.query<StayRow>('SELECT data FROM stays WHERE id=$1', [id])).rows[0];
      if (!current) throw new AppError(410, 'This stay was removed.');
      if (error instanceof AppError && error.status < 500) throw error;
      if (current.data.status === 'in_progress' && !current.data.revoked) {
        await this.db.transaction((tx) =>
          this.patch(tx, id, {
            chatError:
              error instanceof AppError
                ? error.message
                : 'The reply could not be prepared. Your message is saved. Please retry.',
          }),
        );
      }
    } finally {
      this.requests.delete(id);
      await this.db.query('UPDATE stays SET chat_busy=false WHERE id=$1', [id]);
    }
    return this.guest(rawToken);
  }
  async input(id: string): Promise<GenerationInput> {
    const row = await this.row(id);
    return { stay: row.data, hotel: row.hotel_snapshot, messages: await this.messages(id) };
  }
  async finish(rawToken: string) {
    const row = await this.guestRow(rawToken),
      id = row.data.id;
    assert(!row.chat_busy, 409, 'Please wait for the current reply before finishing.');
    if (row.data.status === 'completed' || row.data.status === 'stopped') return this.guest(rawToken);
    await this.db.transaction(async (tx) => {
      const current = await this.row(id, tx, true);
      assert(!current.data.revoked, 410, 'This invitation was withdrawn.');
      if (['completed', 'stopped'].includes(current.data.status)) return;
      assert(!current.chat_busy, 409, 'A reply is still being prepared.');
      assert(!current.data.chatError, 409, 'Please retry the unanswered message before finishing.');
      const users = await tx.query("SELECT id FROM messages WHERE stay_id=$1 AND data->>'role'='user'", [id]);
      assert(users.rows.length, 409, 'Share a message first, or use the stop option.');
      await this.patch(tx, id, { status: 'completed', readyToFinish: false });
    });
    if ((await this.row(id)).data.status === 'completed') {
      try {
        await this.generate(id, false);
      } catch (error) {
        if ((await this.row(id)).data.status !== 'stopped') throw error;
      }
    }
    return this.guest(rawToken);
  }
  async stop(rawToken: string) {
    const row = await this.guestRow(rawToken);
    await this.stopById(row.data.id);
    return this.guest(rawToken);
  }
  async stopById(id: string) {
    this.requests.get(id)?.abort();
    await this.db.transaction(async (tx) => {
      const current = await this.row(id, tx, true);
      if (current.data.status === 'stopped') return;
      await this.patch(tx, id, {
        status: 'stopped',
        readyToFinish: false,
        chatError: null,
        briefStatus: 'none',
        selectedBriefId: null,
      });
      await tx.query('UPDATE stays SET chat_busy=false WHERE id=$1', [id]);
    });
    const current = await this.row(id);
    if (current.data.briefStatus === 'ready') return;
    await this.recordBrief(id, minimalBrief(await this.input(id)), 'minimal', 'minimal-record');
  }
  async recordBrief(id: string, text: string, kind: Brief['kind'], source: Brief['source']) {
    return this.db.transaction(async (tx) => {
      const row = await this.row(id, tx, true);
      if ((row.data.status === 'stopped' && kind !== 'minimal') || row.data.revoked) return;
      const all = await tx.query<{ data: Brief }>('SELECT data FROM briefs WHERE stay_id=$1', [id]);
      if (kind === 'minimal' && all.rows.some((r) => r.data.kind === 'minimal')) return;
      const createdAt = now();
      const brief: Brief = {
        id: randomUUID(),
        stayId: id,
        version: Math.max(0, ...all.rows.map((r) => r.data.version)) + 1,
        text,
        generatedText: text,
        kind,
        source,
        dnaVersion: row.data.dnaVersion,
        promptVersion: kind === 'minimal' ? 'withdrawal-v1' : briefPromptVersion,
        model: kind === 'minimal' ? 'deterministic-minimal-record' : this.ai.model,
        createdAt,
        updatedAt: createdAt,
        revision: 1,
      };
      await tx.query('INSERT INTO briefs(id,stay_id,data) VALUES($1,$2,$3)', [brief.id, id, json(brief)]);
      await this.patch(tx, id, { briefStatus: 'ready', briefError: null, selectedBriefId: brief.id });
      return brief;
    });
  }
  async generate(id: string, regenerate: boolean) {
    const proceed = await this.db.transaction(async (tx) => {
      const row = await this.row(id, tx, true);
      assert(
        row.data.status === 'completed',
        409,
        'Only a completed conversation can generate experience suggestions.',
      );
      assert(!row.data.revoked, 409, 'This stay has been revoked.');
      if (row.data.briefStatus === 'generating' || (!regenerate && row.data.briefStatus === 'ready'))
        return false;
      await this.patch(tx, id, { briefStatus: 'generating', briefError: null });
      return true;
    });
    if (!proceed) return;
    const job = (async () => {
      try {
        const input = await this.input(id);
        const text = await this.ai.brief(input);
        await this.recordBrief(id, text, 'normal', this.ai.name === 'openai' ? 'openai' : 'simulation');
      } catch (error) {
        await this.db.transaction(async (tx) => {
          const row = (await tx.query<StayRow>('SELECT data FROM stays WHERE id=$1 FOR UPDATE', [id]))
            .rows[0];
          if (!row || row.data.status !== 'completed') return;
          await this.patch(tx, id, {
            briefStatus: 'failed',
            briefError:
              error instanceof AppError
                ? error.message
                : 'Brief generation failed. Existing versions are preserved; retry when ready.',
          });
        });
      }
    })();
    this.jobs.add(job);
    void job.then(
      () => this.jobs.delete(job),
      () => this.jobs.delete(job),
    );
  }
  async selectBrief(id: string, briefId: string) {
    await this.db.transaction(async (tx) => {
      const row = await this.row(id, tx, true);
      const brief = (
        await tx.query<{ data: Brief }>('SELECT data FROM briefs WHERE id=$1 AND stay_id=$2', [briefId, id])
      ).rows[0]?.data;
      assert(brief, 404, 'Brief not found for this stay.');
      assert(
        row.data.status !== 'stopped' || brief.kind === 'minimal',
        409,
        'The guest declined personalization. Only the minimal record can be selected.',
      );
      await this.patch(tx, id, { selectedBriefId: briefId });
    });
  }
  async saveBrief(id: string, briefId: string, text: string, revision: number) {
    return this.db.transaction(async (tx) => {
      const row = await this.row(id, tx, true);
      const current = (
        await tx.query<{ data: Brief }>('SELECT data FROM briefs WHERE id=$1 AND stay_id=$2 FOR UPDATE', [
          briefId,
          id,
        ])
      ).rows[0]?.data;
      assert(current, 404, 'Brief not found.');
      assert(
        current.revision === revision,
        409,
        'This version changed in another window. Reload before saving.',
      );
      assert(
        row.data.status !== 'stopped' || current.kind === 'minimal',
        409,
        'Personalization was declined; edit the minimal record instead.',
      );
      if (current.kind === 'minimal' && !text.startsWith(withdrawalNotice))
        text = `${withdrawalNotice}\n\n${text}`;
      const brief = { ...current, text, updatedAt: now(), revision: revision + 1 };
      await tx.query('UPDATE briefs SET data=$2 WHERE id=$1', [briefId, json(brief)]);
      return brief;
    });
  }
  async exportBrief(id: string, briefId: string) {
    const detail = await this.detail(id);
    const brief = detail.briefs.find((b) => b.id === briefId);
    assert(brief, 404, 'Brief not found.');
    assert(detail.stay.selectedBriefId === briefId, 409, 'Select this saved version before exporting it.');
    assert(
      detail.stay.status !== 'stopped' || brief.kind === 'minimal',
      409,
      'The guest declined personalization. Export the minimal record only.',
    );
    return {
      text: brief.text,
      name: `Canopia - ${detail.stay.guestName.replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 60)} - v${brief.version}.txt`,
    };
  }
  async revoke(id: string) {
    this.requests.get(id)?.abort();
    return this.db.transaction((tx) => this.patch(tx, id, { revoked: true }));
  }
  async deleteStay(id: string) {
    this.requests.get(id)?.abort();
    await this.db.query('DELETE FROM stays WHERE id=$1', [id]);
  }
  async invitation(id: string, subject: string, body: string) {
    const row = await this.row(id);
    assert(!row.data.revoked, 409, 'This invitation has been withdrawn.');
    assert(Date.parse(row.data.expiresAt) > Date.now(), 409, 'This link has expired.');
    return this.db.transaction(async (tx) => {
      await this.row(id, tx, true);
      const existing = (
        await tx.query<{ data: Invitation }>('SELECT data FROM invitations WHERE stay_id=$1', [id])
      ).rows[0]?.data;
      assert(
        !existing || ['preview', 'failed'].includes(existing.status),
        409,
        'This invitation is already sent or awaiting delivery confirmation.',
      );
      const invitation: Invitation = {
        id: existing?.id || randomUUID(),
        stayId: id,
        status: 'preview',
        recipient: row.data.email,
        subject,
        body,
        createdAt: now(),
        error: null,
      };
      await tx.query(
        'INSERT INTO invitations(id,stay_id,data) VALUES($1,$2,$3) ON CONFLICT(stay_id) DO UPDATE SET data=EXCLUDED.data',
        [invitation.id, id, json(invitation)],
      );
      return invitation;
    });
  }
  async sendInvitation(id: string) {
    assert(
      this.config.allowEmail &&
        this.config.emailMode === 'smtp' &&
        this.config.smtpHost &&
        this.config.emailFrom,
      409,
      'Sending is disabled. The invitation can be previewed without sending.',
    );
    const row = await this.row(id);
    assert(
      this.config.testRecipients.includes(row.data.email.toLowerCase()),
      403,
      'This recipient is not on the explicitly configured test allowlist.',
    );
    assert(
      !row.data.revoked && Date.parse(row.data.expiresAt) > Date.now(),
      409,
      'This link is no longer active.',
    );
    const invitation = await this.db.transaction(async (tx) => {
      await this.row(id, tx, true);
      const old = (
        await tx.query<{ data: Invitation }>('SELECT data FROM invitations WHERE stay_id=$1 FOR UPDATE', [id])
      ).rows[0]?.data;
      assert(old, 409, 'Preview the invitation first.');
      assert(
        old.status === 'preview' || old.status === 'failed',
        409,
        'This invitation was already sent or is awaiting confirmation.',
      );
      const sending = { ...old, status: 'sending' as const };
      await tx.query('UPDATE invitations SET data=$2 WHERE id=$1', [old.id, json(sending)]);
      return sending;
    });
    const transport = nodemailer.createTransport({
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: this.config.smtpPort === 465,
      requireTLS: this.config.smtpPort !== 465,
      auth: this.config.smtpUser ? { user: this.config.smtpUser, pass: this.config.smtpPassword } : undefined,
      connectionTimeout: 15000,
      socketTimeout: 20000,
    });
    try {
      await transport.sendMail({
        from: this.config.emailFrom,
        to: invitation.recipient,
        subject: invitation.subject,
        text: invitation.body,
        messageId: `<${invitation.id}@canopia.local>`,
      });
      await this.db.transaction(async (tx) => {
        await tx.query('UPDATE invitations SET data=$2 WHERE id=$1', [
          invitation.id,
          json({ ...invitation, status: 'sent' }),
        ]);
        const current = await this.row(id, tx, true);
        if (current.data.status === 'draft') await this.patch(tx, id, { status: 'invited' });
      });
    } catch {
      await this.db.query('UPDATE invitations SET data=$2 WHERE id=$1', [
        invitation.id,
        json({
          ...invitation,
          status: 'unknown',
          error: 'Delivery could not be confirmed. Check the sending mailbox before attempting another send.',
        }),
      ]);
      throw new AppError(
        502,
        'Delivery could not be confirmed. Automatic retry is disabled to prevent duplicate invitations.',
      );
    } finally {
      transport.close();
    }
  }
  async recover() {
    const interrupted = (await this.db.query<{ data: Stay }>('SELECT data FROM stays WHERE chat_busy=true'))
      .rows;
    for (const { data } of interrupted)
      if (['draft', 'invited', 'in_progress'].includes(data.status))
        await this.db.transaction((tx) =>
          this.patch(tx, data.id, {
            chatError:
              'The server restarted while preparing a reply. Your message is saved; retry when ready.',
          }),
        );
    await this.db.query('UPDATE stays SET chat_busy=false');
    for (const stay of await this.stays())
      if (stay.briefStatus === 'generating')
        await this.db.transaction((tx) =>
          this.patch(tx, stay.id, {
            briefStatus: 'failed',
            briefError:
              'The server restarted during generation. Previous versions are safe; retry when ready.',
          }),
        );
    const pending = (
      await this.db.query<{ data: Invitation }>(
        "SELECT data FROM invitations WHERE data->>'status'='sending'",
      )
    ).rows;
    for (const { data } of pending)
      await this.db.query('UPDATE invitations SET data=$2 WHERE id=$1', [
        data.id,
        json({
          ...data,
          status: 'unknown',
          error: 'The server restarted during sending. Check delivery before retrying.',
        }),
      ]);
  }
}
