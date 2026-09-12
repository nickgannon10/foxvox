# FoxVox Recall

An experimental Chrome extension that turns unwanted X home-feed posts into real
Anki reviews, plus an extra review after every 10 tweets. Political discussion,
sports coverage, and obvious outrage/engagement bait are replaced with a clearly
labeled study card or a quiet placeholder. Useful posts stay in the feed. **Show
original** always brings the original post back.

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
or engagement-bait phrases, plus clear sports, league, and team-and-game terms.
They run on the computer, explain the replacement, and work without an API key.
They are transparent heuristics, not a comprehensive politics or polarization
detector: ambiguous wording, images, sarcasm, and multilingual posts can be
missed; useful posts can be false positives.

- **Sports posts** is on by default. Local rules catch clear sports coverage
  while avoiding generic terms such as “goal” or machine-learning “F1 score.”
  The optional AI check can also classify sports; the checkbox controls both.
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

The default is **one extra card after every 10 original tweets** encountered
near the viewport. This keeps the tenth tweet and inserts a separate study card
after it. Media-only posts and filtered tweets count toward the interval; the
extra cards do not. Repeated posts are deduplicated within the bounded session
cache. Cadence restarts after navigation, a policy change, or reload. Use
**Dismiss card** or **Skip for now** to remove an extra card without grading it.
Set **Add a review after every…** to 0 to disable insertions.

Both extra cards and replacements share **12 reviews per local calendar day** by
default. Replacement cards have a minimum gap of three intervening posts; the
scheduled insertion interval is independent. When no card is due, the cap is
reached, or Anki is offline, optional insertions are skipped. Filtered posts
still receive an explanatory placeholder. The temporary replace-every-post test
pauses scheduled insertions. Outstanding cards count toward the cap across tabs.
Reservations survive worker restarts, expire after 20 minutes if unsubmitted,
and are revalidated before grading. An ambiguous answer is never blindly
retried. It is reconciled only after a later Anki check demonstrates increased
review count and changed scheduling state. Reloading, discarding, replacing, or
closing a tab releases its unsubmitted cards. Worker startup also clears
reservations belonging to closed tabs. These cleanups preserve uncertain-answer
records so navigation cannot cause a duplicate review. No additional browser
permissions are required.

**Scheduling scope:** `answerCards` invokes Anki's scheduler, including the
collection's configured scheduling algorithm. `findCards` does not reproduce
Anki's ordered study queue, deck daily limits, new-card mixing, or
sibling-burying workflow. Direct answers also record near-zero elapsed study
time. Recall is supplemental due-card practice, not a replacement for Anki's
full study session. Do not simultaneously review the same card in Anki and the
feed: the stale-card check narrows that race but AnkiConnect has no atomic
compare-and-answer API.

## Put math in the mix

Multiplication defaults to every fourth card offer (25%) using the tag
`recall::multiplication`. The other three slots exclude that tag while other
cards are available. Both groups respect your main Anki query and due dates. If
either group has no available due cards, Recall falls back to the other; 25% is
a target for feed offers, not a quota imposed on your collection or Anki
reviews. Skips count as offers, re-fetching an existing card does not, and the
counter persists across tabs and worker restarts until the local day changes.
Set **Aim for multiplication every…** to 0 to disable this preference.

The broader math scope remains `tag:math`, with every third review slot trying
that scope. Multiplication takes priority in its reserved slots and is excluded
from the broader math scope in the other slots while the multiplication mix is
enabled. Other math may also appear in the ordinary due pool. Solve, reveal,
then self-rate honestly; Anki controls the schedule.

The [card collection and import notes](examples/README.md) now include 24
sourced ML concept cards and 120 two-digit multiplication problems with worked
solutions. Another research batch adds 34 cards. All 178 added cards are in
**General**; topics and the multiplication cadence use tags. Use an existing
math deck, or import the [12-card starter](examples/recall-math-starter.txt),
following [the import notes](examples/README.md). Newly imported cards must be
introduced in Anki before the feed can offer them as due reviews. The new
September 12 batch was imported into the local development collection and
verified as 144 new cards; no reviews or due-date changes were submitted. The
older starter file has not been imported into the user's collection.

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
Stress tests also cover 1,200 recycled posts, 100 concurrent card requests, and
50 simultaneous attempts to submit the same mock review. Live X checks exercised
reveal, skip, show-original, rapid scrolling, For you/Following, two-tab card
allocation, navigation away/back, and automatic test expiry. A reload
reservation leak found during those checks is covered by lifecycle regression
tests. Cadence tests cover exact tenth/twentieth placement, media posts,
recycled nodes, dismissal, overlapping sports replacements, unavailable cards,
and late responses after pause. The browser preview exercises sports replacement
and an extra card between its tenth and eleventh tweets. Existing saved settings
inherit the new 10-tweet interval and sports switch while retaining other
preferences.

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
- [Chrome tab lifecycle events and permissions](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs)

MIT licensed, preserving the upstream license and copyright notice.
