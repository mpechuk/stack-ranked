"""
STACK RANKED — Add Card Art
===========================
Attach artwork to a card by its deck number, then rebuild the print-and-play
PDF. Automates the manual flow: copy the image into cards-images/, set the
card's "image" field in cards.json, and regenerate the PDF.

    python3 add_card_image.py <card_number> <path/to/image.png>
    python3 add_card_image.py 116 "~/Downloads/peter.png"
    python3 add_card_image.py 116 img.png --dry-run     # preview, write nothing
    python3 add_card_image.py 116 img.png --no-regen    # skip the PDF rebuild

The card number is the card's 1-based position in canonical deck order — the
same order game.js registers cards and the print-and-play prints them:
Skill/Tool (Tier 1→3), Project (Early→Evergreen), Office Chaos, Mandatory
Training, Management Style, Feedback. Run with `--list` to see the numbering.

Only cards.json carries "image" (game.js's CARDS deliberately omits it), so
that's the single data file touched. The image is copied to
cards-images/<slug>.<ext>, where <slug> matches game.js's slug() rule, so the
filename lines up with the rest of the deck art.

The cards.json edit is surgical (one card's block is rewritten in place) so the
file's existing formatting — including its idiosyncrasies — is left untouched.
"""
import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CARDS_JSON = ROOT / "cards.json"
IMAGES_DIR = ROOT / "cards-images"

# Human-readable label per category key, for the confirmation line / --list.
CATEGORY_LABELS = {
    "skills.tier1": "Skill/Tool · Tier 1",
    "skills.tier2": "Skill/Tool · Tier 2",
    "skills.tier3": "Skill/Tool · Tier 3",
    "projects.early": "Project · Early",
    "projects.mid": "Project · Mid",
    "projects.late": "Project · Late",
    "projects.evergreen": "Project · Evergreen",
    "events": "Office Chaos",
    "trainings": "Mandatory Training",
    "management": "Management Style",
    "feedback": "Feedback",
}


def slug(name):
    """Mirror game.js's slug(): lowercase, non-alphanumeric runs -> '-'."""
    return re.sub(r"-+$", "", re.sub(r"^-+", "", re.sub(r"[^a-z0-9]+", "-", name.lower())))


def flat_cards(data):
    """Every card in canonical deck order as (category_key, card_dict)."""
    seq = []
    for tier in ("tier1", "tier2", "tier3"):
        seq += [(f"skills.{tier}", c) for c in data["skills"][tier]]
    for stage in ("early", "mid", "late", "evergreen"):
        seq += [(f"projects.{stage}", c) for c in data["projects"][stage]]
    for key in ("events", "trainings", "management"):
        seq += [(key, c) for c in data[key]]
    seq += [("feedback", c) for c in data.get("feedback", [])]
    return seq


def set_image_field(raw, card_name, image_rel):
    """Return `raw` with card_name's "image" field set to image_rel, editing
    only that card's object so all other formatting is byte-preserved. Handles
    both inserting a new field (after the last one) and replacing an existing
    one."""
    anchor = '"name": ' + json.dumps(card_name, ensure_ascii=False)
    if raw.count(anchor) != 1:
        raise SystemExit(f"Cannot locate a unique block for {card_name!r} "
                         f"(anchor found {raw.count(anchor)} times).")
    lines = raw.split("\n")
    name_idx = next(i for i, ln in enumerate(lines) if anchor in ln)
    indent = lines[name_idx][: len(lines[name_idx]) - len(lines[name_idx].lstrip())]
    close_idx = next(i for i in range(name_idx + 1, len(lines))
                     if lines[i].lstrip().startswith("}"))
    new_line = f'{indent}"image": {json.dumps(image_rel, ensure_ascii=False)}'

    for i in range(name_idx + 1, close_idx):
        if lines[i].lstrip().startswith('"image":'):
            trailing = "," if lines[i].rstrip().endswith(",") else ""
            lines[i] = new_line + trailing
            return "\n".join(lines), "replace"

    last = close_idx - 1  # last existing field (flavor); needs a trailing comma
    if not lines[last].rstrip().endswith(","):
        lines[last] = lines[last].rstrip() + ","
    lines.insert(close_idx, new_line)
    return "\n".join(lines), "add"


def resolve_card(seq, number):
    if not (1 <= number <= len(seq)):
        raise SystemExit(f"Card number {number} out of range (1–{len(seq)}).")
    return seq[number - 1]


def print_listing(seq):
    for i, (cat, card) in enumerate(seq, 1):
        mark = "🖼 " if card.get("image") else "   "
        print(f"{i:3}  {mark}{CATEGORY_LABELS.get(cat, cat):22}  {card['name']}")


def main():
    ap = argparse.ArgumentParser(description="Attach art to a card by deck number and rebuild the PDF.")
    ap.add_argument("number", nargs="?", type=int, help="1-based card number in deck order (see --list)")
    ap.add_argument("image", nargs="?", help="path to the source image")
    ap.add_argument("--list", action="store_true", help="print the numbered deck and exit")
    ap.add_argument("--dry-run", action="store_true", help="show what would change; write nothing")
    ap.add_argument("--no-regen", action="store_true", help="skip regenerating the print-and-play PDF")
    args = ap.parse_args()

    data = json.loads(CARDS_JSON.read_text(encoding="utf-8"))
    seq = flat_cards(data)

    if args.list:
        print_listing(seq)
        return
    if args.number is None or args.image is None:
        ap.error("the card number and image path are both required (or use --list)")

    cat, card = resolve_card(seq, args.number)
    src = Path(args.image).expanduser()
    if not src.is_file():
        raise SystemExit(f"Image not found: {src}")

    card_slug = slug(card["name"])
    ext = src.suffix.lower() or ".png"
    dest = IMAGES_DIR / f"{card_slug}{ext}"
    image_rel = f"cards-images/{card_slug}{ext}"

    print(f"Card #{args.number}: {card['name']}  ({CATEGORY_LABELS.get(cat, cat)})")
    print(f"  source : {src}")
    print(f"  dest   : {dest.relative_to(ROOT)}")
    print(f"  field  : cards.json → image = {image_rel!r}")
    if card.get("image") and card["image"] != image_rel:
        print(f"  note   : replaces existing image {card['image']!r} (old file left in place)")

    if args.dry_run:
        # Show the exact edit without touching disk.
        _, mode = set_image_field(CARDS_JSON.read_text(encoding="utf-8"), card["name"], image_rel)
        print(f"[dry-run] no changes written; would copy the image, {mode} the image field, "
              "and regenerate the PDF.")
        return

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)

    raw = CARDS_JSON.read_text(encoding="utf-8")
    updated, mode = set_image_field(raw, card["name"], image_rel)
    json.loads(updated)  # fail loudly if the surgical edit broke JSON
    CARDS_JSON.write_text(updated, encoding="utf-8")
    print(f"Copied image; {'replaced' if mode == 'replace' else 'added'} the image field in cards.json.")

    if args.no_regen:
        print("Skipped PDF regeneration (--no-regen). Run: python3 generate_print_and_play.py")
        return

    import generate_print_and_play as pnp
    pnp.main()


if __name__ == "__main__":
    main()
