/** @jest-environment node */
import {
  AnkiCardInfo,
  AnkiClient,
  buildDueQuery,
  LEASE_LIFETIME_MS,
  MULTIPLICATION_QUERY,
  RecallService,
  REVIEW_STATE_KEY,
} from '../../src/recall/anki';
import {
  authorizeSender,
  createMessageHandler,
  validRequest,
  watchTabLifecycle,
} from '../../src/recall/background';
import { LocalStorage, normalizeSettings, SETTINGS_KEY } from '../../src/recall/settings';
import { DEFAULT_SETTINGS, RecallSettings } from '../../src/recall/types';

class MemoryStorage implements LocalStorage {
  values: Record<string, unknown> = {};
  async get(key: string) {
    return { [key]: structuredClone(this.values[key]) };
  }
  async set(values: Record<string, unknown>) {
    Object.assign(this.values, structuredClone(values));
  }
}

function fixtureCard(cardId: number): AnkiCardInfo {
  return {
    cardId,
    deckName: 'Math',
    question: `Question ${cardId}`,
    answer: `Answer ${cardId}`,
    mod: 100,
    reps: 2,
    lapses: 0,
    due: 10,
    type: 2,
    queue: 2,
    interval: 3,
  };
}

interface RequestBody {
  action: string;
  version: number;
  params?: Record<string, unknown>;
  key?: string;
}

function fakeAnki() {
  const cards = new Map([11, 22, 33].map(id => [id, fixtureCard(id)]));
  const requests: RequestBody[] = [];
  let due = [11, 22, 33];
  let math = [33];
  let multiplication: number[] = [];
  let failAnswer = false;
  const fetcher = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const request: RequestBody = JSON.parse(String(init?.body));
    requests.push(request);
    let result: unknown;
    switch (request.action) {
      case 'version':
        result = 6;
        break;
      case 'requestPermission':
        result = { permission: 'granted', requireApiKey: false, version: 6 };
        break;
      case 'deckNames':
        result = ['Math'];
        break;
      case 'findCards': {
        const query = String(request.params?.query);
        const cid = /cid:(\d+)/.exec(query);
        result = due.filter(
          id =>
            (!cid || id === Number(cid[1])) &&
            (!query.includes('tag:math') || math.includes(id)) &&
            (query.includes(`-${MULTIPLICATION_QUERY}`)
              ? !multiplication.includes(id)
              : !query.includes(MULTIPLICATION_QUERY) || multiplication.includes(id))
        );
        break;
      }
      case 'cardsInfo': {
        const id = (request.params?.cards as number[])[0];
        result = [cards.get(id) ?? {}];
        break;
      }
      case 'answerCards': {
        if (failAnswer) throw new Error('Connection lost after Anki might have committed.');
        const answer = (request.params?.answers as { cardId: number; ease: number }[])[0];
        const card = cards.get(answer.cardId);
        if (card) {
          card.reps += 1;
          card.mod += 1;
          due = due.filter(id => id !== card.cardId);
        }
        result = [Boolean(card)];
        break;
      }
      default:
        throw new Error(`Unexpected action ${request.action}`);
    }
    return new Response(JSON.stringify({ result, error: null }));
  });
  return {
    cards,
    requests,
    fetcher,
    setDue: (ids: number[]) => {
      due = ids;
    },
    setMath: (ids: number[]) => {
      math = ids;
    },
    setMultiplication: (ids: number[]) => {
      multiplication = ids;
    },
    failAnswers: () => {
      failAnswer = true;
    },
    answers: () => requests.filter(request => request.action === 'answerCards'),
  };
}

function harness(overrides: Partial<RecallSettings> = {}) {
  const storage = new MemoryStorage();
  const anki = fakeAnki();
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...overrides });
  let time = new Date(2026, 8, 5, 12).getTime();
  let id = 0;
  const options = {
    storage,
    settings: async () => settings,
    client: () => new AnkiClient('', anki.fetcher as typeof fetch, 50),
    now: () => time,
    uuid: () => `lease-${++id}`,
  };
  return {
    storage,
    anki,
    settings,
    service: new RecallService(options),
    restart: () => new RecallService(options),
    advance: (amount: number) => {
      time += amount;
    },
  };
}

describe('AnkiConnect protocol', () => {
  test('uses only loopback, API v6 and optional key; rejects API errors', async () => {
    const fetcher = jest.fn(
      async () => new Response(JSON.stringify({ result: null, error: 'invalid key' }))
    );
    const client = new AnkiClient('secret', fetcher as typeof fetch);
    await expect(client.call('version')).rejects.toThrow('invalid key');
    const [url, init] = (fetcher.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe('http://127.0.0.1:8765');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'version', version: 6, key: 'secret' });
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
  });

  test('rejects HTTP failures and malformed v6 envelopes', async () => {
    const http = new AnkiClient(
      '',
      (async () => new Response('', { status: 503 })) as typeof fetch
    );
    await expect(http.call('version')).rejects.toThrow('HTTP 503');
    const malformed = new AnkiClient('', (async () => new Response('6')) as typeof fetch);
    await expect(malformed.call('version')).rejects.toThrow('invalid response');
  });

  test('times out even if an unresponsive fetch implementation ignores cancellation', async () => {
    const client = new AnkiClient('', (() => new Promise(() => undefined)) as typeof fetch, 5);
    await expect(client.call('version')).rejects.toThrow('timed out');
  });

  test('groups OR scopes and prevents unbalanced syntax escaping due restrictions', () => {
    expect(buildDueQuery('deck:Math or tag:math', 'tag:hard')).toBe(
      '(deck:Math or tag:math) (tag:hard) is:due -is:new -is:suspended -is:buried'
    );
    expect(() => buildDueQuery('is:review) or (is:new')).toThrow('unmatched');
    expect(buildDueQuery('deck:"Math (hard)"')).toContain('(deck:"Math (hard)")');
    expect(buildDueQuery('deck:"Math \\"quoted\\""')).toContain('is:due');
  });
});

describe('persisted review leases', () => {
  test('100 concurrent reservations respect the cap and 50 duplicate grades write only once', async () => {
    const h = harness({ dailyLimit: 12, mathEvery: 0 });
    const ids = Array.from({ length: 64 }, (_, i) => i + 100);
    h.anki.cards.clear();
    ids.forEach(id => h.anki.cards.set(id, fixtureCard(id)));
    h.anki.setDue(ids);
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => h.service.next(`tab:${i}:doc`, `post-${i}`))
    );
    const cards = results.filter(card => card !== null);
    expect(cards).toHaveLength(12);
    expect(new Set(cards.map(card => card.cardId)).size).toBe(12);
    expect(h.anki.answers()).toHaveLength(0);
    const grades = await Promise.allSettled(
      Array.from({ length: 50 }, () => h.service.answer('tab:0:doc', cards[0]!.leaseId, 3))
    );
    expect(grades.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(h.anki.answers()).toHaveLength(1);
    expect((await h.service.stats()).reviewed).toBe(1);
  });

  test('tab cleanup releases pending cards but retains uncertain answers and other tabs', async () => {
    const h = harness({ mathEvery: 0 });
    const pending = (await h.service.next('tab:1:old', 'post-a'))!;
    const uncertain = (await h.service.next('tab:1:old', 'post-b'))!;
    const other = (await h.service.next('tab:10:doc', 'post-c'))!;
    const state = h.storage.values[REVIEW_STATE_KEY] as {
      leases: Record<string, { state: string }>;
    };
    state.leases[uncertain.leaseId].state = 'submitting';
    await h.service.releaseTab(1);
    await expect(h.service.answer('tab:1:old', pending.leaseId, 3)).rejects.toThrow('expired');
    await expect(h.service.answer('tab:1:old', uncertain.leaseId, 3)).rejects.toThrow(
      'will not submit'
    );
    expect(await h.service.next('tab:10:doc', 'post-c')).toEqual(other);
    expect((await h.service.next('tab:1:new', 'new-post'))?.cardId).toBe(pending.cardId);
    expect(h.anki.answers()).toHaveLength(0);
  });

  test('reload, close, replacement and startup cleanup free abandoned document reservations', async () => {
    const h = harness({ mathEvery: 0 });
    const old = (await h.service.next('tab:7:old', 'old-post'))!;
    const other = (await h.service.next('tab:8:doc', 'other-post'))!;
    const closed = (await h.service.next('tab:9:doc', 'closed-post'))!;
    const updated = jest.fn();
    const removed = jest.fn();
    const replaced = jest.fn();
    const tabs = {
      onUpdated: { addListener: updated },
      onRemoved: { addListener: removed },
      onReplaced: { addListener: replaced },
      query: jest.fn(async () => [{ id: 7 }, { id: 8 }]),
    } as unknown as Parameters<typeof watchTabLifecycle>[0];
    await watchTabLifecycle(tabs, h.service);
    await expect(h.service.answer('tab:9:doc', closed.leaseId, 3)).rejects.toThrow('expired');
    updated.mock.calls[0][0](7, { url: 'https://x.com/explore', title: 'Explore' });
    await Promise.resolve();
    expect(await h.service.next('tab:7:old', 'old-post')).toEqual(old);
    updated.mock.calls[0][0](7, { status: 'loading' });
    await Promise.resolve();
    const fresh = (await h.service.next('tab:7:new', 'fresh-post'))!;
    expect(fresh.cardId).toBe(old.cardId);
    expect(fresh.leaseId).not.toBe(old.leaseId);
    removed.mock.calls[0][0](8);
    replaced.mock.calls[0][0](17, 7);
    await Promise.resolve();
    await expect(h.service.answer('tab:8:doc', other.leaseId, 3)).rejects.toThrow('expired');
    await expect(h.service.answer('tab:7:new', fresh.leaseId, 3)).rejects.toThrow('expired');
    expect(h.anki.answers()).toHaveLength(0);
  });

  test('deduplicates simultaneous tabs, honors pending daily reservations, and survives restart', async () => {
    const h = harness({ dailyLimit: 2 });
    const [a, b] = await Promise.all([
      h.service.next('tab:1', 'post-a'),
      h.service.next('tab:2', 'post-b'),
    ]);
    expect(a?.cardId).toBe(11);
    expect(b?.cardId).toBe(22);
    expect(await h.service.next('tab:3', 'post-c')).toBeNull();
    expect(await h.restart().next('tab:1', 'post-a')).toEqual(a);
    expect(await h.restart().next('tab:3', 'post-c')).toBeNull();
    expect(h.anki.answers()).toHaveLength(0);
  });

  test('a released lease frees capacity, while another tab cannot release or grade it', async () => {
    const h = harness({ dailyLimit: 1 });
    const a = (await h.service.next('tab:1', 'post-a'))!;
    await expect(h.service.release('tab:2', a.leaseId)).rejects.toThrow('another tab');
    await expect(h.service.answer('tab:2', a.leaseId, 3)).rejects.toThrow('another tab');
    await h.service.release('tab:1', a.leaseId);
    expect((await h.service.next('tab:2', 'post-b'))?.cardId).toBe(11);
    expect(h.anki.answers()).toHaveLength(0);
  });

  test('never offers unseen new cards even if the API gives an inconsistent result', async () => {
    const h = harness();
    h.anki.cards.get(11)!.type = 0;
    h.anki.cards.get(11)!.queue = 0;
    expect((await h.service.next('tab:1', 'post-a'))?.cardId).toBe(22);
    expect(
      h.anki.requests.find(request => request.action === 'findCards')?.params?.query
    ).toContain('-is:new');
  });

  test('selects due math at the configured cadence and falls back when none are due', async () => {
    const h = harness({ mathEvery: 2 });
    await h.service.next('tab:1', 'post-a');
    const math = await h.service.next('tab:1', 'post-b');
    expect(math?.cardId).toBe(33);
    expect(math?.isMath).toBe(true);
    const fallback = harness({ mathEvery: 1 });
    fallback.anki.setMath([]);
    expect((await fallback.service.next('tab:1', 'post-a'))?.cardId).toBe(11);
  });

  test('reserves every fourth offer for multiplication, including skips and worker restarts', async () => {
    const h = harness({ mathEvery: 1 });
    h.anki.setMultiplication([11]);
    h.anki.setMath([11, 33]);
    let service = h.service;
    const offered: number[] = [];
    for (let index = 1; index <= 8; index++) {
      const owner = index % 2 ? 'tab:1' : 'tab:2';
      const card = (await service.next(owner, `post-${index}`))!;
      offered.push(card.cardId);
      // Re-fetching the same rendered card does not consume a cadence slot.
      expect(await service.next(owner, `post-${index}`)).toEqual(card);
      await service.release(owner, card.leaseId);
      service = h.restart();
    }
    expect(offered).toEqual([33, 33, 33, 11, 33, 33, 33, 11]);
    expect((await service.stats()).replaced).toBe(8);
    expect(h.anki.answers()).toHaveLength(0);
  });

  test('falls back when either pool is unavailable without moving the Anki schedule', async () => {
    const h = harness({ multiplicationEvery: 2, mathEvery: 0 });
    h.anki.setMultiplication([11]);
    const first = (await h.service.next('tab:1', 'first'))!;
    expect(first.cardId).toBe(22);
    const second = (await h.service.next('tab:1', 'second'))!;
    expect(second.cardId).toBe(11);
    // A multiplication card reserved by another tab is not available for reuse.
    expect((await h.service.next('tab:2', 'third'))?.cardId).toBe(33);
    expect(await h.service.next('tab:2', 'fourth')).toBeNull();
    await h.service.release('tab:1', first.leaseId);
    expect((await h.service.next('tab:2', 'fourth'))?.cardId).toBe(22);
    expect(h.anki.answers()).toHaveLength(0);

    const onlyMultiplication = harness({ mathEvery: 0 });
    onlyMultiplication.anki.setDue([11]);
    onlyMultiplication.anki.setMultiplication([11]);
    expect((await onlyMultiplication.service.next('tab:1', 'first'))?.isMath).toBe(true);
  });

  test('disabling the multiplication cadence restores the ordinary pool', async () => {
    const h = harness({ multiplicationEvery: 0, mathEvery: 0 });
    h.anki.setMultiplication([11]);
    expect((await h.service.next('tab:1', 'first'))?.cardId).toBe(11);
    expect(h.anki.requests.filter(r => r.action === 'findCards')).toHaveLength(1);
  });

  test('expired cards cannot be graded and no longer reserve daily slots', async () => {
    const h = harness({ dailyLimit: 1 });
    const card = (await h.service.next('tab:1', 'post-a'))!;
    h.advance(LEASE_LIFETIME_MS + 1);
    await expect(h.service.answer('tab:1', card.leaseId, 3)).rejects.toThrow('expired');
    expect(await h.service.next('tab:1', 'post-b')).not.toBeNull();
    expect(h.anki.answers()).toHaveLength(0);
  });

  test('pending cards across midnight reserve the new day and a lowered limit is enforced on answer', async () => {
    const h = harness({ dailyLimit: 2 });
    h.advance(12 * 3600000 - 5 * 60000);
    const old = (await h.service.next('tab:1', 'post-a'))!;
    h.advance(10 * 60000);
    const fresh = (await h.service.next('tab:2', 'post-b'))!;
    expect(await h.service.next('tab:3', 'post-c')).toBeNull();
    h.settings.dailyLimit = 1;
    await h.service.answer('tab:1', old.leaseId, 3);
    await expect(h.service.answer('tab:2', fresh.leaseId, 3)).rejects.toThrow('daily review limit');
    expect(h.anki.answers()).toHaveLength(1);
  });

  test('only an explicit grade writes one answer and advances stats', async () => {
    const h = harness({ dailyLimit: 1 });
    const card = (await h.service.next('tab:1', 'post-a'))!;
    expect(await h.service.stats()).toMatchObject({ reviewed: 0, replaced: 1 });
    expect(h.anki.answers()).toHaveLength(0);
    const stats = await h.service.answer('tab:1', card.leaseId, 2);
    expect(stats.reviewed).toBe(1);
    expect(h.anki.answers()[0].params).toEqual({ answers: [{ cardId: 11, ease: 2 }] });
    await expect(h.restart().answer('tab:1', card.leaseId, 2)).rejects.toThrow('already saved');
    expect(h.anki.answers()).toHaveLength(1);
    expect(await h.service.next('tab:2', 'post-b')).toBeNull();
  });

  test.each(['reviewed', 'suspended', 'edited'] as const)(
    'rechecks eligibility and fingerprint if card was %s elsewhere',
    async change => {
      const h = harness();
      const card = (await h.service.next('tab:1', 'post-a'))!;
      if (change === 'reviewed') h.anki.setDue([22, 33]);
      if (change === 'suspended') h.anki.cards.get(11)!.queue = -1;
      if (change === 'edited') h.anki.cards.get(11)!.question = 'Edited question';
      await expect(h.service.answer('tab:1', card.leaseId, 3)).rejects.toThrow(
        'reviewed or changed'
      );
      expect(h.anki.answers()).toHaveLength(0);
    }
  );

  test('uncertain answers stay quarantined across releases, tabs, and worker restarts', async () => {
    const h = harness();
    const card = (await h.service.next('tab:1', 'post-a'))!;
    h.anki.failAnswers();
    await expect(h.service.answer('tab:1', card.leaseId, 3)).rejects.toThrow(
      'automatic retry is disabled'
    );
    await h.service.release('tab:1', card.leaseId);
    await expect(h.restart().answer('tab:1', card.leaseId, 3)).rejects.toThrow(
      'will not submit it again'
    );
    const next = await h.restart().next('tab:2', 'post-b');
    expect(next?.cardId).toBe(22);
    expect(h.anki.answers()).toHaveLength(1);
    expect((await h.service.stats()).reviewed).toBe(0);
  });

  test('a worker crash after persisted submission cannot trigger another write', async () => {
    const h = harness();
    const card = (await h.service.next('tab:1', 'post-a'))!;
    const state = h.storage.values[REVIEW_STATE_KEY] as {
      leases: Record<string, { state: string }>;
    };
    state.leases[card.leaseId].state = 'submitting';
    await expect(h.restart().answer('tab:1', card.leaseId, 3)).rejects.toThrow(
      'will not submit it again'
    );
    expect(h.anki.answers()).toHaveLength(0);
  });

  test('uncertain leases recover only after a proven later review, retaining the old retry guard', async () => {
    const h = harness({ mathEvery: 0 });
    const card = (await h.service.next('tab:1', 'post-a'))!;
    h.anki.failAnswers();
    await expect(h.service.answer('tab:1', card.leaseId, 3)).rejects.toThrow('automatic retry');
    h.anki.cards.get(11)!.question = 'A note edit is not review evidence';
    expect((await h.service.next('tab:2', 'post-b'))?.cardId).toBe(22);
    h.anki.cards.get(11)!.reps += 1;
    h.advance(30001);
    expect((await h.service.next('tab:3', 'post-c'))?.cardId).toBe(11);
    await expect(h.service.answer('tab:1', card.leaseId, 3)).rejects.toThrow('already saved');
    expect(h.anki.answers()).toHaveLength(1);
    expect((await h.service.stats()).reviewed).toBe(1);
  });

  test('connection status reports due counts without reviewing any cards', async () => {
    const h = harness();
    expect(await h.service.status(true)).toMatchObject({
      connected: true,
      version: 6,
      due: 3,
      mathDue: 1,
      decks: ['Math'],
    });
    expect(h.anki.requests[0].action).toBe('requestPermission');
    expect(h.anki.answers()).toHaveLength(0);
  });

  test.each(['requireApikey', 'requireApiKey'])(
    'recognizes permission response %s and reports later query failures',
    async key => {
      const h = harness();
      const permissionClient = new AnkiClient(
        '',
        (async () =>
          new Response(
            JSON.stringify({ result: { permission: 'granted', [key]: true }, error: null })
          )) as typeof fetch
      );
      const permissionService = new RecallService({
        storage: h.storage,
        settings: async () => h.settings,
        client: () => permissionClient,
      });
      expect(await permissionService.status(true)).toMatchObject({
        connected: false,
        error: expect.stringContaining('requires an API key'),
      });
      h.settings.ankiQuery = 'invalid) query';
      expect(await h.service.status()).toMatchObject({
        connected: false,
        error: expect.stringContaining('unmatched'),
      });
    }
  );
});

describe('runtime message boundary', () => {
  const extensionId = 'abc';
  const tabSender = {
    id: extensionId,
    url: 'https://x.com/home',
    frameId: 0,
    tab: { id: 7 },
  } as chrome.runtime.MessageSender;
  const extensionSender = {
    id: extensionId,
    url: 'chrome-extension://abc/options.html',
  } as chrome.runtime.MessageSender;

  test('only extension pages can start a five-minute test; stopping preserves all other settings', async () => {
    const h = harness();
    const initial = {
      ...DEFAULT_SETTINGS,
      aiKey: 'test-secret',
      minPostGap: 17,
      protectedAccounts: '@friend',
    };
    await h.storage.set({ [SETTINGS_KEY]: initial });
    const handle = createMessageHandler({ extensionId, storage: h.storage, service: h.service });
    expect((await handle({ type: 'recall:testMode', enabled: true }, tabSender)).ok).toBe(false);
    expect(validRequest({ type: 'recall:testMode', enabled: 'true' })).toBe(false);
    const start = Date.now();
    const result = await handle({ type: 'recall:testMode', enabled: true }, extensionSender);
    expect(result.ok).toBe(true);
    expect(result.settings?.testModeUntil).toBeGreaterThanOrEqual(start + 300000);
    expect(result.settings?.testModeUntil).toBeLessThanOrEqual(Date.now() + 300000);
    expect(result.settings?.aiKey).toBe('');
    expect((await handle({ type: 'recall:testMode', enabled: false }, tabSender)).ok).toBe(true);
    const restored = await handle({ type: 'recall:settings' }, extensionSender);
    expect(restored.settings).toEqual(initial);
    expect(h.anki.answers()).toHaveLength(0);
    expect(normalizeSettings({ testModeUntil: start - 1 }).testModeUntil).toBe(0);
  });

  test('checks extension identity, HTTPS X origin, and top frame', () => {
    expect(authorizeSender(tabSender, extensionId).extensionPage).toBe(false);
    expect(() => authorizeSender({ ...tabSender, id: 'other' }, extensionId)).toThrow(
      'not authorized'
    );
    expect(() =>
      authorizeSender({ ...tabSender, url: 'https://x.com.evil.example/home' }, extensionId)
    ).toThrow('home feed');
    expect(() => authorizeSender({ ...tabSender, frameId: 3 }, extensionId)).toThrow('home feed');
    expect(() => authorizeSender({ ...tabSender, url: 'http://x.com/home' }, extensionId)).toThrow(
      'home feed'
    );
  });

  test('inactive documents cannot reserve or grade, but can release their old cards', async () => {
    const h = harness();
    const handle = createMessageHandler({ extensionId, storage: h.storage, service: h.service });
    const active: chrome.runtime.MessageSender = {
      ...tabSender,
      documentId: 'old',
      documentLifecycle: 'active',
    };
    const inactive: chrome.runtime.MessageSender = { ...active, documentLifecycle: 'cached' };
    const reserved = await handle({ type: 'recall:next', postId: 'post' }, active);
    const leaseId = reserved.card!.leaseId;
    expect((await handle({ type: 'recall:next', postId: 'another' }, inactive)).ok).toBe(false);
    expect((await handle({ type: 'recall:answer', leaseId, rating: 3 }, inactive)).ok).toBe(false);
    expect((await handle({ type: 'recall:release', leaseId }, inactive)).ok).toBe(true);
    expect(h.anki.answers()).toHaveLength(0);
  });

  test('rejects malformed requests and non-numeric grades', () => {
    expect(validRequest({ type: 'recall:answer', leaseId: 'lease', rating: '3' })).toBe(false);
    expect(validRequest({ type: 'recall:answer', leaseId: 'lease', rating: 0 })).toBe(false);
    expect(
      validRequest({
        type: 'recall:classify',
        post: { id: '1', text: 'a'.repeat(20001), author: 'me' },
      })
    ).toBe(false);
    expect(validRequest({ type: 'recall:saveSettings', settings: { enabled: true } })).toBe(false);
    expect(validRequest({ type: 'answerCards', answers: [] })).toBe(false);
  });

  test('redacts secrets for feed callers and reserves settings/connection actions for extension pages', async () => {
    const h = harness();
    await h.storage.set({
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, aiKey: 'ai-secret', ankiKey: 'anki-secret' },
    });
    const handle = createMessageHandler({ extensionId, storage: h.storage, service: h.service });
    expect((await handle({ type: 'recall:settings' }, tabSender)).settings).toMatchObject({
      aiKey: '',
      ankiKey: '',
    });
    expect((await handle({ type: 'recall:settings' }, extensionSender)).settings).toMatchObject({
      aiKey: 'ai-secret',
      ankiKey: 'anki-secret',
    });
    expect((await handle({ type: 'recall:status', requestPermission: true }, tabSender)).ok).toBe(
      false
    );
    expect(
      (await handle({ type: 'recall:saveSettings', settings: DEFAULT_SETTINGS }, tabSender)).ok
    ).toBe(false);
    expect(h.anki.requests).toHaveLength(0);
  });

  test('settings normalize bounded values without accepting unknown keys', () => {
    const settings = normalizeSettings({
      dailyLimit: 1e6,
      minPostGap: -2,
      mathEvery: 2.8,
      multiplicationEvery: 4.9,
      interests: ' math ',
      aiKey: 'abc',
      surprise: true,
    });
    expect(settings).toMatchObject({
      dailyLimit: 100,
      minPostGap: 0,
      mathEvery: 2,
      multiplicationEvery: 4,
      interests: 'math',
      aiKey: 'abc',
    });
    expect(settings).not.toHaveProperty('surprise');
  });

  test('older saved preferences inherit sports filtering and a ten-tweet insertion interval', () => {
    expect(
      normalizeSettings({ dailyLimit: 7, aiKey: 'retained', filterPolitics: false })
    ).toMatchObject({
      dailyLimit: 7,
      aiKey: 'retained',
      filterPolitics: false,
      filterSports: true,
      insertEvery: 10,
      multiplicationEvery: 4,
    });
    expect(normalizeSettings({ insertEvery: 0, filterSports: false })).toMatchObject({
      insertEvery: 0,
      filterSports: false,
    });
    expect(normalizeSettings({ insertEvery: 500 }).insertEvery).toBe(100);
    expect(normalizeSettings({ multiplicationEvery: 0 }).multiplicationEvery).toBe(0);
    expect(normalizeSettings({ multiplicationEvery: 500 }).multiplicationEvery).toBe(100);
  });
});
