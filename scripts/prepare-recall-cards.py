"""Generate original cards; optionally add missing notes via local AnkiConnect.

No review, due-date, deck-option, or scheduling operations are performed.
"""

import argparse
import html
import json
import os
from pathlib import Path
import random
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BATCH = "recall_batch_20260912"


def prepare():
    concepts = json.loads((ROOT / "examples/recall-ml-foundations.json").read_text())
    notes = []
    for card in concepts:
        sources = [card["source"], *card.get("also", [])]
        back = html.escape(card["back"]) + "<p><small>Sources: " + " · ".join(
            f'<a href="{html.escape(url, quote=True)}">{html.escape(url)}</a>' for url in sources
        ) + "</small></p>"
        notes.append({"deckName": "General", "modelName": "Basic",
                      "fields": {"Front": card["front"], "Back": back},
                      "tags": ["recall", BATCH, "recall::ml", f'recall::{card["topic"]}',
                               f'recall_id_{card["id"]}']})

    rng = random.Random(20260912)
    selected = set()
    groups = [
        ([(a, a) for a in range(12, 100)], 15),
        ([(a, b) for a in [10, 20, 25, 30, 40, 50, 75] for b in range(a, 100)], 15),
        ([(a, b) for a in range(11, 30) for b in range(a, 50)], 30),
        ([(a, b) for a in range(20, 100) for b in range(a, 100)], 60),
    ]
    for pool, count in groups:
        selected.update(rng.sample([p for p in pool if p not in selected], count))
    pairs = sorted(selected)
    rng.shuffle(pairs)
    assert len(pairs) == 120
    for a, b in pairs:
        tens, ones = divmod(b, 10)
        product = a * b
        # Check independently by repeated addition and by four partial products.
        assert product == sum(a for _ in range(b))
        assert product == (a // 10 * 10) * (b // 10 * 10) + (a % 10) * (b // 10 * 10) + (a // 10 * 10) * (b % 10) + (a % 10) * (b % 10)
        notes.append({"deckName": "General", "modelName": "Basic",
                      "fields": {"Front": f"Compute mentally: \\({a} \\times {b}\\).",
                                 "Back": f"\\[\\boxed{{{product}}}\\]<p>Split {b} into tens and ones:</p>\\[{a}({tens * 10}+{ones})={a * tens * 10}+{a * ones}={product}.\\]"},
                      "tags": ["recall", "math", "recall::multiplication", "two_digit", BATCH,
                               f"recall_id_mul_{a}_{b}"]})
    assert len({n["fields"]["Front"] for n in notes}) == len(notes)
    for name, subset in [("recall-ml-foundations.txt", notes[:len(concepts)]),
                         ("recall-multiplication.txt", notes[len(concepts):])]:
        lines = ["#separator:Tab", "#html:true", "#notetype:Basic", "#deck column:3", "#tags column:4"]
        for note in subset:
            columns = [note["fields"]["Front"], note["fields"]["Back"], note["deckName"], " ".join(note["tags"])]
            assert all("\n" not in c and "\t" not in c for c in columns)
            lines.append("\t".join(columns))
        (ROOT / "examples" / name).write_text("\n".join(lines) + "\n")
    return notes


def anki(action, **params):
    payload = {"action": action, "version": 6, "params": params}
    if os.environ.get("ANKICONNECT_API_KEY"):
        payload["key"] = os.environ["ANKICONNECT_API_KEY"]
    request = urllib.request.Request("http://127.0.0.1:8765", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
    response = json.load(urllib.request.urlopen(request, timeout=30))
    if response["error"]:
        raise RuntimeError(response["error"])
    return response["result"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--import-anki", action="store_true")
    args = parser.parse_args()
    notes = prepare()
    print(f"Prepared {len(notes)} notes: 24 ML concepts and 120 multiplication problems.")
    if args.import_anki:
        assert anki("modelFieldNames", modelName="Basic") == ["Front", "Back"]
        existing_ids = anki("findNotes", query=f"tag:{BATCH}")
        existing = anki("notesInfo", notes=existing_ids) if existing_ids else []
        existing_tags = {tag for n in existing for tag in n["tags"]}
        missing = [n for n in notes if n["tags"][-1] not in existing_tags]
        for deck in sorted({n["deckName"] for n in missing}):
            anki("createDeck", deck=deck)
        for n in missing:
            n["options"] = {"allowDuplicate": False}
        if missing:
            checks = anki("canAddNotesWithErrorDetail", notes=missing)
            if not all(c.get("canAdd") for c in checks):
                raise RuntimeError(f"Import preflight failed: {checks}")
            ids = anki("addNotes", notes=missing)
            assert len(ids) == len(missing) and all(isinstance(i, int) for i in ids)
        found = anki("findNotes", query=f"tag:{BATCH}")
        assert len(found) == len(notes)
        verified = anki("notesInfo", notes=found)
        by_front = {n["fields"]["Front"]["value"]: n for n in verified}
        for n in notes:
            actual = by_front[n["fields"]["Front"]]
            # Anki's editor may normalize equivalent HTML entities while displaying a note.
            assert html.unescape(actual["fields"]["Back"]["value"]) == html.unescape(n["fields"]["Back"])
            assert set(n["tags"]).issubset(actual["tags"])
        print(f"Added {len(missing)} notes; verified all {len(found)}. No reviews or scheduling changes submitted.")
