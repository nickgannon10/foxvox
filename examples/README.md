# Cards for your feed

## ML foundations and multiplication

The September 12, 2026 batch contains original text-only Basic notes:

| File                                        | Cards | Deck                   | Contents                                                                                                                        |
| ------------------------------------------- | ----: | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [ML foundations](recall-ml-foundations.txt) |    24 | Recall::ML Foundations | Learning-rate annealing and scaling laws; on/off-policy; non-stationarity and SFT forgetting; online/offline and sync/async RL. |
| [Multiplication](recall-multiplication.txt) |   120 | Recall::Multiplication | Two-digit products, including squares and easier factors, with a tens-and-ones worked solution on every back.                   |

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

These were inspected as candidates, not imported:

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
Front and Back; the third supplies the deck **Recall::Math**. Confirm those
mappings, the destination deck, and that HTML is enabled. If your Anki profile
does not have a note type named Basic, select its equivalent with Front and Back
fields in the import dialog.

The cards use Anki's built-in MathJax delimiters, `\(...\)` and `\[...\]`, and
need no external images or media. The backs give a short worked explanation, so
try solving the problem before revealing it.

**Introduce the new cards in Anki first.** Recall offers learned cards that Anki
considers due; it deliberately excludes unseen new cards. Leave Recall's math
search at `tag:math`, or use `deck:"Recall::Math"` to select this deck
specifically. Ratings in the real X feed update Anki's schedule; the extension's
sample feed remains separate.

The answers were checked independently using algebra, exact rational
calculations, numerical integration, and direct matrix multiplication.
