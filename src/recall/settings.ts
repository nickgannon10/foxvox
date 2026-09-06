import { DEFAULT_SETTINGS, RecallSettings } from './types';

export const SETTINGS_KEY = 'foxvox.recall.settings.v1';

export interface LocalStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const booleanKeys = [
  'enabled',
  'filterPolitics',
  'filterPolarizing',
  'filterSports',
  'filterOffTopic',
  'aiEnabled',
] as const;
const stringLimits = {
  interests: 4000,
  blockedTerms: 4000,
  protectedAccounts: 4000,
  ankiQuery: 2000,
  mathQuery: 2000,
  ankiKey: 1000,
  aiKey: 1000,
  aiModel: 100,
  contentSpec: 8000,
} as const;

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

/** Accept only known fields; limits also apply when upgrading older saved settings. */
export function normalizeSettings(input: unknown): RecallSettings {
  const settings = { ...DEFAULT_SETTINGS };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return settings;
  const values = input as Record<string, unknown>;
  for (const key of booleanKeys) {
    if (typeof values[key] === 'boolean') settings[key] = values[key];
  }
  for (const [key, limit] of Object.entries(stringLimits)) {
    const name = key as keyof typeof stringLimits;
    if (typeof values[name] === 'string') settings[name] = values[name].slice(0, limit).trim();
  }
  settings.dailyLimit = boundedInteger(values.dailyLimit, settings.dailyLimit, 0, 100);
  settings.minPostGap = boundedInteger(values.minPostGap, settings.minPostGap, 0, 100);
  settings.insertEvery = boundedInteger(values.insertEvery, settings.insertEvery, 0, 100);
  settings.mathEvery = boundedInteger(values.mathEvery, settings.mathEvery, 0, 100);
  settings.testModeUntil = boundedInteger(values.testModeUntil, 0, 0, Number.MAX_SAFE_INTEGER);
  if (settings.testModeUntil <= Date.now()) settings.testModeUntil = 0;
  if (!settings.aiModel) settings.aiModel = DEFAULT_SETTINGS.aiModel;
  return settings;
}

/** Content scripts never receive credentials, even though they run in an isolated world. */
export function publicSettings(settings: RecallSettings): RecallSettings {
  return { ...settings, ankiKey: '', aiKey: '' };
}

export async function loadSettings(
  storage: LocalStorage = chrome.storage.local
): Promise<RecallSettings> {
  const data = await storage.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY]);
}

export async function saveSettings(
  input: unknown,
  storage: LocalStorage = chrome.storage.local
): Promise<RecallSettings> {
  const settings = normalizeSettings(input);
  await storage.set({ [SETTINGS_KEY]: settings });
  return settings;
}
