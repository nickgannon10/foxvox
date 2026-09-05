# FoxVox Recall

An experimental Chrome extension that turns unwanted X home-feed posts into real
Anki reviews. Political discussion and obvious outrage/engagement bait are
replaced with a clearly labeled study card or a quiet placeholder. Useful posts
stay in the feed. **Show original** always brings the original post back.

This is a new build target in a fork of
[PalisadeResearch/FoxVox](https://github.com/PalisadeResearch/foxvox). The
upstream project demonstrates AI-driven page rewriting. Recall uses the same
browser extension setting for a user-defined attention policy and spaced
repetition. Upstream code and build commands remain available; Recall does not
load its rewriting prompts, configuration, API keys, or all-sites permissions.

## Try the preview

```sh
npm ci
npm run build:recall
npm run demo:recall
```

Open [the sample feed](http://127.0.0.1:4173/demo.html). It uses the real
content engine and card renderer with an in-memory sample adapter. Try a math
scratchpad, Reveal answer, a rating, Show original, and the offline simulation.
The preview does not contact Anki or OpenAI. Its sample ratings reset on reload.
Extension settings require the installed extension and do not save from the HTTP
preview.

## Load the extension

1. In Chrome, open `chrome://extensions` and enable Developer mode.
2. Select **Load unpacked**, then choose **`dist-recall-chrome`** inside this
   repo. Choose the built directory, not the repository root or upstream
   `dist-chrome`.
3. Open FoxVox Recall's popup and select **Settings**.
4. Keep Anki running. Install **AnkiConnect** using Anki's **Tools → Add-ons →
   Get Add-ons**, code **2055492159**, then restart Anki. This add-on has
   already been installed on the development machine for this first pass.
5. Click **Connect / test** in Recall settings. Allow the exact extension origin
   in Anki if prompted. If it times out while the prompt is open, approve in
   Anki, then test again. An optional API key must match AnkiConnect's own
   configuration. Keep the add-on's default loopback binding; do not allow
   `x.com` or wildcard origins directly.
6. Open or reload [X Home](https://x.com/home). Both For you and Following use
   the same policy. Other routes, profiles, search, dialogs, and DMs are
   excluded.

This build targets Chrome Manifest V3. Reload the extension after rebuilding and
reload existing X tabs. Removing or disabling the extension and reloading X
restores the normal feed. The popup's pause switch restores posts in place.

If Anki connects but no cards appear, open **See it working** in settings and
click **Replace every post for 5 minutes**, then reload X Home. The test
bypasses filters, protected accounts, and card spacing, including posts without
text. A countdown in the feed shows that it is active and how many posts were
detected. Due-card availability and the daily review cap still apply; ratings
still submit real reviews. **Stop test** or the five-minute timeout restores
normal filtering and releases ungraded cards. No AI API key is needed.

The automated browser's security policy blocked opening Chrome's extension
manager during development, so loading the unpacked extension and the first live
X review remain manual. The browser preview was exercised; AnkiConnect API v6,
deck queries, due-card search, and one card's scheduling metadata were verified
read-only against local Anki. **No real review was submitted.** Optional AI has
mocked contract tests but has not been exercised with a paid API key.

## Choose your attention policy

The default local rules match electoral/partisan vocabulary and explicit insults
or engagement-bait phrases. They run on the computer, explain the replacement,
and work without an API key. They are transparent heuristics, not a
comprehensive politics or polarization detector: ambiguous wording, images,
sarcasm, and multilingual posts can be missed; useful posts can be false
positives.

- **Protected accounts** always win during normal filtering. The temporary
  replace-every-post test bypasses them. Enter handles separated by commas or
  lines.
- **Blocked terms** match literal phrases at word boundaries, not regular
  expressions. Enter one per line or separate with commas.
- **AI check** is optional and off by default. Enabling it with an OpenAI key
  sends a post's text plus the chosen policy/interests to OpenAI. It does not
  send your Anki cards, scratchpad, page HTML, account handle, or post
  identifier. Matching local rules do not need an AI request. The model is
  editable.
- The free-form spec controls additional exclusions; category switches take
  precedence over overlapping policy text. **Off-topic filtering** needs the
  optional AI check; local rules do not pretend to understand your interests.
- AI responses use a strict JSON schema and are validated again locally.
  Failure, refusal, malformed output, timeout, or rate limiting leaves the post
  visible. The post is treated as untrusted data, never agent instructions.
- Only nearby posts are processed, with a bounded memory cache and at most 30 AI
  requests per minute per worker. A failed API call starts a one-minute
  cooldown. This is a prototype throttle, not a billing quota; set API spend
  limits in your provider account if you use the optional feature.

## Anki owns the memory

The background worker talks directly to AnkiConnect at `http://127.0.0.1:8765`
using API v6. No MCP service or custom scheduler is necessary.

| Step                 | Behavior                                                                       |
| -------------------- | ------------------------------------------------------------------------------ |
| Find a card          | Anki search, always restricted to due, introduced, unsuspended, unburied cards |
| Display              | Sanitized Anki question; no scheduling mutation                                |
| Reveal               | Anki answer; no scheduling mutation                                            |
| Rate                 | `answerCards` with Again=1, Hard=2, Good=3, Easy=4                             |
| Skip / Show original | Release the reservation; no scheduling mutation                                |
| Unconfirmed answer   | Block retries for that reservation; ask the user to check Anki                 |

The default is **12 reviews per local calendar day**, with three intervening
posts between card offers. Every eligible unwanted post is still filtered; the
gap controls study-card frequency. When no card is due, the cap is reached, or
Anki is offline, a placeholder explains why no card is available. Outstanding
cards count toward the cap across tabs. Reservations survive worker restarts,
expire after 20 minutes if unsubmitted, and are revalidated before grading. An
ambiguous answer is never blindly retried. It is reconciled only after a later
Anki check demonstrates increased review count and changed scheduling state.

**Scheduling scope:** `answerCards` invokes Anki's scheduler, including the
collection's configured scheduling algorithm. `findCards` does not reproduce
Anki's ordered study queue, deck daily limits, new-card mixing, or
sibling-burying workflow. Direct answers also record near-zero elapsed study
time. Recall is supplemental due-card practice, not a replacement for Anki's
full study session. Do not simultaneously review the same card in Anki and the
feed: the stale-card check narrows that race but AnkiConnect has no atomic
compare-and-answer API.

## Put math in the mix

Default math scope: `tag:math`. Every third card offer tries that scope within
the main Anki query, then falls back to another due card when no matching math
is due. Math cards may also occur naturally in the ordinary due pool. There is
no invented schedule or grading of your scratch work: solve, reveal, then
self-rate honestly.

Use an existing math deck, or import the
[12-card starter](examples/recall-math-starter.txt), following
[the import notes](examples/README.md). Newly imported cards must be introduced
in Anki before the feed can offer them as due reviews. On the development
machine the initial read-only check found six due cards and zero with the `math`
tag. The starter file has not been imported into the user's collection.

Bundled KaTeX renders common LaTeX in `\(...\)`, `\[...\]`, `$$...$$`, and
`$...$`. The scratchpad is ephemeral and is never sent to Anki or the optional
AI. Custom Anki JavaScript, CSS, audio, images, embedded documents, and advanced
MathJax macros are not supported in this first pass. Cards with no meaningful
text after sanitization are marked unsupported and cannot be rated here. Cards
mixing text and essential media may still be incomplete; review them in Anki.

## Privacy and boundaries

Credentials live in `chrome.storage.local` restricted to trusted extension
contexts; content scripts receive redacted settings. The worker stores settings,
daily counters, card IDs, hashes of scheduling/rendered state, and temporary
reservation metadata including associated post IDs. Browsing text and classifier
responses are cached only in memory. Card HTML is not persisted by Recall.

Live cards use closed Shadow DOM, stripped active HTML/media/CSS, and trusted
user-click checks for reveal/grade. This reduces ordinary page-script access and
synthetic grading. An embedded UI is **not** a hardened boundary against a
hostile host page: the page can interfere with layout or observe composed input
events, including typing. Do not put secrets into the scratchpad. Stronger
isolation in a dedicated extension-origin frame is a future improvement.

The manifest grants only storage, X/Twitter, loopback AnkiConnect, and the fixed
OpenAI endpoint. Anki data is never routed through the optional model. Cards and
posts are neither published nor messaged. Host permissions include OpenAI to
support the optional setting, but requests require explicit opt-in plus a key.

## Development and verification

```sh
npm run build:recall
npm run type-check:recall
npm run test:recall
```

The Recall tests cover policy behavior and AI failure paths, DOM recycling and
SPA navigation, filtering cadence, sanitization, explicit grades, cross-tab
reservations, daily caps, stale-card rejection, worker restarts, and ambiguous
answer recovery. The sample feed exercises the same renderer/content engine.

Key code: `src/recall/content.ts` (feed lifecycle), `card.ts` (study interface),
`classifier.ts` (policy), `anki.ts` (real reviews), `background.ts` (validated
messages), and `options.ts` (settings). Recall is a separate webpack target;
upstream Chrome/Firefox builds remain under their original commands.

## Sources

- [FoxVox upstream](https://github.com/PalisadeResearch/foxvox)
- [AnkiConnect API](https://git.sr.ht/~foosoft/anki-connect/tree/master/item/README.md)
- [AnkiConnect implementation](https://git.sr.ht/~foosoft/anki-connect/tree/master/item/plugin/__init__.py)
- [Anki search](https://docs.ankiweb.net/searching.html),
  [math](https://docs.ankiweb.net/math.html), and
  [text import](https://docs.ankiweb.net/importing/text-files.html)
- [Chrome extension network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs)

MIT licensed, preserving the upstream license and copyright notice.
