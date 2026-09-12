# Cards for your feed

All 178 imported Recall cards live in **General**, alongside the six existing
cards (184 total at consolidation). Tags retain their topic and source grouping,
including `recall::multiplication` for the feed's 25% target. The move preserved
note content, tags, review counts, intervals, and due dates. Empty Recall decks
were removed. All import files and generators now target General.

## Curated LLM research and duplex interaction

The [research batch](recall-llm-research.txt) adds **34 cards** to **General**:

| Group            | Cards | Coverage                                                                                          |
| ---------------- | ----: | ------------------------------------------------------------------------------------------------- |
| MLRF Foundations |    10 | Attention, LoRA, and Switch Transformer routing, capacity, and balancing.                         |
| Recent Papers    |    24 | Olmo 3, mid-training distribution bridging, Olmo Hybrid, DeepSeek-V3.2, PersonaPlex, and DyaPlex. |

MLRF's
[latest checked commit](https://github.com/Mxbonn/MLRF/commit/26ee62a87f7c08049c9701cecfd28648c8de6b2b)
is from May 12, 2026, but its selected LLM material dates to 2017–2021. Recent
repository maintenance does not make those papers new. These cards are useful
foundations for the newer selection. The complete file inventory did not contain
dedicated duplex-speech or modern LLM preference-training collections.

The newer cards use primary sources from 2025–2026, including
[Olmo Hybrid (March 2026)](https://allenai.org/blog/olmohybrid),
[PersonaPlex (January 2026)](https://research.nvidia.com/labs/adlr/personaplex/),
and [DyaPlex (June 2026)](https://arxiv.org/abs/2606.03874). This is a focused
supplement checked on September 12, 2026, not an exhaustive survey of the latest
literature. Benchmark claims are qualified by their experimental setting. Each
card includes its source, year, and check date.

The MLRF selection was rewritten into short, text-only questions and answers,
with links to the pinned source files and original papers. Image-only prompts,
unrelated vision/robotics decks, and PPO topics already covered by the first
batch were excluded. Existing MLRF PPO wording about a guaranteed clipping bound
was not imported. The 24 newer cards are original and are labeled as such,
rather than attributed to MLRF.

All 34 notes were imported and checked through AnkiConnect, including fields,
tags, deck placement, and new-card state. Prior cards' scheduling metadata was
unchanged. The DyaPlex card and its source attribution were visually checked in
Anki's preview. Study the new cards in Anki before they can appear in the feed's
due-card pool. This addition does not change the multiplication cadence.

[Editable research source](recall-llm-research.json) and a repeatable import:

```sh
python3 scripts/prepare-research-cards.py
python3 scripts/prepare-research-cards.py --import-anki
```

The first command writes the UTF-8 text export. The second adds missing notes
via local AnkiConnect and verifies the batch. It does not overwrite existing
notes or submit reviews. The export uses the same column mappings as the
foundation and multiplication files below.

## ML foundations and multiplication

The September 12, 2026 batch contains original text-only Basic notes:

| File                                        | Cards | Deck    | Contents                                                                                                                        |
| ------------------------------------------- | ----: | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [ML foundations](recall-ml-foundations.txt) |    24 | General | Learning-rate annealing and scaling laws; on/off-policy; non-stationarity and SFT forgetting; online/offline and sync/async RL. |
| [Multiplication](recall-multiplication.txt) |   120 | General | Two-digit products, including squares and easier factors, with a tens-and-ones worked solution on every back.                   |

These 144 notes were imported into the local Anki collection and their content,
tags, deck placement, and new-card state verified. No review answers or due-date
changes were submitted. **Study new cards in Anki first** so that they can
become eligible for the extension's due-card pool.

The ML cards have primary-source links on their backs.
[Their editable source](recall-ml-foundations.json) separates several
distinctions that are easy to conflate. The scaling-law cards explain
learning-rate annealing and use Chinchilla as a concrete example; a
paper-specific explanation of the original question still needs the paper name.

The feed targets multiplication on every fourth offer using
`tag:recall::multiplication`, regardless of how many multiplication notes exist
in the collection. Other offers prefer cards without that tag. The target can
vary when either pool runs out of due cards. Reload the extension and X to pick
up the new default; existing preferences are retained.

For another Anki profile, use **File → Import** with either `.txt` file. They
declare tab-separated UTF-8 HTML, Basic notes, deck in column 3, and tags in
column 4. Review those mappings in the import preview. Alternatively, with
AnkiConnect running locally:

```sh
python3 scripts/prepare-recall-cards.py
python3 scripts/prepare-recall-cards.py --import-anki
```

The first command regenerates the files; the second also imports missing notes
and verifies the whole batch. Re-running it recognizes this batch's stable ID
tags and avoids duplicates. It does not overwrite edited existing cards. Set
`ANKICONNECT_API_KEY` in your environment only if your add-on requires one. The
generator checks all 120 answers by repeated addition and partial products, and
excludes reversed duplicates such as both 23 × 47 and 47 × 23.

## Existing collections to consider

MLRF has now contributed the selected, rewritten research cards above. Anki
Science remains a candidate and has not been imported:

| Collection                                                                    | Useful material                                                        | Assessment                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Machine Learning Research Flashcards (MLRF)](https://github.com/Mxbonn/MLRF) | Paper-specific cards for PPO, LoRA, transformers, diffusion, and more. | Best match for a small research supplement. The sampled PPO card overstates clipping as a hard ratio bound; correct it and shorten long answers before importing. Some cards depend on images. |
| [Anki Science](https://github.com/MilesCranmer/anki_science)                  | ML, probability, mathematics, and statistics deck archives.            | A candidate for broader foundations. Inspect a small subject-specific subset first; only the repository inventory and README were checked, not every packaged card.                            |

For the PPO correction, see
[the primary algorithm documentation](https://spinningup.openai.com/en/latest/algorithms/ppo.html):
clipping changes the objective and does not guarantee a hard bound on the actual
probability ratio. The custom batch already includes this distinction. No
third-party card content was copied into this batch.

## Original math starter

[`recall-math-starter.txt`](recall-math-starter.txt) contains 12 original,
worked problems: three each in algebra, calculus, probability, and linear
algebra. They are intended for someone comfortable with introductory college
mathematics. Nothing is imported automatically.

In Anki, choose **File → Import**, select the text file, and review the preview
before importing. Its headers specify UTF-8 tab-separated content, HTML, the
**Basic** note type, and the tags **math recall**. The first two columns are
Front and Back; the third supplies the deck **General**. Confirm those mappings,
the destination deck, and that HTML is enabled. If your Anki profile does not
have a note type named Basic, select its equivalent with Front and Back fields
in the import dialog.

The cards use Anki's built-in MathJax delimiters, `\(...\)` and `\[...\]`, and
need no external images or media. The backs give a short worked explanation, so
try solving the problem before revealing it.

**Introduce the new cards in Anki first.** Recall offers learned cards that Anki
considers due; it deliberately excludes unseen new cards. Leave Recall's math
search at `tag:math`, or use `deck:"General"` to select the shared deck. Ratings
in the real X feed update Anki's schedule; the extension's sample feed remains
separate.

The answers were checked independently using algebra, exact rational
calculations, numerical integration, and direct matrix multiplication.
