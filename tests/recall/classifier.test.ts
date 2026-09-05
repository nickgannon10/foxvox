import { classifyLocally, classifyPost } from '../../src/recall/classifier';
import { DEFAULT_SETTINGS } from '../../src/recall/types';

const post = (text: string, author = 'curious') => ({ id: '123', author, text });
describe('Feed policy', () => {
  it('temporarily replaces every post without calling AI, then restores the policy', async () => {
    const fetcher = jest.fn();
    global.fetch = fetcher;
    const settings = {
      ...DEFAULT_SETTINGS,
      testModeUntil: Date.now() + 300000,
      protectedAccounts: '@curious',
      aiEnabled: true,
      aiKey: 'test-only',
    };
    expect(await classifyPost(post('An ordinary lovely day'), settings)).toMatchObject({
      replace: true,
      reason: 'test',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      classifyLocally(post('An ordinary lovely day'), {
        ...settings,
        testModeUntil: Date.now() - 1,
      }).replace
    ).toBe(false);
    expect(
      classifyLocally(post('An ordinary lovely day'), { ...settings, enabled: false }).replace
    ).toBe(false);
  });
  it('catches politics regardless of party', () => {
    for (const text of [
      'Republicans launch election campaign',
      'Democrats launch election campaign',
    ]) {
      expect(classifyLocally(post(text), DEFAULT_SETTINGS).reason).toBe('politics');
    }
  });
  it('preserves disagreement and technical content', () => {
    for (const text of [
      'I disagree with this proof; the second inequality is wrong.',
      'A political scientist explains eigenvectors',
      'We elected a leader node in the cluster.',
      'Linear algebra is unexpectedly beautiful.',
    ]) {
      expect(classifyLocally(post(text), DEFAULT_SETTINGS).replace).toBe(false);
    }
  });
  it('handles whole user phrases and literal regex characters', () => {
    const settings = { ...DEFAULT_SETTINGS, blockedTerms: 'ai, c++' };
    expect(classifyLocally(post('Painting in the rain'), settings).replace).toBe(false);
    expect(classifyLocally(post('AI today'), settings).reason).toBe('custom');
    expect(classifyLocally(post('C++ today'), settings).reason).toBe('custom');
  });
  it('always honors protected accounts and the pause switch', () => {
    const text = 'Republicans are brainwashed';
    expect(
      classifyLocally(post(text, 'Friend'), { ...DEFAULT_SETTINGS, protectedAccounts: '@friend' })
        .replace
    ).toBe(false);
    expect(classifyLocally(post(text), { ...DEFAULT_SETTINGS, enabled: false }).replace).toBe(
      false
    );
  });
  it('does not send posts to AI unless enabled with a key', async () => {
    const fetcher = jest.fn();
    global.fetch = fetcher;
    await classifyPost(post('A thoughtful article'), { ...DEFAULT_SETTINGS, aiKey: 'test-only' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses only text + policy, validates disabled categories, and caches decisions', async () => {
    const fetcher = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ category: 'off-topic', explanation: 'Unrelated.' }),
            },
          },
        ],
      }),
    });
    global.fetch = fetcher;
    const settings = { ...DEFAULT_SETTINGS, aiEnabled: true, aiKey: 'test-only-2' };
    const result = await classifyPost(post('a unique thoughtful article'), settings);
    expect(result.replace).toBe(false);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.store).toBe(false);
    expect(body.messages[1].content).not.toContain('curious');
    await classifyPost(post('a unique thoughtful article'), settings);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps original content on malformed AI output', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"category":"delete-everything"}' } }],
      }),
    });
    expect(
      (
        await classifyPost(post('another text'), {
          ...DEFAULT_SETTINGS,
          aiEnabled: true,
          aiKey: 'test-only-3',
        })
      ).replace
    ).toBe(false);
  });
});
