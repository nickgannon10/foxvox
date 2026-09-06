import { createRecallCard } from './card';
import { DEFAULT_SETTINGS, isFeedTestActive } from './types';
import type {
  FeedPost,
  FilterDecision,
  RecallSettings,
  RecallTransport,
  ReviewCard,
} from './types';

interface PostEntry {
  article: HTMLElement;
  post: FeedPost;
  fingerprint: string;
  visible: boolean;
  state: 'waiting' | 'working' | 'kept' | 'replaced';
  version: number;
  host?: HTMLElement;
  card?: ReviewCard;
  insertionDue?: boolean;
  insertHost?: HTMLElement;
  insertCard?: ReviewCard;
  originalDisplay?: string;
  originalPriority?: string;
}

export interface RecallController {
  stop(): void;
  refreshSettings(): Promise<void>;
}

export function isHomeFeedLocation(location: Pick<Location, 'hostname' | 'pathname'>): boolean {
  return (
    /^(www\.)?(x\.com|twitter\.com)$/.test(location.hostname) &&
    /^\/home\/?$/.test(location.pathname)
  );
}

/** Read only the outer tweet, and use its timestamp/status link as its stable identity. */
export function readFeedPost(article: HTMLElement, includeMediaOnly = false): FeedPost | null {
  const texts = Array.from(article.querySelectorAll<HTMLElement>('[data-testid="tweetText"]'));
  const textNode = texts.find(node => node.closest('article[data-testid="tweet"]') === article);
  const text = textNode?.textContent?.trim() || (includeMediaOnly ? '[Post without text]' : '');
  if (!text) return null;
  const links = Array.from(
    article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')
  ).filter(node => node.closest('article[data-testid="tweet"]') === article);
  const timestampLink = links.find(link => link.querySelector('time')) || links[0];
  if (!timestampLink) return null;
  const status = timestampLink
    .getAttribute('href')
    ?.match(/\/(?:i\/web|([A-Za-z0-9_]+))\/status\/(\d+)/);
  if (!status) return null;
  const authorRoot = article.querySelector('[data-testid="User-Name"]');
  const authorLinks = Array.from(authorRoot?.querySelectorAll<HTMLAnchorElement>('a[href]') || []);
  const profile = authorLinks
    .map(link => link.getAttribute('href')?.match(/^\/([A-Za-z0-9_]+)\/?$/)?.[1])
    .find(Boolean);
  return { id: status[2], text: text.slice(0, 12000), author: profile || status[1] || '' };
}

const fingerprint = (post: FeedPost): string => `${post.id}\u0000${post.author}\u0000${post.text}`;

export const extensionTransport: RecallTransport = async request => {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage)
    return { ok: false, error: 'FoxVox Recall is not connected to its extension.' };
  return new Promise(resolve => {
    chrome.runtime.sendMessage(request, response => {
      if (chrome.runtime.lastError)
        resolve({
          ok: false,
          error:
            chrome.runtime.lastError.message || 'The extension is unavailable. Reload this page.',
        });
      else
        resolve(
          response || { ok: false, error: 'No response from the extension. Reload this page.' }
        );
    });
  });
};

/** A supplied transport and explicit demo marker enable the local, isolated feed fixture. */
export function startRecall(transport: RecallTransport = extensionTransport): RecallController {
  let settings: RecallSettings = { ...DEFAULT_SETTINGS, enabled: false };
  let stopped = false;
  let pageHidden = false;
  let processing = false;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let testExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  let testBanner: HTMLElement | undefined;
  let testBannerLabel: HTMLElement | undefined;
  let settingsEpoch = 0;
  let seenSinceReplacement = DEFAULT_SETTINGS.minPostGap;
  let previousUrl = window.location.href;
  const entries = new Map<HTMLElement, PostEntry>();
  // Remember a user dismissal across virtualized tweet nodes, but not across page reloads.
  const dismissed = new Set<string>();
  const handled = new Set<string>();
  const counted = new Set<string>();
  let postsSinceInsertion = 0;
  // Virtualized tweets can return after their first card was released or reviewed.
  // Preserve the filter decision separately so returning posts stay filtered.
  const flagged = new Map<string, FilterDecision>();
  const rememberFlagged = (key: string, decision: FilterDecision): void => {
    if (flagged.size >= 1000) flagged.delete(flagged.keys().next().value!);
    flagged.set(key, decision);
  };
  const remember = (set: Set<string>, key: string): void => {
    if (set.size >= 1000) set.delete(set.values().next().value!);
    set.add(key);
  };
  const demo =
    transport !== extensionTransport && document.documentElement.dataset.recallDemo === 'true';
  const eligible = (): boolean =>
    !stopped &&
    !pageHidden &&
    settings.enabled &&
    (isHomeFeedLocation(window.location) ||
      (demo && !/^(www\.)?(x\.com|twitter\.com)$/.test(window.location.hostname)));

  const includeMediaOnly = (): boolean => settings.insertEvery > 0 || isFeedTestActive(settings);
  const resetCadence = (): void => {
    counted.clear();
    postsSinceInsertion = 0;
  };

  function updateTestBanner(): void {
    if (!eligible() || !isFeedTestActive(settings)) {
      testBanner?.remove();
      testBanner = undefined;
      testBannerLabel = undefined;
      return;
    }
    if (!testBanner?.isConnected) {
      testBanner = document.createElement('div');
      testBanner.dataset.foxvoxRecallTest = 'true';
      const shadow = testBanner.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent =
        ':host{position:fixed!important;bottom:18px!important;right:18px!important;z-index:2147483647!important;display:block!important}div{font:13px -apple-system,BlinkMacSystemFont,sans-serif;padding:14px 16px;background:#211b35;color:#ede5ff;border:1px solid #a390e0;border-radius:12px;box-shadow:0 4px 24px #0006;max-width:310px}button{font:inherit;color:#ede5ff;background:transparent;border:1px solid #a390e0;border-radius:6px;margin-left:12px;padding:5px 8px;cursor:pointer}button:focus-visible{outline:2px solid white}';
      const box = document.createElement('div');
      testBannerLabel = document.createElement('span');
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.textContent = 'Stop test';
      stop.addEventListener('click', event => {
        event.stopPropagation();
        if (!event.isTrusted) return;
        stop.disabled = true;
        void transport({ type: 'recall:testMode', enabled: false })
          .then(response => {
            if (response.ok) void refreshSettings();
            else {
              stop.disabled = false;
              stop.textContent = 'Stop in settings';
            }
          })
          .catch(() => {
            stop.disabled = false;
            stop.textContent = 'Stop in settings';
          });
      });
      box.append(testBannerLabel, stop);
      shadow.append(style, box);
      document.body.append(testBanner);
    }
    const seconds = Math.max(0, Math.ceil((settings.testModeUntil - Date.now()) / 1000));
    const count = document.querySelectorAll('article[data-testid="tweet"]').length;
    const label = `Recall test · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ${count} posts detected`;
    if (testBannerLabel && testBannerLabel.textContent !== label)
      testBannerLabel.textContent = label;
  }

  function expireFeedTest(): void {
    if (testExpiryTimer) clearTimeout(testExpiryTimer);
    testExpiryTimer = undefined;
    settings = { ...settings, testModeUntil: 0 };
    restoreAll();
    entries.clear();
    handled.clear();
    flagged.clear();
    resetCadence();
    scan();
  }

  function release(entry: PostEntry): void {
    if (!entry.card) return;
    const leaseId = entry.card.leaseId;
    entry.card = undefined;
    void transport({ type: 'recall:release', leaseId }).catch(() => undefined);
  }

  function restore(entry: PostEntry, keep = false): void {
    entry.version++;
    release(entry);
    if (!keep) removeInsertion(entry);
    entry.host?.remove();
    entry.host = undefined;
    if (entry.originalDisplay !== undefined) {
      if (entry.originalDisplay)
        entry.article.style.setProperty(
          'display',
          entry.originalDisplay,
          entry.originalPriority || ''
        );
      else entry.article.style.removeProperty('display');
      entry.originalDisplay = undefined;
      entry.originalPriority = undefined;
    }
    entry.state = keep ? 'kept' : 'waiting';
    intersection?.unobserve(entry.article);
  }

  function restoreAll(): void {
    for (const entry of entries.values()) restore(entry);
  }

  function current(entry: PostEntry, version: number): boolean {
    if (
      !eligible() ||
      !entry.article.isConnected ||
      entry.version !== version ||
      entries.get(entry.article) !== entry
    )
      return false;
    const latest = readFeedPost(entry.article, includeMediaOnly());
    return !!latest && fingerprint(latest) === entry.fingerprint;
  }

  function show(
    entry: PostEntry,
    decision: Parameters<typeof createRecallCard>[0]['decision'],
    card: ReviewCard | null,
    message?: string
  ): void {
    entry.card = card || undefined;
    const dismiss = (): void => {
      remember(dismissed, entry.post.id);
      restore(entry, true);
      // Bring the restored tweet into the same location, without stealing keyboard focus.
      entry.article
        .querySelector<HTMLElement>('a[href], button, [tabindex]')
        ?.focus({ preventScroll: true });
    };
    entry.host = createRecallCard({
      demo,
      decision,
      card,
      message,
      onAnswer: rating =>
        card
          ? transport({ type: 'recall:answer', leaseId: card.leaseId, rating })
          : Promise.resolve({ ok: false, error: 'No card is available.' }),
      onShowOriginal: dismiss,
      onSkip: dismiss,
      onReviewed: () => {
        entry.card = undefined;
      },
    });
    entry.originalDisplay = entry.article.style.getPropertyValue('display');
    entry.originalPriority = entry.article.style.getPropertyPriority('display');
    entry.article.before(entry.host);
    entry.article.style.setProperty('display', 'none', 'important');
    entry.state = 'replaced';
    if (card) seenSinceReplacement = 0;
  }

  function removeInsertion(entry: PostEntry): void {
    if (entry.insertCard) {
      void transport({ type: 'recall:release', leaseId: entry.insertCard.leaseId }).catch(
        () => undefined
      );
      entry.insertCard = undefined;
    }
    entry.insertHost?.remove();
    entry.insertHost = undefined;
  }

  async function insertReview(entry: PostEntry, version: number): Promise<void> {
    if (!entry.insertionDue || !current(entry, version)) return;
    entry.insertionDue = false;
    try {
      const result = await transport({ type: 'recall:next', postId: `insert:${entry.post.id}` });
      if (!current(entry, version) || !result.ok) {
        if (result.card)
          void transport({ type: 'recall:release', leaseId: result.card.leaseId }).catch(
            () => undefined
          );
        return;
      }
      const card = result.card;
      // An optional review break needs no placeholder when there is nothing to study.
      if (!card) return;
      entry.insertCard = card;
      const dismiss = (): void => removeInsertion(entry);
      entry.insertHost = createRecallCard({
        demo,
        placement: 'insertion',
        decision: {
          replace: false,
          source: 'rules',
          explanation: `A review break after ${settings.insertEvery} tweets.`,
        },
        card,
        onAnswer: rating => transport({ type: 'recall:answer', leaseId: card.leaseId, rating }),
        onShowOriginal: dismiss,
        onSkip: dismiss,
        onReviewed: () => {
          entry.insertCard = undefined;
        },
      });
      entry.article.after(entry.insertHost);
      seenSinceReplacement = 0;
    } catch {
      // An unavailable card never changes the original tweet.
      removeInsertion(entry);
    }
  }

  async function processEntry(entry: PostEntry): Promise<void> {
    const version = entry.version;
    entry.state = 'working';
    if (!counted.has(entry.post.id)) {
      remember(counted, entry.post.id);
      if (settings.insertEvery > 0 && !isFeedTestActive(settings)) {
        postsSinceInsertion++;
        if (postsSinceInsertion >= settings.insertEvery) {
          postsSinceInsertion = 0;
          entry.insertionDue = true;
        }
      }
    }
    try {
      if (dismissed.has(entry.post.id)) {
        entry.state = 'kept';
        return;
      }
      const previousDecision = flagged.get(entry.fingerprint);
      if (previousDecision) {
        show(
          entry,
          previousDecision,
          null,
          'Still filtered by your preferences. You have already seen this detour.'
        );
        return;
      }
      if (
        handled.has(entry.fingerprint) ||
        (entry.post.text === '[Post without text]' && !isFeedTestActive(settings))
      ) {
        entry.state = 'kept';
        return;
      }
      const withinGap = !isFeedTestActive(settings) && seenSinceReplacement < settings.minPostGap;
      seenSinceReplacement++;
      const result = await transport({ type: 'recall:classify', post: entry.post });
      if (!current(entry, version)) return;
      if (!result.ok || !result.decision?.replace) {
        entry.state = 'kept';
        remember(handled, entry.fingerprint);
        return;
      }
      rememberFlagged(entry.fingerprint, result.decision);
      if (withinGap) {
        show(
          entry,
          result.decision,
          null,
          'Filtered by your rules. The next review will appear after a few more posts.'
        );
        return;
      }
      const next = await transport({ type: 'recall:next', postId: entry.post.id });
      if (!current(entry, version)) {
        if (next.card)
          void transport({ type: 'recall:release', leaseId: next.card.leaseId }).catch(
            () => undefined
          );
        return;
      }
      show(entry, result.decision, next.ok ? next.card || null : null, next.message || next.error);
    } catch {
      // A failed classifier must not decide what to hide. Leave the tweet intact.
      if (current(entry, version)) entry.state = 'kept';
    } finally {
      await insertReview(entry, version);
    }
  }

  async function processVisible(): Promise<void> {
    if (processing || !eligible()) return;
    processing = true;
    try {
      // Serial reservations preserve feed order and avoid duplicate leases. Only nearby
      // posts enter this loop; no full-timeline AI requests or scroll interception.
      while (eligible()) {
        const candidates = Array.from(entries.values()).filter(
          entry => entry.state === 'waiting' && entry.visible && entry.article.isConnected
        );
        candidates.sort((a, b) =>
          a.article.compareDocumentPosition(b.article) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
        );
        const entry = candidates[0];
        if (!entry) break;
        await processEntry(entry);
      }
    } finally {
      processing = false;
    }
  }

  const intersection =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          updates => {
            for (const update of updates) {
              const entry = entries.get(update.target as HTMLElement);
              if (entry) entry.visible = update.isIntersecting;
            }
            void processVisible();
          },
          { rootMargin: '150px 0px', threshold: 0.01 }
        )
      : undefined;

  function scan(): void {
    if (stopped) return;
    updateTestBanner();
    if (!eligible()) {
      restoreAll();
      return;
    }
    for (const [article, entry] of entries) {
      if (entry.insertHost && !entry.insertHost.isConnected) removeInsertion(entry);
      if (
        entry.insertHost &&
        article.isConnected &&
        entry.insertHost.previousElementSibling !== article
      )
        article.after(entry.insertHost);
      const post = article.isConnected ? readFeedPost(article, includeMediaOnly()) : null;
      if (
        entry.host &&
        !entry.host.isConnected &&
        post &&
        fingerprint(post) === entry.fingerprint
      ) {
        restore(entry);
        const bounds = article.getBoundingClientRect();
        entry.visible =
          !intersection || (bounds.bottom >= -150 && bounds.top <= window.innerHeight + 150);
        intersection?.observe(article);
      }
      if (!post || fingerprint(post) !== entry.fingerprint) {
        restore(entry);
        intersection?.unobserve(article);
        entries.delete(article);
      }
    }
    document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]').forEach(article => {
      // Avoid tweet previews in dialogs and nested quoted material.
      if (
        entries.has(article) ||
        article.closest('[role="dialog"]') ||
        article.parentElement?.closest('article[data-testid="tweet"]')
      )
        return;
      const post = readFeedPost(article, includeMediaOnly());
      if (!post) return;
      const bounds = article.getBoundingClientRect();
      const visible =
        !intersection || (bounds.bottom >= -150 && bounds.top <= window.innerHeight + 150);
      const entry: PostEntry = {
        article,
        post,
        fingerprint: fingerprint(post),
        visible,
        state: 'waiting',
        version: 0,
      };
      entries.set(article, entry);
      intersection?.observe(article);
    });
    void processVisible();
  }

  function scheduleScan(): void {
    if (stopped || scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = undefined;
      scan();
    }, 80);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href'],
  });
  const onNavigation = (): void => {
    if (previousUrl !== window.location.href) {
      previousUrl = window.location.href;
      // Pending responses become stale even if the browser returns home quickly.
      restoreAll();
      entries.clear();
      handled.clear();
      flagged.clear();
      resetCadence();
      seenSinceReplacement = settings.minPostGap;
    }
    scan();
  };
  const onPageHide = (): void => {
    pageHidden = true;
    restoreAll();
    entries.clear();
    handled.clear();
    flagged.clear();
    resetCadence();
    updateTestBanner();
  };
  const onPageShow = (): void => {
    pageHidden = false;
    onNavigation();
  };
  window.addEventListener('popstate', onNavigation);
  window.addEventListener('hashchange', onNavigation);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('pagehide', onPageHide);
  const navigationTimer = setInterval(() => {
    if (previousUrl !== window.location.href) onNavigation();
  }, 600);
  const testBannerTimer = setInterval(updateTestBanner, 1000);

  async function refreshSettings(): Promise<void> {
    const epoch = ++settingsEpoch;
    try {
      const response = await transport({ type: 'recall:settings' });
      if (stopped || epoch !== settingsEpoch) return;
      if (response.ok && response.settings) {
        const wasEnabled = settings.enabled;
        const nextSettings = {
          ...response.settings,
          testModeUntil:
            response.settings.testModeUntil > Date.now() ? response.settings.testModeUntil : 0,
        };
        const changed = JSON.stringify(settings) !== JSON.stringify(nextSettings);
        settings = nextSettings;
        if (testExpiryTimer) clearTimeout(testExpiryTimer);
        testExpiryTimer =
          settings.testModeUntil > Date.now()
            ? setTimeout(expireFeedTest, Math.min(settings.testModeUntil - Date.now(), 2147483647))
            : undefined;
        if (changed) {
          restoreAll();
          entries.clear();
          handled.clear();
          flagged.clear();
          resetCadence();
          seenSinceReplacement = settings.minPostGap;
        }
        if (!settings.enabled) restoreAll();
        if (!wasEnabled && settings.enabled) seenSinceReplacement = settings.minPostGap;
      }
    } catch {
      // No settings connection means the initial state stays safely disabled.
    }
    scan();
  }
  const storageChanged = (): void => {
    void refreshSettings();
  };
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged)
    chrome.storage.onChanged.addListener(storageChanged);
  const settingsTimer = setInterval(() => {
    void refreshSettings();
  }, 30000);
  void refreshSettings();
  return {
    refreshSettings,
    stop() {
      stopped = true;
      settingsEpoch++;
      observer.disconnect();
      intersection?.disconnect();
      if (scheduled) clearTimeout(scheduled);
      if (testExpiryTimer) clearTimeout(testExpiryTimer);
      testBanner?.remove();
      clearInterval(navigationTimer);
      clearInterval(testBannerTimer);
      clearInterval(settingsTimer);
      window.removeEventListener('popstate', onNavigation);
      window.removeEventListener('hashchange', onNavigation);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged)
        chrome.storage.onChanged.removeListener(storageChanged);
      restoreAll();
      entries.clear();
    },
  };
}

if (
  typeof chrome !== 'undefined' &&
  chrome.runtime?.id &&
  /^(www\.)?(x\.com|twitter\.com)$/.test(window.location.hostname)
)
  startRecall();
