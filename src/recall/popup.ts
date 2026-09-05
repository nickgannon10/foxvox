import { RecallRequest, RecallResponse, RecallSettings } from './types';

const enabled = document.getElementById('popup-enabled') as HTMLInputElement;
const message = document.getElementById('popup-message')!;
let settings: RecallSettings | undefined;

async function send(request: RecallRequest): Promise<RecallResponse> {
  const response = (await chrome.runtime.sendMessage(request)) as RecallResponse | undefined;
  if (!response) throw new Error('Extension unavailable. Reload the extension and try again.');
  if (!response.ok) throw new Error(response.error || 'The request could not be completed.');
  return response;
}

function showMessage(text: string, error = false): void {
  message.textContent = text;
  message.classList.toggle('error', error);
  message.setAttribute('role', error ? 'alert' : 'status');
}

enabled.addEventListener('change', async () => {
  if (!settings) return;
  enabled.disabled = true;
  const previous = settings.enabled;
  try {
    // Read a fresh copy so opening settings in another tab cannot be undone by this toggle.
    const current = await send({ type: 'recall:settings' });
    if (!current.settings) throw new Error('Could not load current settings.');
    const next = { ...current.settings, enabled: enabled.checked };
    const saved = await send({ type: 'recall:saveSettings', settings: next });
    settings = saved.settings || next;
    showMessage(
      settings.enabled
        ? 'Recall is on for your X feed.'
        : 'Recall is paused. Your preferences are saved.'
    );
  } catch (error) {
    enabled.checked = previous;
    showMessage(error instanceof Error ? error.message : String(error), true);
  } finally {
    enabled.disabled = false;
  }
});

async function initialize(): Promise<void> {
  const results = await Promise.allSettled([
    send({ type: 'recall:settings' }),
    send({ type: 'recall:stats' }),
    send({ type: 'recall:status' }),
  ]);
  const settingsResult = results[0];
  if (settingsResult.status === 'fulfilled' && settingsResult.value.settings) {
    settings = settingsResult.value.settings;
    enabled.checked = settings.enabled;
    enabled.disabled = false;
    showMessage(
      settings.enabled
        ? 'Recall is on for your X feed.'
        : 'Recall is paused. Your preferences are saved.'
    );
  } else {
    showMessage('Settings could not be loaded. Reopen the extension to try again.', true);
  }
  const statsResult = results[1];
  if (statsResult.status === 'fulfilled' && statsResult.value.stats) {
    const reviewed = statsResult.value.stats.reviewed;
    const limit = settings?.dailyLimit;
    document.getElementById('reviewed-count')!.textContent = String(reviewed);
    document.getElementById('reviewed-label')!.textContent =
      `${reviewed === 1 ? 'card' : 'cards'} reviewed today`;
    document.getElementById('daily-progress')!.textContent = limit
      ? `${Math.max(0, limit - reviewed)} left in your daily limit of ${limit}`
      : 'Reviews recorded in Anki';
    document.getElementById('review-progress')!.style.width = limit
      ? `${Math.min(100, (reviewed / limit) * 100)}%`
      : '0%';
  } else {
    document.getElementById('daily-progress')!.textContent = 'Daily progress is unavailable.';
  }
  const statusResult = results[2];
  const status = statusResult.status === 'fulfilled' ? statusResult.value.status : undefined;
  document.getElementById('status-dot')!.className =
    `status-dot ${status?.connected ? 'connected' : 'disconnected'}`;
  document.getElementById('popup-anki-status')!.textContent = status?.connected
    ? 'Anki is connected'
    : 'Connect Anki to start';
  document.getElementById('popup-anki-detail')!.textContent = status?.connected
    ? `${status.due} due ${status.due === 1 ? 'card' : 'cards'} · ${status.mathDue} math ${status.mathDue === 1 ? 'card' : 'cards'}`
    : 'Open Anki and set up AnkiConnect in settings.';
}

void initialize();
