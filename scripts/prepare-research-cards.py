"""Prepare the curated LLM research batch; optionally import via local AnkiConnect.

Only missing notes are added. No existing notes, reviews, or schedules are edited.
"""

import argparse
import html
import json
import os
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BATCH = "recall_research_20260912"
SOURCE = ROOT / "examples/recall-llm-research.json"
EXPORT = ROOT / "examples/recall-llm-research.txt"


def anki(action, **params):
    payload = {"action": action, "version": 6, "params": params}
    key = os.environ.get("ANKICONNECT_API_KEY")
    if key:
        payload["key"] = key
    request = urllib.request.Request(
        "http://127.0.0.1:8765",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    if body["error"] is not None:
        raise RuntimeError(body["error"])
    return body["result"]


def link(url, label):
    assert url.startswith("https://")
    return f'<a href="{html.escape(url, quote=True)}">{html.escape(label)}</a>'


def prepare():
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    notes = []
    for card in data["cards"]:
        paper = data["papers"][card["paper"]]
        adapted = "mlrf_file" in paper
        source_label = f'{paper["title"]} ({paper["year"]})'
        attribution = link(paper["url"], source_label)
        if adapted:
            mlrf_url = (
                "https://github.com/Mxbonn/MLRF/blob/"
                + data["mlrf_commit"] + "/flashcards/" + paper["mlrf_file"]
            )
            attribution += "<br>Adapted from " + link(mlrf_url, "MLRF")
            attribution += "; rewritten and checked against the paper."
        else:
            attribution += "<br>Original card based on the linked source."
        back = (
            html.escape(card["back"])
            + "<p><small>" + attribution
            + "<br>Checked " + html.escape(data["checked"]) + ".</small></p>"
        )
        notes.append({
            "deckName": "General",
            "modelName": "Basic",
            "fields": {"Front": html.escape(card["front"]), "Back": back},
            "tags": [
                "recall", BATCH, "recall::llm_research",
                "recall::mlrf_adapted" if adapted else "recall::recent_papers",
                f'recall::{card["topic"]}', f'paper::{card["paper"]}',
                f'paper_year::{paper["year"]}', f'recall_id_llm_{card["id"]}',
            ],
            "options": {"allowDuplicate": False},
        })
    assert len({note["tags"][-1] for note in notes}) == len(notes)
    assert len({note["fields"]["Front"] for note in notes}) == len(notes)
    lines = [
        "#separator:Tab", "#html:true", "#notetype:Basic",
        "#deck column:3", "#tags column:4",
    ]
    for note in notes:
        columns = [
            note["fields"]["Front"], note["fields"]["Back"],
            note["deckName"], " ".join(note["tags"]),
        ]
        assert all("\n" not in text and "\t" not in text for text in columns)
        lines.append("\t".join(columns))
    EXPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return notes


def import_notes(notes):
    assert anki("modelFieldNames", modelName="Basic") == ["Front", "Back"]
    existing_ids = anki("findNotes", query=f"tag:{BATCH}")
    existing = anki("notesInfo", notes=existing_ids) if existing_ids else []
    existing_tags = {tag for note in existing for tag in note["tags"]}
    missing = [note for note in notes if note["tags"][-1] not in existing_tags]
    for deck in sorted({note["deckName"] for note in missing}):
        anki("createDeck", deck=deck)
    if missing:
        checks = anki("canAddNotesWithErrorDetail", notes=missing)
        if len(checks) != len(missing) or not all(c.get("canAdd") for c in checks):
            raise RuntimeError(f"Import preflight failed: {checks}")
        added = anki("addNotes", notes=missing)
        assert len(added) == len(missing) and all(isinstance(nid, int) for nid in added)

    found = anki("findNotes", query=f"tag:{BATCH}")
    assert len(found) == len(notes)
    verified = anki("notesInfo", notes=found)
    by_id = {
        tag: note for note in verified for tag in note["tags"]
        if tag.startswith("recall_id_llm_")
    }
    card_ids = []
    expected_decks = {}
    for note in notes:
        actual = by_id[note["tags"][-1]]
        assert actual["modelName"] == "Basic"
        assert len(actual["cards"]) == 1
        for field, value in note["fields"].items():
            # Opening Anki's editor can normalize entities such as &#x27; to '.
            assert html.unescape(actual["fields"][field]["value"]) == html.unescape(value)
        assert set(note["tags"]).issubset(actual["tags"])
        card_ids.extend(actual["cards"])
        expected_decks[actual["cards"][0]] = note["deckName"]
    for card in anki("cardsInfo", cards=card_ids):
        assert card["deckName"] == expected_decks[card["cardId"]]
    print(f"Added {len(missing)} notes; verified all {len(found)} cards, fields, tags, and decks.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--import-anki", action="store_true")
    args = parser.parse_args()
    prepared = prepare()
    print(f"Prepared {len(prepared)} research cards.")
    if args.import_anki:
        import_notes(prepared)
