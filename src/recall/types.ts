export type Rating = 1 | 2 | 3 | 4;
export type FilterReason = 'politics' | 'polarizing' | 'sports' | 'off-topic' | 'custom' | 'test';
export interface RecallSettings {
  enabled: boolean;
  testModeUntil: number;
  filterPolitics: boolean;
  filterPolarizing: boolean;
  filterSports: boolean;
  filterOffTopic: boolean;
  interests: string;
  blockedTerms: string;
  protectedAccounts: string;
  dailyLimit: number;
  minPostGap: number;
  insertEvery: number;
  ankiQuery: string;
  mathQuery: string;
  mathEvery: number;
  multiplicationEvery: number;
  ankiKey: string;
  aiEnabled: boolean;
  aiKey: string;
  aiModel: string;
  contentSpec: string;
}
export const DEFAULT_SETTINGS: RecallSettings = {
  enabled: true,
  testModeUntil: 0,
  filterPolitics: true,
  filterPolarizing: true,
  filterSports: true,
  filterOffTopic: false,
  interests: 'mathematics, science, engineering, art, thoughtful conversation',
  blockedTerms: '',
  protectedAccounts: '',
  dailyLimit: 12,
  minPostGap: 3,
  insertEvery: 10,
  ankiQuery: '',
  mathQuery: 'tag:math',
  mathEvery: 3,
  multiplicationEvery: 4,
  ankiKey: '',
  aiEnabled: false,
  aiKey: '',
  aiModel: 'gpt-4.1-mini',
  contentSpec:
    'Keep useful ideas, curiosity, and thoughtful disagreement. Replace partisan politics, sports coverage, personal attacks, outrage bait, and engagement bait.',
};
export const FEED_TEST_DURATION_MS = 5 * 60 * 1000;
export function isFeedTestActive(settings: RecallSettings, now = Date.now()): boolean {
  return settings.enabled && settings.testModeUntil > now;
}
export interface FeedPost {
  id: string;
  text: string;
  author: string;
}
export interface FilterDecision {
  replace: boolean;
  reason?: FilterReason;
  explanation: string;
  source: 'rules' | 'ai';
}
export interface ReviewCard {
  cardId: number;
  leaseId: string;
  deckName: string;
  question: string;
  answer: string;
  isMath: boolean;
}
export interface RecallStats {
  date: string;
  reviewed: number;
  replaced: number;
}
export interface RecallStatus {
  connected: boolean;
  version?: number;
  decks: string[];
  due: number;
  mathDue: number;
  error?: string;
}
export type RecallRequest =
  | { type: 'recall:settings' }
  | { type: 'recall:saveSettings'; settings: RecallSettings }
  | { type: 'recall:testMode'; enabled: boolean }
  | { type: 'recall:status'; requestPermission?: boolean }
  | { type: 'recall:classify'; post: FeedPost }
  | { type: 'recall:next'; postId: string }
  | { type: 'recall:release'; leaseId: string }
  | { type: 'recall:answer'; leaseId: string; rating: Rating }
  | { type: 'recall:stats' };
export interface RecallResponse {
  ok: boolean;
  error?: string;
  settings?: RecallSettings;
  decision?: FilterDecision;
  card?: ReviewCard | null;
  message?: string;
  stats?: RecallStats;
  status?: RecallStatus;
}
export type RecallTransport = (request: RecallRequest) => Promise<RecallResponse>;
