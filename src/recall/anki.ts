import { RecallSettings, RecallStats, RecallStatus, ReviewCard, Rating } from './types';
import { LocalStorage } from './settings';

export const ANKI_URL = 'http://127.0.0.1:8765';
export const REVIEW_STATE_KEY = 'foxvox.recall.reviews.v1';
export const LEASE_LIFETIME_MS = 20 * 60 * 1000;

export class AnkiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnkiError';
  }
}

export interface AnkiCardInfo {
  cardId: number;
  deckName: string;
  question: string;
  answer: string;
  mod: number;
  reps: number;
  lapses: number;
  due: number;
  type: number;
  queue: number;
  interval: number;
}

/** Only the background worker calls AnkiConnect. No card data leaves this machine. */
export class AnkiClient {
  constructor(
    private readonly key = '',
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly timeoutMs = 8000
  ) {}

  async call<T>(action: string, params?: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new AnkiError(
            `AnkiConnect timed out during ${action}. Keep Anki open and try the connection check.`
          )
        );
      }, this.timeoutMs);
    });
    try {
      const request = (async () => {
        const response = await this.fetcher(ANKI_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            version: 6,
            ...(params ? { params } : {}),
            ...(this.key ? { key: this.key } : {}),
          }),
          signal: controller.signal,
          credentials: 'omit',
          redirect: 'error',
        });
        if (!response.ok) throw new AnkiError(`AnkiConnect returned HTTP ${response.status}.`);
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('result' in body) || !('error' in body)) {
          throw new AnkiError(
            'AnkiConnect returned an invalid response. API version 6 is required.'
          );
        }
        const result = body as { result: T; error: unknown };
        if (result.error !== null) {
          throw new AnkiError(`AnkiConnect ${action}: ${String(result.error).slice(0, 300)}`);
        }
        return result.result;
      })();
      return await Promise.race([request, timeout]);
    } catch (error) {
      if (error instanceof AnkiError) throw error;
      throw new AnkiError(
        'Cannot reach AnkiConnect. Open Anki and install add-on 2055492159, then check the connection.'
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async findCards(query: string): Promise<number[]> {
    const result = await this.call<unknown>('findCards', { query });
    if (!Array.isArray(result) || result.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new AnkiError('AnkiConnect returned invalid card identifiers.');
    }
    return result as number[];
  }

  async cardInfo(cardId: number): Promise<AnkiCardInfo | null> {
    const result = await this.call<unknown>('cardsInfo', { cards: [cardId] });
    if (!Array.isArray(result) || result.length !== 1)
      throw new AnkiError('AnkiConnect returned invalid card details.');
    const card: unknown = result[0];
    if (!card || typeof card !== 'object')
      throw new AnkiError('AnkiConnect returned invalid card details.');
    const value = card as Record<string, unknown>;
    if (!Object.keys(value).length) return null;
    if (
      value.cardId !== cardId ||
      typeof value.question !== 'string' ||
      typeof value.answer !== 'string' ||
      typeof value.deckName !== 'string'
    ) {
      throw new AnkiError('AnkiConnect returned invalid card details.');
    }
    for (const field of ['mod', 'reps', 'lapses', 'due', 'type', 'queue', 'interval']) {
      if (typeof value[field] !== 'number' || !Number.isFinite(value[field]))
        throw new AnkiError('AnkiConnect returned invalid scheduling details.');
    }
    return value as unknown as AnkiCardInfo;
  }
}

/** Parentheses stop a custom OR query from escaping due-only restrictions. */
export function buildDueQuery(...scopes: string[]): string {
  for (const scope of scopes) {
    let quoted = false;
    let escaped = false;
    let depth = 0;
    for (const character of scope) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') {
        quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      if (depth < 0) break;
    }
    if (quoted || depth !== 0 || escaped)
      throw new AnkiError(
        'Anki search contains unmatched quotes, parentheses, or an unfinished escape. Check your deck/tag query.'
      );
  }
  return [
    ...scopes.filter(scope => scope.trim()).map(scope => `(${scope.trim()})`),
    'is:due',
    '-is:new',
    '-is:suspended',
    '-is:buried',
  ].join(' ');
}

export async function cardFingerprint(card: AnkiCardInfo): Promise<string> {
  const data = new TextEncoder().encode(
    JSON.stringify([
      card.cardId,
      card.mod,
      card.reps,
      card.lapses,
      card.due,
      card.type,
      card.queue,
      card.interval,
      card.question,
      card.answer,
    ])
  );
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

type LeaseState = 'pending' | 'submitting' | 'uncertain' | 'answered' | 'stale';
interface Lease {
  leaseId: string;
  owner: string;
  postId: string;
  cardId: number;
  fingerprint: string;
  isMath: boolean;
  issuedAt: number;
  date: string;
  state: LeaseState;
  repsAtIssue: number;
  checkedAt?: number;
}
interface ReviewState {
  stats: RecallStats;
  leases: Record<string, Lease>;
}

export interface RecallServiceOptions {
  storage: LocalStorage;
  settings: () => Promise<RecallSettings>;
  client?: (settings: RecallSettings) => AnkiClient;
  now?: () => number;
  uuid?: () => string;
}

/** A single worker-wide queue makes cross-tab lease and answer writes atomic. */
export class RecallService {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly makeClient: (settings: RecallSettings) => AnkiClient;

  constructor(private readonly options: RecallServiceOptions) {
    this.now = options.now ?? Date.now;
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
    this.makeClient = options.client ?? (settings => new AnkiClient(settings.ankiKey));
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.then(work, work);
    this.queue = task.catch(() => undefined);
    return task;
  }

  private date(): string {
    const date = new Date(this.now());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private async readState(): Promise<ReviewState> {
    const stored = (await this.options.storage.get(REVIEW_STATE_KEY))[REVIEW_STATE_KEY];
    const value = stored && typeof stored === 'object' ? (stored as Partial<ReviewState>) : {};
    const stats =
      value.stats?.date === this.date()
        ? {
            date: this.date(),
            reviewed: Math.max(0, Number(value.stats.reviewed) || 0),
            replaced: Math.max(0, Number(value.stats.replaced) || 0),
          }
        : { date: this.date(), reviewed: 0, replaced: 0 };
    const leases: Record<string, Lease> = {};
    for (const [key, lease] of Object.entries(value.leases ?? {})) {
      if (
        !lease ||
        lease.leaseId !== key ||
        !Number.isSafeInteger(lease.cardId) ||
        typeof lease.owner !== 'string'
      )
        continue;
      if (lease.state === 'pending' && this.now() - lease.issuedAt > LEASE_LIFETIME_MS) continue;
      if (['answered', 'stale'].includes(lease.state) && this.now() - lease.issuedAt > 2 * 86400000)
        continue;
      // A worker can stop after Anki receives the answer but before its response is saved.
      leases[key] = lease.state === 'submitting' ? { ...lease, state: 'uncertain' } : lease;
    }
    return { stats, leases };
  }

  private saveState(state: ReviewState): Promise<void> {
    return this.options.storage.set({ [REVIEW_STATE_KEY]: state });
  }

  stats(): Promise<RecallStats> {
    return this.serial(async () => (await this.readState()).stats);
  }

  async status(requestPermission = false): Promise<RecallStatus> {
    const settings = await this.options.settings();
    const client = this.makeClient(settings);
    const status: RecallStatus = { connected: false, decks: [], due: 0, mathDue: 0 };
    try {
      if (requestPermission) {
        const permission = await client.call<{
          permission: string;
          requireApiKey?: boolean;
          requireApikey?: boolean;
        }>('requestPermission');
        if (permission?.permission !== 'granted')
          throw new AnkiError(
            'Connection permission was not granted. Allow this extension in Anki, then try again.'
          );
        // The published examples use requireApiKey; the add-on currently returns requireApikey.
        if ((permission.requireApiKey || permission.requireApikey) && !settings.ankiKey)
          throw new AnkiError(
            'AnkiConnect requires an API key. Enter the key from its add-on configuration.'
          );
      }
      const version = await client.call<unknown>('version');
      if (typeof version !== 'number' || version < 6)
        throw new AnkiError('Update AnkiConnect: API version 6 is required.');
      status.connected = true;
      status.version = version;
      const decks = await client.call<unknown>('deckNames');
      if (!Array.isArray(decks) || !decks.every(deck => typeof deck === 'string'))
        throw new AnkiError('AnkiConnect returned invalid deck names.');
      status.decks = decks;
      status.due = (await client.findCards(buildDueQuery(settings.ankiQuery))).length;
      status.mathDue = settings.mathQuery.trim()
        ? (await client.findCards(buildDueQuery(settings.ankiQuery, settings.mathQuery))).length
        : 0;
    } catch (error) {
      status.connected = false;
      status.error = error instanceof Error ? error.message : 'The Anki connection check failed.';
    }
    return status;
  }

  next(owner: string, postId: string): Promise<ReviewCard | null> {
    return this.serial(async () => {
      const settings = await this.options.settings();
      if (!settings.enabled || settings.dailyLimit === 0) return null;
      const state = await this.readState();
      const client = this.makeClient(settings);
      await this.reconcileUncertain(state, client);
      const existing = Object.values(state.leases).find(
        lease => lease.owner === owner && lease.postId === postId
      );
      if (existing) {
        if (existing.state !== 'pending') return null;
        const card = await client.cardInfo(existing.cardId);
        if (!card || (await cardFingerprint(card)) !== existing.fingerprint) {
          existing.state = 'stale';
          await this.saveState(state);
          return null;
        }
        return this.reviewCard(card, existing);
      }
      const reserved = Object.values(state.leases).filter(lease =>
        ['pending', 'submitting', 'uncertain'].includes(lease.state)
      );
      // Cards still on screen across midnight can be graded today, so reserve them too.
      const todayReserved = reserved.filter(
        lease => lease.state === 'pending' || lease.date === this.date()
      ).length;
      if (state.stats.reviewed + todayReserved >= settings.dailyLimit) return null;
      const unavailable = new Set(reserved.map(lease => lease.cardId));
      const mathTurn =
        settings.mathEvery > 0 &&
        Boolean(settings.mathQuery.trim()) &&
        (state.stats.reviewed + todayReserved + 1) % settings.mathEvery === 0;
      const queries = mathTurn
        ? [
            { query: buildDueQuery(settings.ankiQuery, settings.mathQuery), math: true },
            { query: buildDueQuery(settings.ankiQuery), math: false },
          ]
        : [{ query: buildDueQuery(settings.ankiQuery), math: false }];
      for (const { query, math } of queries) {
        const candidates = (await client.findCards(query)).filter(id => !unavailable.has(id));
        for (const cardId of candidates.slice(0, 30)) {
          const card = await client.cardInfo(cardId);
          if (!card || card.type === 0 || card.queue <= 0) continue;
          const lease: Lease = {
            leaseId: this.uuid(),
            owner,
            postId,
            cardId,
            fingerprint: await cardFingerprint(card),
            isMath: math,
            issuedAt: this.now(),
            date: this.date(),
            state: 'pending',
            repsAtIssue: card.reps,
          };
          state.leases[lease.leaseId] = lease;
          state.stats.replaced += 1;
          await this.saveState(state);
          return this.reviewCard(card, lease);
        }
      }
      await this.saveState(state);
      return null;
    });
  }

  private reviewCard(card: AnkiCardInfo, lease: Lease): ReviewCard {
    // Do not expose fields, media, template CSS, or credentials to the X document.
    return {
      cardId: card.cardId,
      leaseId: lease.leaseId,
      deckName: card.deckName,
      question: card.question,
      answer: card.answer,
      isMath: lease.isMath,
    };
  }

  private async reconcileUncertain(state: ReviewState, client: AnkiClient): Promise<void> {
    let changed = false;
    for (const lease of Object.values(state.leases)) {
      if (
        lease.state !== 'uncertain' ||
        (lease.checkedAt !== undefined && this.now() - lease.checkedAt < 30000)
      )
        continue;
      const card = await client.cardInfo(lease.cardId);
      lease.checkedAt = this.now();
      changed = true;
      // A later review is evidence the old scheduling state is gone. Merely editing a
      // note is insufficient. Keep this lease as an answered tombstone so an old button
      // cannot retry; a future due occurrence can receive a new lease normally.
      if (
        card &&
        Number.isFinite(lease.repsAtIssue) &&
        card.reps > lease.repsAtIssue &&
        (await cardFingerprint(card)) !== lease.fingerprint
      ) {
        lease.state = 'answered';
        if (lease.date === this.date()) state.stats.reviewed += 1;
      }
    }
    if (changed) await this.saveState(state);
  }

  release(owner: string, leaseId: string): Promise<void> {
    return this.serial(async () => {
      const state = await this.readState();
      const lease = state.leases[leaseId];
      if (!lease) return;
      if (lease.owner !== owner) throw new AnkiError('This review belongs to another tab.');
      if (lease.state === 'pending') delete state.leases[leaseId];
      await this.saveState(state);
    });
  }

  private releasePendingWhere(matches: (owner: string) => boolean): Promise<void> {
    return this.serial(async () => {
      const state = await this.readState();
      let changed = false;
      for (const [id, lease] of Object.entries(state.leases)) {
        // Never discard the retry guard for an answer that may have reached Anki.
        if (lease.state === 'pending' && matches(lease.owner)) {
          delete state.leases[id];
          changed = true;
        }
      }
      if (changed) await this.saveState(state);
    });
  }

  releaseTab(tabId: number): Promise<void> {
    return this.releasePendingWhere(owner => owner.startsWith(`tab:${tabId}:`));
  }

  releaseClosedTabs(liveTabIds: number[]): Promise<void> {
    const live = new Set(liveTabIds);
    return this.releasePendingWhere(owner => {
      const match = /^tab:(\d+):/.exec(owner);
      return !!match && !live.has(Number(match[1]));
    });
  }

  answer(owner: string, leaseId: string, rating: Rating): Promise<RecallStats> {
    return this.serial(async () => {
      if (![1, 2, 3, 4].includes(rating)) throw new AnkiError('Choose Again, Hard, Good, or Easy.');
      const state = await this.readState();
      const lease = state.leases[leaseId];
      if (!lease) throw new AnkiError('This card expired. Load a fresh card before reviewing.');
      if (lease.owner !== owner) throw new AnkiError('This review belongs to another tab.');
      if (lease.state === 'answered') throw new AnkiError('This answer was already saved to Anki.');
      if (lease.state === 'uncertain' || lease.state === 'submitting') {
        throw new AnkiError(
          'An earlier answer may already be saved. Check this card in Anki; this extension will not submit it again.'
        );
      }
      if (lease.state !== 'pending')
        throw new AnkiError('This card changed in Anki. Load a fresh card before reviewing.');
      const settings = await this.options.settings();
      if (state.stats.reviewed >= settings.dailyLimit) {
        throw new AnkiError(
          'Your daily review limit has been reached. This answer was not submitted.'
        );
      }
      const client = this.makeClient(settings);
      const eligible = await client.findCards(
        buildDueQuery(settings.ankiQuery, `cid:${lease.cardId}`)
      );
      const card = await client.cardInfo(lease.cardId);
      if (
        !eligible.includes(lease.cardId) ||
        !card ||
        card.type === 0 ||
        card.queue <= 0 ||
        (await cardFingerprint(card)) !== lease.fingerprint
      ) {
        lease.state = 'stale';
        await this.saveState(state);
        throw new AnkiError(
          'This card was reviewed or changed in Anki. Its answer was not submitted.'
        );
      }
      lease.state = 'submitting';
      lease.date = this.date();
      await this.saveState(state);
      try {
        const result = await client.call<unknown>('answerCards', {
          answers: [{ cardId: lease.cardId, ease: rating }],
        });
        if (!Array.isArray(result) || result.length !== 1 || result[0] !== true) {
          throw new AnkiError('Anki did not confirm the review.');
        }
        lease.state = 'answered';
        state.stats.reviewed += 1;
        await this.saveState(state);
        return state.stats;
      } catch (error) {
        lease.state = 'uncertain';
        await this.saveState(state);
        const reason = error instanceof Error ? error.message : 'Anki did not confirm the review.';
        throw new AnkiError(
          `${reason} The answer may have been saved. Check Anki; automatic retry is disabled.`
        );
      }
    });
  }
}
