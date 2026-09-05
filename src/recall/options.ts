import {
  DEFAULT_SETTINGS,
  RecallRequest,
  RecallResponse,
  RecallSettings,
  RecallStatus,
  isFeedTestActive,
} from './types';

const form = document.getElementById('settings-form') as HTMLFormElement;
const fields = document.getElementById('settings-fields') as HTMLFieldSetElement;
const saveButton = document.getElementById('save-button') as HTMLButtonElement;
const connectButton = document.getElementById('connect-button') as HTMLButtonElement;
const saveStatus = document.getElementById('save-status') as HTMLElement;
const feedTestButton = document.getElementById('feed-test-button') as HTMLButtonElement;
const feedTestStatus = document.getElementById('feed-test-status') as HTMLElement;
let loaded = false;
let savedSettings: RecallSettings = { ...DEFAULT_SETTINGS };
let editRevision = 0;

function renderFeedTest(): void {
  const active = isFeedTestActive(savedSettings);
  feedTestButton.textContent = active
    ? 'Stop test and restore normal filters'
    : 'Replace every post for 5 minutes';
  feedTestStatus.textContent = active
    ? `Test active for ${Math.ceil((savedSettings.testModeUntil - Date.now()) / 1000)} more seconds. Reload X Home; all posts qualify while due cards and review slots remain.`
    : 'Bypasses filters, protected accounts, and spacing. Your due cards and daily limit still apply. Normal filters return automatically.';
}

async function toggleFeedTest(): Promise<void> {
  if (!loaded) return;
  feedTestButton.disabled = true;
  try {
    const response = await send({
      type: 'recall:testMode',
      enabled: !isFeedTestActive(savedSettings),
    });
    if (!response.settings) throw new Error('Reload settings and try the feed test again.');
    // Only the test timestamp changed; leave all unsaved form edits and credentials alone.
    savedSettings.testModeUntil = response.settings.testModeUntil;
    savedSettings.enabled = response.settings.enabled;
    field('testModeUntil').value = String(savedSettings.testModeUntil);
    renderFeedTest();
    setNotice(
      isFeedTestActive(savedSettings)
        ? 'Feed test started. Reload X Home to see it. Other unsaved changes are not applied.'
        : 'Feed test stopped. Your normal filters are restored.'
    );
  } catch (error) {
    setNotice(errorMessage(error), true);
  } finally {
    feedTestButton.disabled = false;
  }
}

function field<K extends keyof RecallSettings>(key: K): HTMLInputElement | HTMLTextAreaElement {
  return document.getElementById(key) as HTMLInputElement | HTMLTextAreaElement;
}

async function send(request: RecallRequest): Promise<RecallResponse> {
  const response = (await chrome.runtime.sendMessage(request)) as RecallResponse | undefined;
  if (!response) throw new Error('The extension did not respond. Reload this page and try again.');
  if (!response.ok) throw new Error(response.error || 'The request could not be completed.');
  return response;
}

function setNotice(message: string, error = false): void {
  saveStatus.textContent = message;
  saveStatus.classList.toggle('error', error);
  saveStatus.setAttribute('role', error ? 'alert' : 'status');
}

function updateAiFields(): void {
  const enabled = (field('aiEnabled') as HTMLInputElement).checked;
  for (const key of ['aiKey', 'aiModel', 'filterOffTopic', 'interests'] as const) {
    field(key).disabled = !enabled;
  }
  document.getElementById('ai-fields')!.dataset.disabled = String(!enabled);
  document.getElementById('ai-note')!.textContent = enabled
    ? 'AI is on. Tweet text and your policy are sent to OpenAI. Anki card content is not sent for classification.'
    : 'AI is off. Tweet text stays in your browser; local filtering still works.';
}

function populate(settings: RecallSettings): void {
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof RecallSettings)[]) {
    const input = field(key);
    if (typeof DEFAULT_SETTINGS[key] === 'boolean') {
      (input as HTMLInputElement).checked = Boolean(settings[key]);
    } else {
      input.value = String(settings[key]);
    }
  }
  updateAiFields();
}

function readSettings(): RecallSettings {
  const result = { ...savedSettings };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof RecallSettings)[]) {
    const input = field(key);
    const defaultValue = DEFAULT_SETTINGS[key];
    const value =
      typeof defaultValue === 'boolean'
        ? (input as HTMLInputElement).checked
        : typeof defaultValue === 'number'
          ? Number(input.value)
          : input.value.trim();
    Object.assign(result, { [key]: value });
  }
  return result;
}

function renderStatus(status: RecallStatus): void {
  const badge = document.getElementById('anki-badge')!;
  const summary = document.getElementById('anki-summary')!;
  const detail = document.getElementById('anki-detail')!;
  badge.textContent = status.connected ? 'Connected' : 'Not connected';
  badge.className = `badge ${status.connected ? 'connected' : 'disconnected'}`;
  if (status.connected) {
    summary.textContent = `${status.due} due ${status.due === 1 ? 'card' : 'cards'} ready`;
    detail.textContent = `${status.mathDue} math ${status.mathDue === 1 ? 'card' : 'cards'} due · ${status.decks.length} ${status.decks.length === 1 ? 'deck' : 'decks'} in Anki`;
  } else {
    summary.textContent = 'Anki is not connected yet';
    detail.textContent =
      status.error || 'Open Anki with AnkiConnect installed, then click Connect / test.';
    (document.getElementById('anki-setup') as HTMLDetailsElement).open = true;
  }
}

async function checkStatus(requestPermission = false): Promise<boolean> {
  document.getElementById('anki-badge')!.textContent = 'Checking…';
  try {
    const response = await send({ type: 'recall:status', requestPermission });
    if (!response.status) throw new Error('Anki returned an incomplete status.');
    renderStatus(response.status);
    return response.status.connected;
  } catch (error) {
    renderStatus({ connected: false, due: 0, mathDue: 0, decks: [], error: errorMessage(error) });
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function save(requestPermission = false): Promise<void> {
  if (!loaded || !form.reportValidity()) return;
  if ((field('aiEnabled') as HTMLInputElement).checked && !field('aiKey').value.trim()) {
    setNotice('Add an OpenAI API key to enable AI classification, or switch AI off.', true);
    field('aiKey').focus();
    return;
  }
  saveButton.disabled = true;
  connectButton.disabled = true;
  const revisionAtSave = editRevision;
  setNotice(requestPermission ? 'Saving settings and connecting to Anki…' : 'Saving settings…');
  try {
    const settings = readSettings();
    const response = await send({ type: 'recall:saveSettings', settings });
    savedSettings = response.settings || settings;
    renderFeedTest();
    // Status reads deliberately never repopulate the form: edits made during a check stay intact.
    setNotice('Settings saved. Checking Anki…');
    const connected = await checkStatus(requestPermission);
    setNotice(
      editRevision !== revisionAtSave
        ? 'Settings saved. You also have new unsaved changes.'
        : connected
          ? 'Settings saved. Anki is connected.'
          : 'Settings saved. Connect Anki to start reviewing.'
    );
  } catch (error) {
    setNotice(errorMessage(error), true);
  } finally {
    saveButton.disabled = false;
    connectButton.disabled = false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  void save();
});
connectButton.addEventListener('click', () => {
  void save(true);
});
form.addEventListener('input', () => {
  editRevision += 1;
  if (loaded) setNotice('You have unsaved changes.');
});
field('aiEnabled').addEventListener('change', updateAiFields);
feedTestButton.addEventListener('click', () => {
  void toggleFeedTest();
});
setInterval(renderFeedTest, 1000);

async function initialize(): Promise<void> {
  try {
    const response = await send({ type: 'recall:settings' });
    if (!response.settings)
      throw new Error('Settings could not be loaded. Reload this page to try again.');
    savedSettings = { ...DEFAULT_SETTINGS, ...response.settings };
    populate(savedSettings);
    renderFeedTest();
    loaded = true;
    fields.disabled = false;
    saveButton.disabled = false;
    setNotice('Your preferences are stored in this browser.');
    await checkStatus();
  } catch (error) {
    setNotice(errorMessage(error), true);
    document.getElementById('anki-badge')!.textContent = 'Unavailable';
  }
}

void initialize();
