import { createRecallCard, safeCardContent } from '../../src/recall/card';
import { isHomeFeedLocation, readFeedPost, startRecall } from '../../src/recall/content';
import { DEFAULT_SETTINGS } from '../../src/recall/types';
import { classifyLocally } from '../../src/recall/classifier';
import type { RecallController } from '../../src/recall/content';
import type {
  RecallRequest,
  RecallResponse,
  RecallTransport,
  ReviewCard,
} from '../../src/recall/types';

const decision = {
  replace: true,
  reason: 'politics' as const,
  source: 'rules' as const,
  explanation: 'Political content, based on your preferences.',
};
const card: ReviewCard = {
  cardId: 42,
  leaseId: 'lease-42',
  deckName: 'Math',
  question: 'Differentiate \\(x^2\\).',
  answer: 'The answer is \\(2x\\).',
  isMath: true,
};
const tick = async (): Promise<void> => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};
const settle = async (): Promise<void> => {
  await tick();
  jest.advanceTimersByTime(100);
  await tick();
};
function tweet(id = '123', text = 'The election campaign is a disaster'): HTMLElement {
  const article = document.createElement('article');
  article.dataset.testid = 'tweet';
  article.innerHTML = `<div data-testid="User-Name"><a href="/writer">Writer</a></div><a href="/writer/status/${id}"><time>now</time></a><div data-testid="tweetText"></div><button>Like</button>`;
  article.querySelector('[data-testid="tweetText"]')!.textContent = text;
  document.body.append(article);
  return article;
}
function button(shadow: ShadowRoot, text: string): HTMLButtonElement {
  const node = Array.from(shadow.querySelectorAll('button')).find(
    candidate => candidate.textContent === text
  );
  if (!node) throw new Error(`Missing button: ${text}`);
  return node;
}
function fakeTransport(
  overrides: (request: RecallRequest) => RecallResponse | undefined = () => undefined
): jest.MockedFunction<RecallTransport> {
  return jest.fn(
    async (request: RecallRequest) =>
      overrides(request) ||
      (request.type === 'recall:settings'
        ? { ok: true, settings: { ...DEFAULT_SETTINGS, minPostGap: 0 } }
        : request.type === 'recall:classify'
          ? { ok: true, decision }
          : request.type === 'recall:next'
            ? { ok: true, card }
            : { ok: true })
  );
}

let controller: RecallController | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  document.body.replaceChildren();
  document.documentElement.dataset.recallDemo = 'true';
});
afterEach(() => {
  controller?.stop();
  controller = undefined;
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete document.documentElement.dataset.recallDemo;
});

test('feed test includes media-only posts, bypasses spacing, and expires in place', async () => {
  const initial = { ...DEFAULT_SETTINGS, minPostGap: 100, testModeUntil: Date.now() + 2000 };
  const first = tweet('111', 'A calm morning');
  const second = tweet('222', '');
  expect(readFeedPost(second)).toBeNull();
  const transport = fakeTransport(request => {
    if (request.type === 'recall:settings') return { ok: true, settings: initial };
    if (request.type === 'recall:classify')
      return { ok: true, decision: classifyLocally(request.post, initial) };
    if (request.type === 'recall:next')
      return { ok: true, card: { ...card, leaseId: request.postId } };
  });
  controller = startRecall(transport);
  await settle();
  expect(first.style.display).toBe('none');
  expect(second.style.display).toBe('none');
  expect(transport.mock.calls.filter(([r]) => r.type === 'recall:next')).toHaveLength(2);
  expect(document.querySelector('[data-foxvox-recall-test]')).not.toBeNull();
  jest.advanceTimersByTime(2100);
  await settle();
  expect(first.style.display).toBe('');
  expect(second.style.display).toBe('');
  expect(document.querySelector('[data-foxvox-recall-test]')).toBeNull();
  expect(document.querySelectorAll('[data-foxvox-recall]')).toHaveLength(0);
  expect(transport.mock.calls.filter(([r]) => r.type === 'recall:release')).toHaveLength(2);
});

test('pagehide releases cards and cached-page restoration obtains fresh reservations', async () => {
  const article = tweet();
  const transport = fakeTransport();
  controller = startRecall(transport);
  await settle();
  expect(article.style.display).toBe('none');
  window.dispatchEvent(new Event('pagehide'));
  await settle();
  expect(article.style.display).toBe('');
  expect(document.querySelector('[data-foxvox-recall]')).toBeNull();
  expect(transport.mock.calls.filter(([r]) => r.type === 'recall:release')).toHaveLength(1);
  await controller.refreshSettings();
  await settle();
  expect(document.querySelector('[data-foxvox-recall]')).toBeNull();
  window.dispatchEvent(new Event('pageshow'));
  await settle();
  expect(article.style.display).toBe('none');
  expect(transport.mock.calls.filter(([r]) => r.type === 'recall:next')).toHaveLength(2);
});

test('1200 virtualized posts leave only mounted cards and release every retired reservation', async () => {
  const transport = fakeTransport(request =>
    request.type === 'recall:next'
      ? { ok: true, card: { ...card, cardId: Number(request.postId), leaseId: request.postId } }
      : undefined
  );
  controller = startRecall(transport);
  for (let batch = 0; batch < 120; batch++) {
    document.body.replaceChildren();
    for (let offset = 0; offset < 10; offset++) tweet(String(batch * 10 + offset + 1000));
    await controller.refreshSettings();
    for (let turn = 0; turn < 80; turn++) await Promise.resolve();
    expect(document.querySelectorAll('[data-foxvox-recall]')).toHaveLength(10);
  }
  controller.stop();
  const released = transport.mock.calls.flatMap(([r]) =>
    r.type === 'recall:release' ? [r.leaseId] : []
  );
  expect(released).toHaveLength(1200);
  expect(new Set(released).size).toBe(1200);
  expect(document.querySelectorAll('[data-foxvox-recall]')).toHaveLength(0);
  expect(transport.mock.calls.filter(([r]) => r.type === 'recall:answer')).toHaveLength(0);
}, 30000);

test('limits real-site filtering to home, excluding profiles, search, messages and status detail', () => {
  for (const hostname of ['x.com', 'www.x.com', 'twitter.com']) {
    expect(isHomeFeedLocation({ hostname, pathname: '/home' })).toBe(true);
    for (const pathname of [
      '/messages',
      '/search',
      '/somebody',
      '/somebody/status/123',
      '/home/status/123',
      '/explore',
    ])
      expect(isHomeFeedLocation({ hostname, pathname })).toBe(false);
  }
  expect(isHomeFeedLocation({ hostname: 'x.com.attacker.test', pathname: '/home' })).toBe(false);
});

test('extracts stable status identity and account from the outer tweet', () => {
  const article = tweet();
  expect(readFeedPost(article)).toEqual({
    id: '123',
    author: 'writer',
    text: 'The election campaign is a disaster',
  });
});

test('strips active HTML, event handlers, styles, links and remote media from Anki cards', () => {
  const fragment = safeCardContent(
    '<style>body{display:none}</style><script>alert(1)</script><p style="color:red" onclick="alert(1)">Keep <b>this</b><img src="https://remote.test/tracker"><a href="javascript:alert(1)">label</a></p><iframe src="https://remote.test"></iframe><svg onload="alert(1)"></svg>'
  );
  const result = document.createElement('div');
  result.append(fragment);
  expect(result.querySelector('script,style,img,iframe,svg,a')).toBeNull();
  expect(result.querySelector('[style],[onclick],[src],[href]')).toBeNull();
  expect(result.textContent).toContain('Keep thislabel');
  expect(result.querySelector('b')?.textContent).toBe('this');
});

test('revealing never reviews; explicit ratings are locked while saving', async () => {
  let resolveAnswer!: (response: RecallResponse) => void;
  const answer = jest.fn(
    () =>
      new Promise<RecallResponse>(resolve => {
        resolveAnswer = resolve;
      })
  );
  const host = createRecallCard({
    decision,
    card,
    demo: true,
    onAnswer: answer,
    onShowOriginal: jest.fn(),
    onSkip: jest.fn(),
  });
  document.body.append(host);
  const shadow = host.shadowRoot!;
  expect(shadow.querySelector('.katex')).not.toBeNull();
  button(shadow, 'Reveal answer').click();
  expect(answer).not.toHaveBeenCalled();
  button(shadow, 'Good').click();
  button(shadow, 'Good').click();
  expect(answer).toHaveBeenCalledTimes(1);
  expect(answer).toHaveBeenCalledWith(3);
  expect(button(shadow, 'Again').disabled).toBe(true);
  resolveAnswer({ ok: true });
  await tick();
  expect(shadow.textContent).toContain('Sample review complete. No Anki changes.');
  expect(shadow.querySelector('textarea')).toBeNull();
});

test('a failed answer keeps the answer visible and does not claim a review was saved', async () => {
  const host = createRecallCard({
    decision,
    card,
    demo: true,
    onAnswer: async () => ({
      ok: false,
      error: 'Anki is offline. Check the review in Anki before retrying.',
    }),
    onShowOriginal: jest.fn(),
    onSkip: jest.fn(),
  });
  document.body.append(host);
  const shadow = host.shadowRoot!;
  button(shadow, 'Reveal answer').click();
  button(shadow, 'Good').click();
  await tick();
  expect(shadow.querySelector('.content')?.textContent).toContain('The answer is');
  expect(shadow.querySelector('[role="status"]')?.textContent).toContain('Anki is offline');
  expect(shadow.textContent).not.toContain('Your rating is saved in Anki');
});

test('replaces reversibly and preserves React nodes and their event listeners', async () => {
  const article = tweet();
  article.style.display = 'flex';
  const like = article.querySelector('button')!;
  const onLike = jest.fn();
  like.addEventListener('click', onLike);
  const transport = fakeTransport();
  controller = startRecall(transport);
  await settle();
  const host = document.querySelector<HTMLElement>('[data-foxvox-recall]')!;
  expect(host).not.toBeNull();
  expect(article.style.display).toBe('none');
  button(host.shadowRoot!, 'Show original').click();
  expect(article.style.display).toBe('flex');
  expect(document.querySelector('[data-foxvox-recall]')).toBeNull();
  expect(article.querySelector('button')).toBe(like);
  like.click();
  expect(onLike).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledWith({ type: 'recall:release', leaseId: card.leaseId });
});

test('detects recycled tweet identities, releasing the old card without deleting new React content', async () => {
  const article = tweet();
  const transport = fakeTransport(request =>
    request.type === 'recall:classify' && request.post.id === '456'
      ? { ok: true, decision: { ...decision, replace: false } }
      : undefined
  );
  controller = startRecall(transport);
  await settle();
  const newText = document.createElement('div');
  newText.dataset.testid = 'tweetText';
  newText.textContent = 'A beautiful proof in linear algebra';
  article.querySelector('[data-testid="tweetText"]')!.replaceWith(newText);
  article.querySelector('a[href*="/status/"]')!.setAttribute('href', '/writer/status/456');
  await settle();
  expect(article.querySelector('[data-testid="tweetText"]')).toBe(newText);
  expect(article.style.display).toBe('');
  expect(document.querySelector('[data-foxvox-recall]')).toBeNull();
  expect(transport).toHaveBeenCalledWith({ type: 'recall:release', leaseId: card.leaseId });
});

test('settings disabled during an in-flight reservation restores the tweet and releases a late lease', async () => {
  tweet();
  let enabled = true;
  let resolveNext!: (response: RecallResponse) => void;
  const transport: RecallTransport = jest.fn(async request => {
    if (request.type === 'recall:settings')
      return { ok: true, settings: { ...DEFAULT_SETTINGS, enabled } };
    if (request.type === 'recall:classify') return { ok: true, decision };
    if (request.type === 'recall:next')
      return new Promise(resolve => {
        resolveNext = resolve;
      });
    return { ok: true };
  });
  controller = startRecall(transport);
  await settle();
  enabled = false;
  await controller.refreshSettings();
  resolveNext({ ok: true, card });
  await settle();
  expect(document.querySelector('[data-foxvox-recall]')).toBeNull();
  expect(document.querySelector('article')!.style.display).toBe('');
  expect(transport).toHaveBeenCalledWith({ type: 'recall:release', leaseId: card.leaseId });
});

test('no due card produces a calm pause with show-original and no fabricated review controls', async () => {
  tweet();
  controller = startRecall(
    fakeTransport(request =>
      request.type === 'recall:next'
        ? { ok: true, card: null, message: 'All caught up. No Anki cards are due.' }
        : undefined
    )
  );
  await settle();
  const shadow = document.querySelector('[data-foxvox-recall]')!.shadowRoot!;
  expect(shadow.textContent).toContain('All caught up');
  expect(shadow.querySelector('.grades')).toBeNull();
  expect(Array.from(shadow.querySelectorAll('button')).map(node => node.textContent)).toEqual([
    'Show original',
  ]);
});

test('preserves the configured gap between replacements', async () => {
  for (let index = 0; index < 6; index++) tweet(String(index + 1));
  const transport = fakeTransport(request =>
    request.type === 'recall:settings'
      ? { ok: true, settings: { ...DEFAULT_SETTINGS, minPostGap: 2 } }
      : undefined
  );
  controller = startRecall(transport);
  await settle();
  expect(transport.mock.calls.filter(([request]) => request.type === 'recall:next')).toHaveLength(
    2
  );
  expect(document.querySelectorAll('[data-foxvox-recall]')).toHaveLength(6);
  expect(
    transport.mock.calls.filter(([request]) => request.type === 'recall:classify')
  ).toHaveLength(6);
});

test('review interactions stay isolated from timeline click handlers', () => {
  const timeline = document.createElement('div');
  const timelineClick = jest.fn();
  timeline.addEventListener('click', timelineClick);
  const host = createRecallCard({
    decision,
    card,
    demo: true,
    onAnswer: async () => ({ ok: true }),
    onShowOriginal: jest.fn(),
    onSkip: jest.fn(),
  });
  timeline.append(host);
  document.body.append(timeline);
  button(host.shadowRoot!, 'Reveal answer').dispatchEvent(
    new MouseEvent('click', { bubbles: true, composed: true })
  );
  expect(timelineClick).not.toHaveBeenCalled();
});

test('keeps the tweet filtered if React removes the injected sibling, without reserving again', async () => {
  const article = tweet();
  const transport = fakeTransport();
  controller = startRecall(transport);
  await settle();
  expect(article.style.display).toBe('none');
  document.querySelector('[data-foxvox-recall]')!.remove();
  await settle();
  expect(article.style.display).toBe('none');
  const replacement = document.querySelector('[data-foxvox-recall]')!;
  expect(replacement.shadowRoot!.textContent).toContain('Still filtered by your preferences');
  expect(replacement.shadowRoot!.querySelector('.grades')).toBeNull();
  expect(transport.mock.calls.filter(([request]) => request.type === 'recall:next')).toHaveLength(
    1
  );
  expect(transport).toHaveBeenCalledWith({ type: 'recall:release', leaseId: card.leaseId });
  // The observer sees our inserted placeholder once, then reaches a stable DOM.
  await settle();
  jest.advanceTimersByTime(1000);
  await tick();
  expect(document.querySelector('[data-foxvox-recall]')).toBe(replacement);
  expect(
    transport.mock.calls.filter(([request]) => request.type === 'recall:classify')
  ).toHaveLength(1);
});

test('demo review copy never claims an Anki change', async () => {
  const host = createRecallCard({
    decision,
    card,
    demo: true,
    onAnswer: async () => ({ ok: true }),
    onShowOriginal: jest.fn(),
    onSkip: jest.fn(),
  });
  document.body.append(host);
  const shadow = host.shadowRoot!;
  expect(shadow.textContent).toContain('Sample review');
  expect(shadow.textContent).toContain('This demo makes no Anki changes');
  button(shadow, 'Reveal answer').click();
  expect(button(shadow, 'Good').getAttribute('aria-label')).toContain('No Anki changes');
  button(shadow, 'Good').click();
  await tick();
  expect(shadow.textContent).toContain('Sample review complete. No Anki changes.');
  expect(shadow.textContent).not.toContain('Your rating is saved in Anki');
  expect(shadow.textContent).not.toContain('Reviewed in Anki');
});

test.each(['<img src="picture.png">', '[sound:question.mp3]', '<div>   </div>'])(
  'media-only or empty fronts cannot be graded: %s',
  question => {
    const answer = jest.fn(async () => ({ ok: true }));
    const skip = jest.fn();
    const host = createRecallCard({
      decision,
      card: { ...card, question },
      demo: true,
      onAnswer: answer,
      onShowOriginal: jest.fn(),
      onSkip: skip,
    });
    document.body.append(host);
    const shadow = host.shadowRoot!;
    expect(shadow.textContent).toContain('This card needs Anki');
    expect(shadow.querySelector('.grades')).toBeNull();
    expect(
      Array.from(shadow.querySelectorAll('button')).some(
        node => node.textContent === 'Reveal answer'
      )
    ).toBe(false);
    button(shadow, 'Skip for now').click();
    expect(skip).toHaveBeenCalledTimes(1);
    expect(answer).not.toHaveBeenCalled();
  }
);

test('media-only answers cannot be graded after reveal', () => {
  const answer = jest.fn(async () => ({ ok: true }));
  const host = createRecallCard({
    decision,
    card: { ...card, answer: '<img src="answer.png">' },
    demo: true,
    onAnswer: answer,
    onShowOriginal: jest.fn(),
    onSkip: jest.fn(),
  });
  document.body.append(host);
  const shadow = host.shadowRoot!;
  button(shadow, 'Reveal answer').click();
  expect(shadow.textContent).toContain('The answer needs Anki');
  expect(shadow.querySelector('.grades')).toBeNull();
  expect(answer).not.toHaveBeenCalled();
});

test('live cards use closed shadow DOM and reject synthetic reveal and rating clicks', async () => {
  const attachShadow = Element.prototype.attachShadow;
  let capturedRoot: ShadowRoot | undefined;
  // Capture the closed root only inside this test; runtime exposes no test-access flag.
  const attachSpy = jest.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    options
  ) {
    capturedRoot = attachShadow.call(this, options);
    return capturedRoot;
  });
  const clickHandlers = new WeakMap<EventTarget, EventListener>();
  const addEventListener = HTMLButtonElement.prototype.addEventListener;
  jest.spyOn(HTMLButtonElement.prototype, 'addEventListener').mockImplementation(function (
    this: HTMLButtonElement,
    type,
    listener,
    options
  ) {
    if (type === 'click' && typeof listener === 'function')
      clickHandlers.set(this, listener as EventListener);
    return addEventListener.call(this, type, listener, options);
  });
  const answer = jest.fn(async () => ({ ok: true }));
  const host = createRecallCard({
    decision,
    card,
    onAnswer: answer,
    onShowOriginal: jest.fn(),
    onSkip: jest.fn(),
  });
  document.body.append(host);
  expect(attachSpy).toHaveBeenCalledWith({ mode: 'closed' });
  expect(host.shadowRoot).toBeNull();
  const shadow = capturedRoot!;
  const reveal = button(shadow, 'Reveal answer');
  reveal.click();
  reveal.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  expect(shadow.querySelector('.grades')).toBeNull();
  expect(answer).not.toHaveBeenCalled();
  // Exercise the trusted branch by invoking the captured handler, never by weakening
  // isTrusted in production or pretending a synthetic DOM event is a trusted event.
  clickHandlers.get(reveal)!.call(reveal, { isTrusted: true } as MouseEvent);
  const grade = button(shadow, 'Good');
  grade.click();
  grade.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  expect(answer).not.toHaveBeenCalled();
  clickHandlers.get(grade)!.call(grade, { isTrusted: true } as MouseEvent);
  await tick();
  expect(answer).toHaveBeenCalledTimes(1);
  expect(answer).toHaveBeenCalledWith(3);
  expect(shadow.textContent).toContain('Your rating is saved in Anki');
});

test('remounted filtered tweets remain hidden behind a placeholder without another card lease', async () => {
  const article = tweet();
  const transport = fakeTransport();
  controller = startRecall(transport);
  await settle();
  article.remove();
  await settle();
  expect(document.querySelector('[data-foxvox-recall]')).toBeNull();
  const remounted = tweet();
  await settle();
  expect(remounted.style.display).toBe('none');
  const replacement = document.querySelector('[data-foxvox-recall]')!;
  expect(replacement.shadowRoot!.textContent).toContain('Still filtered by your preferences');
  expect(
    transport.mock.calls.filter(([request]) => request.type === 'recall:classify')
  ).toHaveLength(1);
  expect(transport.mock.calls.filter(([request]) => request.type === 'recall:next')).toHaveLength(
    1
  );
  button(replacement.shadowRoot!, 'Show original').click();
  expect(remounted.style.display).toBe('');
  remounted.remove();
  await settle();
  const explicitlyAllowed = tweet();
  await settle();
  expect(explicitlyAllowed.style.display).toBe('');
  expect(document.querySelector('[data-foxvox-recall]')).toBeNull();
});

test('remounted allowed tweets stay visible without repeat classification', async () => {
  const article = tweet('567', 'A lovely example of linear algebra');
  const transport = fakeTransport(request =>
    request.type === 'recall:classify'
      ? { ok: true, decision: { ...decision, replace: false } }
      : undefined
  );
  controller = startRecall(transport);
  await settle();
  article.remove();
  await settle();
  const remounted = tweet('567', 'A lovely example of linear algebra');
  await settle();
  expect(remounted.style.display).toBe('');
  expect(document.querySelector('[data-foxvox-recall]')).toBeNull();
  expect(
    transport.mock.calls.filter(([request]) => request.type === 'recall:classify')
  ).toHaveLength(1);
});
