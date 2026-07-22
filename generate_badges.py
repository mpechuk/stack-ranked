"""
STACK RANKED — Compliance Badge Token PDF Generator
=====================================================
Builds docs/Stack_Ranked_Badges.pdf: a sheet of punch-out Compliance Badge
tokens — the round seals a player takes when they resolve a Mandatory Training.
There is one badge design per Mandatory Training card (12 of them; see the
`trainings` array in cards.json), and BADGE_COPIES identical tokens are printed
for each so the whole table can stock up — 12 types x 6 = 72 tokens.

Rules-wise Compliance Badges stay fungible (2 to promote into Director, 4 into
VP, per the Career Ladder); the per-training identity printed on each token is a
component flourish, not a rules change. New Manager Training awards two badges,
so its token is stamped with a "x2" — take two of them when you resolve it.

The badge data (name, abbreviation, icon, motto, source training, grant count,
accent color, optional art) is read from badges.json, NOT hardcoded here — edit
that file (and re-run this script) to change what's printed. Each badge may
carry an optional `image` (a centered circular emblem, path relative to the repo
root; see badge-art-prompts.txt for ready-to-use image-generation prompts). Art
is optional — tokens render fine as an icon + monogram seal without it, exactly
like the other generators tolerate missing card/table art.

Run: python3 generate_badges.py
Requires: pip install reportlab pillow
Icons need a color emoji font (Apple Color Emoji on macOS); on platforms without
one, tokens render the monogram + label and simply omit the emoji glyph.
"""
import json
import math
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

from generate_print_and_play import emoji_png_path, icon_tag, xml_escape
from generate_player_mat import (
    BACKGROUND_IMAGE, BURNT_ORANGE, CREAM, MUTED, NAVY, TRACK_BG,
    draw_image_cover, style,
)

ROOT = Path(__file__).resolve().parent
BADGES_JSON = ROOT / "badges.json"
OUTPUT_PDF = ROOT / "docs" / "Stack_Ranked_Badges.pdf"

PAGE_W, PAGE_H = letter  # portrait US Letter
MARGIN = 40
CONTENT_X0, CONTENT_X1 = MARGIN, PAGE_W - MARGIN
CONTENT_Y0, CONTENT_Y1 = MARGIN, PAGE_H - MARGIN
CONTENT_W = CONTENT_X1 - CONTENT_X0

BADGE_COPIES = 6          # tokens printed per badge type (matches the 6 pawns / max players)
TOKENS_PER_ROW = BADGE_COPIES
ROWS_PER_PAGE = 6         # badge types per page; fixed so every token is the same size

INNER_RATIO = 0.74        # inner (cream) disk radius as a fraction of the outer token radius
COMPLIANCE_ICON = "\U0001F396"  # medal, the Compliance-Badge resource emoji

STYLE_TITLE = style("badge_title", 22, 24, bold=True, color=CREAM)
STYLE_SUBTITLE = style("badge_subtitle", 10.5, 13, color=CREAM)
STYLE_INTRO = style("badge_intro", 8.5, 11, color=CREAM)
STYLE_ROW_NAME = style("badge_row_name", 11, 13, bold=True, color=NAVY)
STYLE_ROW_META = style("badge_row_meta", 7.5, 10, italic=True, color=MUTED)


# ---------------------------------------------------------------------------
# badges.json -> list of badge dicts
# ---------------------------------------------------------------------------

def load_badges(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    badges = data.get("badges", [])
    if not badges:
        raise ValueError(f"No badges found in {path}")
    return badges


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

def draw_ring_text(c, cx, cy, radius, text, size, color, position="top",
                   letter_spacing=1.4):
    """Lay `text` out along a circular arc, characters upright to the reader.
    position="top" centers it on the 12 o'clock arc (reads left-to-right);
    position="bottom" centers it on the 6 o'clock arc (also left-to-right)."""
    if not text:
        return
    font = "Helvetica-Bold"
    char_angles = [
        (c.stringWidth(ch, font, size) + letter_spacing) / radius for ch in text
    ]  # radians subtended by each glyph at this radius
    total = sum(char_angles)
    if position == "top":
        angle = 90 + math.degrees(total) / 2   # leftmost glyph, sweeping clockwise
        step_dir = -1
    else:
        angle = 270 - math.degrees(total) / 2  # leftmost glyph, sweeping counter-clockwise
        step_dir = 1
    c.saveState()
    c.setFillColor(color)
    for ch, ca in zip(text, char_angles):
        ca_deg = math.degrees(ca)
        angle += step_dir * ca_deg / 2
        rad = math.radians(angle)
        x = cx + radius * math.cos(rad)
        y = cy + radius * math.sin(rad)
        c.saveState()
        c.translate(x, y)
        c.rotate(angle - 90 if position == "top" else angle + 90)
        c.setFont(font, size)
        c.drawCentredString(0, 0, ch)
        c.restoreState()
        angle += step_dir * ca_deg / 2
    c.restoreState()


def _safe_cover(c, img_path, x, y, w, h):
    """draw_image_cover, but a no-op (returns False) on any unreadable file —
    e.g. a Git-LFS pointer in a checkout without `git lfs pull`. Keeps token
    rendering robust everywhere, matching how the other generators degrade."""
    try:
        return draw_image_cover(c, img_path, x, y, w, h)
    except Exception:
        return False


def _draw_emoji(c, char, cx, cy, size):
    """Draw a color-emoji glyph centered at (cx, cy). Returns False (no-op) if no
    emoji font is available, so the caller can fall back to the monogram."""
    path = emoji_png_path(char)
    if not path:
        return False
    c.drawImage(path, cx - size / 2, cy - size / 2, size, size, mask="auto")
    return True


def draw_token(c, cx, cy, r, badge):
    accent = HexColor(badge.get("accent", "#6a3fa0"))
    inner_r = r * INNER_RATIO

    # Outer ring (accent) + inner cream disk with a thin rule between them.
    c.setFillColor(accent)
    c.circle(cx, cy, r, stroke=0, fill=1)
    c.setFillColor(TRACK_BG)
    c.circle(cx, cy, inner_r, stroke=0, fill=1)
    c.setStrokeColor(CREAM)
    c.setLineWidth(1.1)
    c.circle(cx, cy, (r + inner_r) / 2, stroke=1, fill=0)

    # Arced seal text on the accent ring band.
    band_size = max(4.5, r * 0.16)
    text_r = (r + inner_r) / 2
    draw_ring_text(c, cx, cy, text_r, "SYNERGY CORP", band_size, CREAM, "top")
    draw_ring_text(c, cx, cy, text_r, "COMPLIANCE", band_size, CREAM, "bottom")

    # Center emblem: badge art if present, else emoji icon + monogram.
    img_rel = badge.get("image")
    img_path = ROOT / img_rel if img_rel else None
    drew_art = False
    if img_path and img_path.is_file():
        # Clip the emblem art into the inner disk (a hair inset so no accent bleed).
        c.saveState()
        p = c.beginPath()
        p.circle(cx, cy, inner_r - 1)
        c.clipPath(p, stroke=0, fill=0)
        drew_art = _safe_cover(
            c, img_path, cx - inner_r, cy - inner_r, inner_r * 2, inner_r * 2
        )
        c.restoreState()

    if not drew_art:
        emoji_size = inner_r * 0.85
        has_emoji = _draw_emoji(c, badge.get("icon", ""), cx, cy + inner_r * 0.28, emoji_size)
        # Monogram is always drawn — it carries the token where no emoji font exists.
        c.setFillColor(accent)
        mono_size = inner_r * (0.62 if has_emoji else 0.9)
        c.setFont("Helvetica-Bold", mono_size)
        mono_y = cy - inner_r * (0.12 if has_emoji else 0.0) - mono_size * 0.36
        c.drawCentredString(cx, mono_y, badge.get("abbr", ""))

    # "x2" stamp for trainings that award two badges (e.g. New Manager).
    grants = int(badge.get("grants", 1))
    if grants > 1:
        tag_r = r * 0.26
        tx, ty = cx + r * 0.66, cy - r * 0.66
        c.setFillColor(BURNT_ORANGE)
        c.circle(tx, ty, tag_r, stroke=0, fill=1)
        c.setStrokeColor(CREAM)
        c.setLineWidth(1)
        c.circle(tx, ty, tag_r, stroke=1, fill=0)
        c.setFillColor(CREAM)
        c.setFont("Helvetica-Bold", tag_r * 1.0)
        c.drawCentredString(tx, ty - tag_r * 0.36, f"×{grants}")


def draw_badge_row(c, badge, x0, x1, slot_top, slot_h):
    """Draw one badge type: a header line + a row of BADGE_COPIES tokens."""
    # Header line: badge name (accent) + source training / grant meta.
    name = Paragraph(f"<b>{xml_escape(badge['name'].upper())}</b>", STYLE_ROW_NAME)
    nw, nh = name.wrapOn(c, x1 - x0, 20)
    name.drawOn(c, x0, slot_top - nh)

    grants = int(badge.get("grants", 1))
    copies_note = f"{BADGE_COPIES} tokens"
    grant_note = "grants 2 — take two" if grants > 1 else "grants 1"
    meta = Paragraph(
        f"{icon_tag(COMPLIANCE_ICON, 9)}"
        f"from “{xml_escape(badge['training'])}”  ·  {grant_note}  ·  {copies_note}",
        STYLE_ROW_META,
    )
    mw, mh = meta.wrapOn(c, x1 - x0, 20)
    meta.drawOn(c, x0, slot_top - nh - mh - 1)

    header_h = nh + mh + 8
    # Token band: what's left of this slot below the header.
    band_top = slot_top - header_h
    band_h = slot_h - header_h
    gap = 14
    max_by_w = (x1 - x0 - (TOKENS_PER_ROW - 1) * gap) / TOKENS_PER_ROW
    r = min(max_by_w, band_h - 8) / 2
    cy = band_top - band_h / 2
    step = r * 2 + gap
    total_w = TOKENS_PER_ROW * (r * 2) + (TOKENS_PER_ROW - 1) * gap
    first_cx = x0 + (x1 - x0 - total_w) / 2 + r
    for i in range(TOKENS_PER_ROW):
        draw_token(c, first_cx + i * step, cy, r, badge)


def draw_page_background(c):
    if not _safe_cover(c, BACKGROUND_IMAGE, 0, 0, PAGE_W, PAGE_H):
        c.setFillColor(CREAM)
        c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)


def draw_header(c):
    """Title + short assembly note, page 1 only. Returns the y of its bottom."""
    band_h = 92
    top = CONTENT_Y1
    c.setFillColor(NAVY)
    c.roundRect(CONTENT_X0, top - band_h, CONTENT_W, band_h, 8, stroke=0, fill=1)

    pad = 16
    x = CONTENT_X0 + pad
    title = Paragraph("STACK RANKED", STYLE_TITLE)
    subtitle = Paragraph("COMPLIANCE BADGE TOKENS", STYLE_SUBTITLE)
    intro = Paragraph(
        "Punch-out seals — one design per Mandatory Training. Print on cardstock, "
        "cut round, and take the matching token whenever you resolve that training. "
        "Badges are fungible: 2 promote you into Director, 4 into VP.",
        STYLE_INTRO,
    )
    tw, th = title.wrapOn(c, CONTENT_W - 2 * pad, 30)
    sw, sh = subtitle.wrapOn(c, CONTENT_W - 2 * pad, 16)
    iw, ih = intro.wrapOn(c, CONTENT_W - 2 * pad, 60)
    cursor = top - pad
    title.drawOn(c, x, cursor - th)
    cursor -= th + 3
    subtitle.drawOn(c, x, cursor - sh)
    cursor -= sh + 6
    intro.drawOn(c, x, cursor - ih)
    return top - band_h


def draw_page_footer(c, page_num, total_pages):
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(
        PAGE_W / 2, max(4, MARGIN - 14),
        f"STACK RANKED — Compliance Badge Tokens  (page {page_num} of {total_pages})",
    )


def draw_badges(c, badges):
    total_pages = max(1, math.ceil(len(badges) / ROWS_PER_PAGE))
    for page_idx in range(total_pages):
        chunk = badges[page_idx * ROWS_PER_PAGE:(page_idx + 1) * ROWS_PER_PAGE]
        draw_page_background(c)
        top = CONTENT_Y1
        if page_idx == 0:
            top = draw_header(c) - 14
        # Fixed ROWS_PER_PAGE slot height so tokens are identically sized on
        # every page, even when the last page holds fewer than a full set.
        slot_h = (top - CONTENT_Y0) / ROWS_PER_PAGE
        for i, badge in enumerate(chunk):
            draw_badge_row(c, badge, CONTENT_X0, CONTENT_X1, top - i * slot_h, slot_h)
        draw_page_footer(c, page_idx + 1, total_pages)
        c.showPage()


def main():
    if not BACKGROUND_IMAGE.is_file():
        print(f"Note: no background image at {BACKGROUND_IMAGE.relative_to(ROOT)} — using plain cream background.")
    if emoji_png_path(COMPLIANCE_ICON) is None:
        print("Note: no color emoji font found — tokens render the monogram + label without the center glyph.")

    badges = load_badges(BADGES_JSON)
    missing_art = [b["slug"] for b in badges if not (ROOT / b.get("image", "")).is_file()]
    if missing_art:
        print(f"Note: {len(missing_art)}/{len(badges)} badges have no emblem art yet "
              f"(rendering icon + monogram): {', '.join(missing_art)}")

    OUTPUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT_PDF), pagesize=letter)
    c.setTitle("Stack Ranked — Compliance Badge Tokens")
    draw_badges(c, badges)
    c.save()

    total_tokens = len(badges) * BADGE_COPIES
    total_pages = max(1, math.ceil(len(badges) / ROWS_PER_PAGE))
    print(f"Wrote {OUTPUT_PDF} ({total_pages} pages, {len(badges)} badge types, "
          f"{total_tokens} tokens)")


if __name__ == "__main__":
    main()
