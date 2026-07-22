"""
STACK RANKED — Add Compliance Badge Art
=======================================
Attach emblem artwork to a Compliance Badge, then rebuild the badges PDF.
Automates the manual flow: copy the image into badge-images/, set the badge's
"image" field in badges.json, and regenerate docs/Stack_Ranked_Badges.pdf.

    python3 add_badge_image.py <path/to/image.png> <badge>
    python3 add_badge_image.py "~/Downloads/seal.png" fire-safety   # by slug
    python3 add_badge_image.py seal.png 5                           # by number
    python3 add_badge_image.py img.png 5 --dry-run                  # preview, write nothing
    python3 add_badge_image.py img.png 5 --no-regen                 # skip the PDF rebuild
    python3 add_badge_image.py --list                               # show the numbered badges

The <badge> is either the 1-based position in badges.json order (see --list) or
the badge's slug (e.g. "fire-safety"); an unambiguous abbreviation (e.g. "FS")
or a unique name substring also works.

Only badges.json is touched. The image is copied to badge-images/<slug>.<ext>,
where <slug> is the badge's existing `slug` field, so the filename lines up with
the `image` path the config already declares (and with badge-art-prompts.txt).

The badges.json edit is surgical (one badge's block is rewritten in place) so
the file's existing formatting is left untouched.
"""
import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BADGES_JSON = ROOT / "badges.json"
IMAGES_DIR = ROOT / "badge-images"


def set_image_field(raw, badge_slug, image_rel):
    """Return `raw` with the badge whose slug is `badge_slug` having its "image"
    field set to image_rel, editing only that badge's object so all other
    formatting is byte-preserved. Handles both inserting a new field (after the
    last one) and replacing an existing one."""
    anchor = '"slug": ' + json.dumps(badge_slug, ensure_ascii=False)
    if raw.count(anchor) != 1:
        raise SystemExit(f"Cannot locate a unique block for slug {badge_slug!r} "
                         f"(anchor found {raw.count(anchor)} times).")
    lines = raw.split("\n")
    slug_idx = next(i for i, ln in enumerate(lines) if anchor in ln)
    indent = lines[slug_idx][: len(lines[slug_idx]) - len(lines[slug_idx].lstrip())]
    close_idx = next(i for i in range(slug_idx + 1, len(lines))
                     if lines[i].lstrip().startswith("}"))
    new_line = f'{indent}"image": {json.dumps(image_rel, ensure_ascii=False)}'

    for i in range(slug_idx + 1, close_idx):
        if lines[i].lstrip().startswith('"image":'):
            trailing = "," if lines[i].rstrip().endswith(",") else ""
            lines[i] = new_line + trailing
            return "\n".join(lines), "replace"

    last = close_idx - 1  # last existing field; needs a trailing comma
    if not lines[last].rstrip().endswith(","):
        lines[last] = lines[last].rstrip() + ","
    lines.insert(close_idx, new_line)
    return "\n".join(lines), "add"


def resolve_badge(badges, identifier):
    """Find a badge by 1-based number, exact slug, exact abbr, or unique name
    substring (in that order)."""
    if identifier.isdigit():
        n = int(identifier)
        if not (1 <= n <= len(badges)):
            raise SystemExit(f"Badge number {n} out of range (1–{len(badges)}).")
        return badges[n - 1]

    key = identifier.lower()
    for b in badges:
        if b.get("slug", "").lower() == key:
            return b
    for b in badges:
        if b.get("abbr", "").lower() == key:
            return b
    matches = [b for b in badges if key in b.get("name", "").lower()]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        names = ", ".join(b["name"] for b in matches)
        raise SystemExit(f"{identifier!r} matches multiple badges: {names}. Be more specific.")
    raise SystemExit(f"No badge matches {identifier!r} (try --list).")


def print_listing(badges):
    for i, b in enumerate(badges, 1):
        mark = "🖼 " if (ROOT / b.get("image", "")).is_file() else "   "
        print(f"{i:3}  {mark}{b.get('abbr', ''):5} {b['slug']:24}  {b['name']}")


def main():
    ap = argparse.ArgumentParser(description="Attach emblem art to a Compliance Badge and rebuild the PDF.")
    ap.add_argument("image", nargs="?", help="path to the source image")
    ap.add_argument("badge", nargs="?", help="1-based badge number, slug, abbr, or name substring (see --list)")
    ap.add_argument("--list", action="store_true", help="print the numbered badges and exit")
    ap.add_argument("--dry-run", action="store_true", help="show what would change; write nothing")
    ap.add_argument("--no-regen", action="store_true", help="skip regenerating the badges PDF")
    args = ap.parse_args()

    data = json.loads(BADGES_JSON.read_text(encoding="utf-8"))
    badges = data.get("badges", [])
    if not badges:
        raise SystemExit(f"No badges found in {BADGES_JSON}")

    if args.list:
        print_listing(badges)
        return
    if args.badge is None or args.image is None:
        ap.error("the badge and image path are both required (or use --list)")

    badge = resolve_badge(badges, args.badge)
    src = Path(args.image).expanduser()
    if not src.is_file():
        raise SystemExit(f"Image not found: {src}")

    badge_slug = badge["slug"]
    ext = src.suffix.lower() or ".png"
    dest = IMAGES_DIR / f"{badge_slug}{ext}"
    image_rel = f"badge-images/{badge_slug}{ext}"

    print(f"Badge: {badge['name']}  (slug {badge_slug}, from “{badge['training']}”)")
    print(f"  source : {src}")
    print(f"  dest   : {dest.relative_to(ROOT)}")
    print(f"  field  : badges.json → image = {image_rel!r}")
    if badge.get("image") and badge["image"] != image_rel:
        print(f"  note   : replaces existing image {badge['image']!r} (old file left in place)")

    if args.dry_run:
        _, mode = set_image_field(BADGES_JSON.read_text(encoding="utf-8"), badge_slug, image_rel)
        print(f"[dry-run] no changes written; would copy the image, {mode} the image field, "
              "and regenerate the PDF.")
        return

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)

    raw = BADGES_JSON.read_text(encoding="utf-8")
    updated, mode = set_image_field(raw, badge_slug, image_rel)
    json.loads(updated)  # fail loudly if the surgical edit broke JSON
    BADGES_JSON.write_text(updated, encoding="utf-8")
    print(f"Copied image; {'replaced' if mode == 'replace' else 'added'} the image field in badges.json.")

    if args.no_regen:
        print("Skipped PDF regeneration (--no-regen). Run: python3 generate_badges.py")
        return

    import generate_badges
    generate_badges.main()


if __name__ == "__main__":
    main()
