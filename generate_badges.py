"""
STACK RANKED — Compliance Badge Token PDF Generator
=====================================================
Builds docs/Stack_Ranked_Badges.pdf: a title cover followed by punch-out
Compliance Badge sheets — the square seals a player takes when they resolve a
Mandatory Training, each headed with its source-training name. Every badge sheet
places its tokens on the SAME fixed grid, so you can stack the printed sheets and
cut them all in one pass. There is one badge design per Mandatory Training card
(12 of them; see the `trainings` array in cards.json), and BADGE_COPIES identical
tokens are printed for each so the whole table can stock up — 12 types x 6 = 72
tokens.

Rules-wise Compliance Badges stay fungible (2 to promote into Director, 4 into
VP, per the Career Ladder); the per-training identity printed on each token is a
component flourish, not a rules change. New Manager Training awards two badges,
so its token is stamped with a "x2" — take two of them when you resolve it.

The badge data (name, abbreviation, icon, motto, source training, grant count,
accent color, optional art) is read from badges.json, NOT hardcoded here — edit
that file (and re-run this script) to change what's printed. Each badge may
carry an optional `image` (a centered circular emblem, path relative to the repo
root; see badge-art-prompts.txt for ready-to-use image-generation prompts). The
emblem fills a square below the header. Art is optional — tokens render fine as
an icon + monogram seal without it, exactly like the other generators tolerate
missing card/table art.

Run: python3 generate_badges.py
Requires: pip install reportlab pillow
Icons need a color emoji font (Apple Color Emoji on macOS); on platforms without
one, tokens render the monogram + label and simply omit the emoji glyph.
"""
import json
import math
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

from generate_print_and_play import emoji_png_path, xml_escape
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
COLS = BADGE_COPIES       # square tokens per row (one row per badge type)
ROWS_PER_PAGE = 6         # badge types per page; fixed so every token is the same size
TOKEN_GAP = 0.1 * inch    # spacing between adjacent square tokens (both axes)

COMPLIANCE_ICON = "\U0001F396"  # medal, the Compliance-Badge resource emoji

STYLE_COVER_TITLE = style("badge_cover_title", 34, 38, alignment=TA_CENTER, bold=True, color=CREAM)
STYLE_COVER_SUB = style("badge_cover_sub", 13, 16, alignment=TA_CENTER, color=CREAM)
STYLE_COVER_INTRO = style("badge_cover_intro", 10, 14, alignment=TA_CENTER, color=CREAM)
STYLE_COVER_NOTE = style("badge_cover_note", 9, 12, alignment=TA_CENTER, italic=True, color=HexColor("#b9ad92"))


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


def _fit_header(c, text, avail_w, max_h):
    """Build a centered training-name Paragraph that fits within
    (avail_w x max_h), shrinking the font until it does. Returns
    (paragraph, width, height)."""
    fs = max(4.0, avail_w * 0.11)
    while True:
        st = style("badge_token_hdr", fs, fs * 1.12, alignment=TA_CENTER,
                   bold=True, color=CREAM)
        para = Paragraph(f"<b>{xml_escape(text.upper())}</b>", st)
        w, h = para.wrapOn(c, avail_w, max_h * 4)
        if h <= max_h or fs <= 4.0:
            return para, w, h
        fs -= 0.5


def draw_token(c, cx, cy, s, badge):
    """One square Compliance-Badge token, side `s`, centered at (cx, cy):
    an accent frame, the source-training name as an auto-fit header band, and
    the emblem art (or emoji + monogram fallback) filling a square below it."""
    accent = HexColor(badge.get("accent", "#6a3fa0"))
    x0, y0 = cx - s / 2, cy - s / 2
    pad = s * 0.06

    # Accent frame (the whole square).
    c.setFillColor(accent)
    c.roundRect(x0, y0, s, s, s * 0.08, stroke=0, fill=1)

    # Header band: source-training name, cream on the accent, wrapped to fit
    # the top ~32% of the token (art shrinks to take whatever is left below).
    hdr, _, hh = _fit_header(c, badge.get("training", ""), s - 2 * pad, s * 0.32)
    hdr_top = y0 + s - pad
    hdr.drawOn(c, x0 + pad, hdr_top - hh)

    # Emblem: the largest square that fits below the header, centered.
    em_top = hdr_top - hh - s * 0.05
    em_bottom = y0 + pad
    em_w = s - 2 * pad
    em_side = min(em_w, em_top - em_bottom)
    ex = cx - em_side / 2
    ey = em_bottom + (em_top - em_bottom - em_side) / 2

    # Cream backing + thin keyline for the emblem.
    c.setFillColor(TRACK_BG)
    c.rect(ex, ey, em_side, em_side, stroke=0, fill=1)

    img_rel = badge.get("image")
    img_path = ROOT / img_rel if img_rel else None
    drew_art = False
    if img_path and img_path.is_file():
        # Clip the emblem art into its square (a hair inset so no accent bleed).
        c.saveState()
        p = c.beginPath()
        p.rect(ex + 0.5, ey + 0.5, em_side - 1, em_side - 1)
        c.clipPath(p, stroke=0, fill=0)
        drew_art = _safe_cover(c, img_path, ex, ey, em_side, em_side)
        c.restoreState()

    if not drew_art:
        emoji_size = em_side * 0.5
        has_emoji = _draw_emoji(c, badge.get("icon", ""), cx, ey + em_side * 0.62, emoji_size)
        # Monogram is always drawn — it carries the token where no emoji font exists.
        c.setFillColor(accent)
        mono_size = em_side * (0.32 if has_emoji else 0.5)
        c.setFont("Helvetica-Bold", mono_size)
        mono_y = ey + em_side * (0.26 if has_emoji else 0.5) - mono_size * 0.36
        c.drawCentredString(cx, mono_y, badge.get("abbr", ""))

    c.setStrokeColor(CREAM)
    c.setLineWidth(1.1)
    c.rect(ex, ey, em_side, em_side, stroke=1, fill=0)

    # "x2" stamp for trainings that award two badges (e.g. New Manager).
    grants = int(badge.get("grants", 1))
    if grants > 1:
        tag_r = s * 0.13
        tx, ty = x0 + s - tag_r * 0.85, y0 + tag_r * 0.85
        c.setFillColor(BURNT_ORANGE)
        c.circle(tx, ty, tag_r, stroke=0, fill=1)
        c.setStrokeColor(CREAM)
        c.setLineWidth(1)
        c.circle(tx, ty, tag_r, stroke=1, fill=0)
        c.setFillColor(CREAM)
        c.setFont("Helvetica-Bold", tag_r * 1.0)
        c.drawCentredString(tx, ty - tag_r * 0.36, f"×{grants}")


def draw_page_background(c):
    if not _safe_cover(c, BACKGROUND_IMAGE, 0, 0, PAGE_W, PAGE_H):
        c.setFillColor(CREAM)
        c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)


def draw_title_page(c, badges):
    """Standalone cover page — title, subtitle, and how-to note, no tokens.
    Keeping it token-free is what lets every badge sheet that follows share one
    identical grid, so a stack of them can be cut in a single pass."""
    draw_page_background(c)

    pad = 30
    inner_w = CONTENT_W - 2 * pad
    gap = 10
    rule_gap = 16

    medal = emoji_png_path(COMPLIANCE_ICON)
    medal_size = 60 if medal else 0

    title = Paragraph("STACK RANKED", STYLE_COVER_TITLE)
    subtitle = Paragraph("COMPLIANCE BADGE TOKENS", STYLE_COVER_SUB)
    intro = Paragraph(
        "Punch-out seals — one design per Mandatory Training, each token headed "
        "with its training name. Print the sheets on cardstock, stack them, and cut "
        "once: every sheet shares the same square grid. Take the matching token "
        "whenever you resolve that training. Badges are fungible — 2 promote you "
        "into Director, 4 into VP.",
        STYLE_COVER_INTRO,
    )
    note = Paragraph(
        f"{len(badges)} badge designs  ·  {BADGE_COPIES} tokens each  ·  "
        f"{len(badges) * BADGE_COPIES} tokens total",
        STYLE_COVER_NOTE,
    )

    tw, th = title.wrapOn(c, inner_w, 60)
    sw, sh = subtitle.wrapOn(c, inner_w, 30)
    iw, ih = intro.wrapOn(c, inner_w, 160)
    nw, nh = note.wrapOn(c, inner_w, 30)

    medal_block = (medal_size + gap) if medal else 0
    content_h = medal_block + th + gap + sh + rule_gap + ih + gap + nh
    panel_h = content_h + 2 * pad
    py = (PAGE_H - panel_h) / 2
    panel_top = py + panel_h

    c.setFillColor(NAVY)
    c.roundRect(CONTENT_X0, py, CONTENT_W, panel_h, 12, stroke=0, fill=1)

    cx = CONTENT_X0 + CONTENT_W / 2
    xl = CONTENT_X0 + pad
    cursor = panel_top - pad
    if medal:
        c.drawImage(medal, cx - medal_size / 2, cursor - medal_size,
                    medal_size, medal_size, mask="auto")
        cursor -= medal_size + gap
    title.drawOn(c, xl, cursor - th)
    cursor -= th + gap
    subtitle.drawOn(c, xl, cursor - sh)
    cursor -= sh + rule_gap / 2
    c.setStrokeColor(CREAM)
    c.setLineWidth(1)
    c.line(cx - inner_w * 0.22, cursor, cx + inner_w * 0.22, cursor)
    cursor -= rule_gap / 2
    intro.drawOn(c, xl, cursor - ih)
    cursor -= ih + gap
    note.drawOn(c, xl, cursor - nh)
    c.showPage()


def draw_page_footer(c, page_num, total_pages):
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(
        PAGE_W / 2, max(4, MARGIN - 14),
        f"STACK RANKED — Compliance Badge Tokens  (sheet {page_num} of {total_pages})",
    )


def draw_badges(c, badges):
    """Badge sheets. Every sheet places its tokens on the SAME fixed grid (same
    positions, sized for a full ROWS_PER_PAGE page) so the stack cuts in one
    pass; a short final sheet simply leaves its trailing rows empty."""
    sheets = max(1, math.ceil(len(badges) / ROWS_PER_PAGE))
    # Square side is width-driven (constant across sheets) so every token is the
    # same size: COLS squares + (COLS-1) TOKEN_GAP gaps span the content width.
    side = (CONTENT_W - (COLS - 1) * TOKEN_GAP) / COLS
    row_pitch = side + TOKEN_GAP  # one badge type per row, TOKEN_GAP between rows
    # Center the full ROWS_PER_PAGE grid vertically; this top is identical on
    # every sheet regardless of how many rows it actually carries.
    grid_h = ROWS_PER_PAGE * side + (ROWS_PER_PAGE - 1) * TOKEN_GAP
    grid_top = CONTENT_Y1 - max(0, (CONTENT_Y1 - CONTENT_Y0 - grid_h) / 2)
    for sheet_idx in range(sheets):
        chunk = badges[sheet_idx * ROWS_PER_PAGE:(sheet_idx + 1) * ROWS_PER_PAGE]
        draw_page_background(c)
        for i, badge in enumerate(chunk):
            cy = grid_top - i * row_pitch - side / 2
            for col in range(COLS):
                cx = CONTENT_X0 + col * (side + TOKEN_GAP) + side / 2
                draw_token(c, cx, cy, side, badge)
        draw_page_footer(c, sheet_idx + 1, sheets)
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
    draw_title_page(c, badges)
    draw_badges(c, badges)
    c.save()

    total_tokens = len(badges) * BADGE_COPIES
    sheets = max(1, math.ceil(len(badges) / ROWS_PER_PAGE))
    print(f"Wrote {OUTPUT_PDF} (1 cover + {sheets} badge sheets, {len(badges)} badge "
          f"types, {total_tokens} tokens)")


if __name__ == "__main__":
    main()
