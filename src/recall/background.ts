import { AnkiError, RecallService } from './anki';
import { classifyPost } from './classifier';
import { loadSettings, LocalStorage, publicSettings, saveSettings } from './settings';
import {
  DEFAULT_SETTINGS,
  FEED_TEST_DURATION_MS,
  FeedPost,
  FilterDecision,
  RecallRequest,
  RecallResponse,
  RecallSettings,
} from './types';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function shortString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

export function validRequest(message: unknown): message is RecallRequest {
  if (!object(message) || typeof message.type !== 'string') return false;
  switch (message.type) {
    case 'recall:testMode':
      return typeof message.enabled === 'boolean';
    case 'recall:settings':
    case 'recall:stats':
      return true;
    case 'recall:status':
      return (
        message.requestPermission === undefined || typeof message.requestPermission === 'boolean'
      );
    case 'recall:saveSettings':
      if (!object(message.settings)) return false;
      return Object.entries(DEFAULT_SETTINGS).every(([key, value]) => {
        const setting = (message.settings as Record<string, unknown>)[key];
        return (
          typeof setting === typeof value &&
          (typeof setting !== 'number' || Number.isFinite(setting)) &&
          (typeof setting !== 'string' || setting.length <= 16000)
        );
      });
    case 'recall:classify':
      return (
        object(message.post) &&
        shortString(message.post.id, 300) &&
        shortString(message.post.text, 20000) &&
        typeof message.post.author === 'string' &&
        message.post.author.length <= 200
      );
    case 'recall:next':
      return shortString(message.postId, 300);
    case 'recall:release':
      return shortString(message.leaseId, 200);
    case 'recall:answer':
      return shortString(message.leaseId, 200) && [1, 2, 3, 4].includes(message.rating as number);
    default:
      return false;
  }
}

export interface AuthorizedSender {
  owner: string;
  extensionPage: boolean;
}

export function authorizeSender(
  sender: chrome.runtime.MessageSender,
  extensionId: string
): AuthorizedSender {
  if (sender.id !== extensionId || !sender.url)
    throw new AnkiError('Message sender is not authorized.');
  let url: URL;
  try {
    url = new URL(sender.url);
  } catch {
    throw new AnkiError('Message sender is not authorized.');
  }
  if (url.protocol === 'chrome-extension:' && url.hostname === extensionId) {
    return {
      owner: `extension:${sender.tab?.id ?? url.pathname}:${sender.documentId ?? ''}`,
      extensionPage: true,
    };
  }
  // X is an SPA: sender.url can describe the initial document after navigation.
  // The content script gates processing to the home feed using its current location.
  if (
    url.protocol !== 'https:' ||
    !['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(url.hostname) ||
    !Number.isInteger(sender.tab?.id) ||
    (sender.frameId !== undefined && sender.frameId !== 0)
  ) {
    throw new AnkiError('Recall reviews are only available on your X home feed.');
  }
  return { owner: `tab:${sender.tab!.id}:${sender.documentId ?? ''}`, extensionPage: false };
}

export interface MessageHandlerOptions {
  extensionId: string;
  storage: LocalStorage;
  service: RecallService;
  classify?: (post: FeedPost, settings: RecallSettings) => Promise<FilterDecision>;
  ready?: Promise<unknown>;
}

export function createMessageHandler(options: MessageHandlerOptions) {
  const classify = options.classify ?? classifyPost;
  return async (
    message: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<RecallResponse> => {
    try {
      await options.ready;
      const caller = authorizeSender(sender, options.extensionId);
      if (!validRequest(message)) throw new AnkiError('Invalid Recall request.');
      if (
        !caller.extensionPage &&
        sender.documentLifecycle &&
        sender.documentLifecycle !== 'active' &&
        ['recall:next', 'recall:answer', 'recall:classify'].includes(message.type)
      )
        throw new AnkiError('This page is no longer active. Reload X to continue reviewing.');
      if (
        (['recall:saveSettings', 'recall:status'].includes(message.type) ||
          (message.type === 'recall:testMode' && message.enabled)) &&
        !caller.extensionPage
      ) {
        throw new AnkiError('Open the extension settings to change configuration or connect Anki.');
      }
      switch (message.type) {
        case 'recall:testMode': {
          const settings = await loadSettings(options.storage);
          if (message.enabled && !settings.enabled)
            throw new AnkiError(
              'Enable Recall and save your settings before starting the feed test.'
            );
          return {
            ok: true,
            settings: publicSettings(
              await saveSettings(
                {
                  ...settings,
                  testModeUntil: message.enabled ? Date.now() + FEED_TEST_DURATION_MS : 0,
                },
                options.storage
              )
            ),
          };
        }
        case 'recall:settings': {
          const settings = await loadSettings(options.storage);
          return { ok: true, settings: caller.extensionPage ? settings : publicSettings(settings) };
        }
        case 'recall:saveSettings':
          return { ok: true, settings: await saveSettings(message.settings, options.storage) };
        case 'recall:stats':
          return { ok: true, stats: await options.service.stats() };
        case 'recall:status':
          return { ok: true, status: await options.service.status(message.requestPermission) };
        case 'recall:classify': {
          const settings = await loadSettings(options.storage);
          const decision = settings.enabled
            ? await classify(message.post, settings)
            : { replace: false, explanation: 'Recall is paused.', source: 'rules' as const };
          return { ok: true, decision };
        }
        case 'recall:next': {
          const card = await options.service.next(caller.owner, message.postId);
          return {
            ok: true,
            card,
            message: card
              ? undefined
              : 'No eligible due cards or free review slots right now. More reviews can wait.',
          };
        }
        case 'recall:release':
          await options.service.release(caller.owner, message.leaseId);
          return { ok: true };
        case 'recall:answer':
          return {
            ok: true,
            stats: await options.service.answer(caller.owner, message.leaseId, message.rating),
            message: 'Review saved to Anki.',
          };
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Recall could not complete that request.',
      };
    }
  };
}

/** Browser events cover teardown even when a content-script release cannot finish. */
export function watchTabLifecycle(
  tabs: Pick<typeof chrome.tabs, 'onUpdated' | 'onRemoved' | 'onReplaced' | 'query'>,
  service: RecallService,
  ready: Promise<unknown> = Promise.resolve()
): Promise<void> {
  const release = (tabId: number): void => {
    void ready.then(() => service.releaseTab(tabId)).catch(() => undefined);
  };
  tabs.onUpdated.addListener((tabId, change) => {
    // Ignore ordinary SPA URL/title updates: the current document still owns its cards.
    if (change.status === 'loading' || change.discarded) release(tabId);
  });
  tabs.onRemoved.addListener(release);
  tabs.onReplaced.addListener((_added, removed) => release(removed));
  return ready.then(async () => {
    try {
      const open = await tabs.query({});
      await service.releaseClosedTabs(open.flatMap(tab => (tab.id === undefined ? [] : [tab.id])));
    } catch {
      // If tab inspection is unavailable, the existing lease timeout still applies.
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage && chrome.storage?.local) {
  const storage = chrome.storage.local;
  // Secrets and persisted leases must not be readable through chrome.storage by content scripts.
  const ready = storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const service = new RecallService({ storage, settings: () => loadSettings(storage) });
  const cleanupReady = watchTabLifecycle(chrome.tabs, service, ready);
  const handle = createMessageHandler({
    extensionId: chrome.runtime.id,
    storage,
    service,
    ready: cleanupReady,
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void handle(message, sender).then(sendResponse);
    return true;
  });
}
