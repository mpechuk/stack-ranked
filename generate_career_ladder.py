"""
STACK RANKED — Career Ladder Board PDF Generator
===================================================
Builds docs/Stack_Ranked_CareerLadder.pdf: the shared "Career Ladder board
(7 rungs, Intern through CEO)" called for by the rulebook's Components list —
a single landscape US Letter page with one ascending platform per rung
(title, Action Points, Career Capital threshold, Badges required, and a row
of pawn slots players can place their wooden pawn tokens on), plus a Quick
Reference strip.

The rung data and Quick Reference notes are read from leaderboard.md, not
hardcoded here — edit that file (and re-run this script) to change what's
printed on the board.

The board reuses the same optional background texture as the Player Desk mat
(table-images/player-mat-background.png) and carries its own header banner
(table-images/career_ladder.jpeg; see career-ladder-art-prompts.txt for the
image-generation prompt it was made from). Both are purely decorative — the
board renders fine with neither.

Run: python3 generate_career_ladder.py
Requires: pip install reportlab pillow
"""
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

from generate_print_and_play import RESOURCE_EMOJI, icon_tag, xml_escape
from generate_player_mat import (
    BACKGROUND_IMAGE, BURNT_ORANGE, CONTENT_X0, CONTENT_X1, CONTENT_Y0, CONTENT_Y1,
    CREAM, INK, MUTED, NAVY, PAGE_H, PAGE_W, RULE, STYLE_REF_BODY, STYLE_REF_HEAD,
    STYLE_SUBTITLE, STYLE_TITLE, TRACK_BG, draw_image_cover, draw_placeholder, style,
)

ROOT = Path(__file__).resolve().parent
LEADERBOARD_MD = ROOT / "leaderboard.md"
OUTPUT_PDF = ROOT / "docs" / "Stack_Ranked_CareerLadder.pdf"

HEADER_IMAGE = ROOT / "table-images" / "career_ladder.jpeg"

CONTENT_W = CONTENT_X1 - CONTENT_X0
PAWN_SLOTS = 6  # matches the rulebook's 6 wooden pawns / max player count

STYLE_TAGLINE = style("ladder_tagline", 9, 12, italic=True, color=CREAM)
STYLE_RUNG_TITLE = style("rung_title", 8.5, 10, alignment=TA_CENTER, color=NAVY, bold=True)
STYLE_RUNG_STAT = style("rung_stat", 7.5, 9.5, alignment=TA_CENTER, color=INK)
STYLE_FORMULA = style("stack_rank_formula", 15, 18, alignment=TA_CENTER, color=BURNT_ORANGE, bold=True)


# ---------------------------------------------------------------------------
# leaderboard.md -> structured data
# ---------------------------------------------------------------------------

_TABLE_ROW = re.compile(r"^\|(.+)\|\s*$")


def parse_leaderboard(path):
    lines = path.read_text(encoding="utf-8").splitlines()

    table_rows = [l for l in lines if _TABLE_ROW.match(l)]
    if len(table_rows) < 3:
        raise ValueError(f"No markdown table found in {path}")
    header = [c.strip() for c in table_rows[0].strip("|").split("|")]
    rungs = []
    for line in table_rows[2:]:  # skip the header separator row
        cells = [c.strip() for c in line.strip("|").split("|")]
        row = dict(zip(header, cells))
        rungs.append({
            "rung": row.get("Rung", ""),
            "title": row.get("Title", ""),
            "ap": row.get("Action Points", ""),
            "cc": row.get("Career Capital to Promote In", ""),
            "badges": row.get("Badges Required", ""),
        })

    sections = {}
    current = None
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## "):
            current = stripped[3:].strip().lower()
            sections[current] = []
            continue
        if current and stripped:
            sections[current].append(stripped)

    notes = [n[2:].strip() for n in sections.get("quick reference", []) if n.startswith("- ")]
    formula = " ".join(sections.get("stack rank formula", []))

    return {"rungs": rungs, "notes": notes, "formula": formula}


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

def _image_aspect(path):
    """width/height of an image file, or None if it's missing/unreadable."""
    if not path.is_file():
        return None
    try:
        iw, ih = ImageReader(str(path)).getSize()
        return iw / ih
    except Exception:
        return None


def draw_header(c):
    top = CONTENT_Y1
    left_w = 280
    right_w = CONTENT_X1 - (CONTENT_X0 + left_w)

    # Size the banner to the header image's own aspect ratio so it displays
    # in full — no "cover" cropping — rather than a height tuned by hand for
    # a differently-shaped source image.
    aspect = _image_aspect(HEADER_IMAGE)
    header_h = right_w / aspect if aspect else 96

    left_x0, left_x1 = CONTENT_X0, CONTENT_X0 + left_w
    right_x0, right_x1 = left_x1, CONTENT_X1

    c.setFillColor(NAVY)
    c.rect(left_x0, top - header_h, left_w, header_h, stroke=0, fill=1)

    if not draw_image_cover(c, HEADER_IMAGE, right_x0, top - header_h,
                             right_x1 - right_x0, header_h, valign="top"):
        draw_placeholder(c, right_x0, top - header_h, right_x1 - right_x0, header_h,
                          "(header banner — see career-ladder-art-prompts.txt)")

    pad = 14
    title = Paragraph("STACK RANKED", STYLE_TITLE)
    subtitle = Paragraph("CAREER LADDER BOARD", STYLE_SUBTITLE)
    tagline = Paragraph("Every player's pawn starts at Intern — move it up as you promote.",
                         STYLE_TAGLINE)

    tw, th = title.wrapOn(c, left_w - 2 * pad, 30)
    sw, sh = subtitle.wrapOn(c, left_w - 2 * pad, 16)
    tlw, tlh = tagline.wrapOn(c, left_w - 2 * pad, 40)
    block_h = th + 4 + sh + 10 + tlh

    # Vertically center the text block in the navy plate — it no longer
    # tracks a fixed header_h, so a fixed top-anchored offset would leave a
    # growing gap under the tagline whenever the header image is tall.
    ty = top - max(pad, (header_h - block_h) / 2) - block_h

    title.drawOn(c, left_x0 + pad, ty + block_h - th)
    subtitle.drawOn(c, left_x0 + pad, ty + block_h - th - 4 - sh)
    tagline.drawOn(c, left_x0 + pad, ty)

    return top - header_h


def draw_rung_platform(c, x, y_bottom, w, h, rung):
    c.saveState()
    c.setFillColor(TRACK_BG)
    c.roundRect(x, y_bottom, w, h, 8, stroke=0, fill=1)
    c.setStrokeColor(RULE)
    c.setLineWidth(1.2)
    c.roundRect(x, y_bottom, w, h, 8, stroke=1, fill=0)
    c.restoreState()

    cx = x + w / 2
    top = y_bottom + h

    badge_r = 15
    badge_cy = top - 10 - badge_r
    c.saveState()
    c.setFillColor(BURNT_ORANGE)
    c.circle(cx, badge_cy, badge_r, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(cx, badge_cy - 5, rung["rung"])
    c.restoreState()

    cursor = badge_cy - badge_r - 6

    title_p = Paragraph(f"<b>{xml_escape(rung['title'].upper())}</b>", STYLE_RUNG_TITLE)
    tw, th = title_p.wrapOn(c, w - 12, 30)
    title_p.drawOn(c, x + 6, cursor - th)
    cursor -= th + 6

    c.saveState()
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.line(x + 10, cursor, x + w - 10, cursor)
    c.restoreState()
    cursor -= 10

    stat_lines = [
        (RESOURCE_EMOJI["Action Point"], "AP", rung["ap"]),
        (RESOURCE_EMOJI["Career Capital"], "TO\u00a0ENTER", rung["cc"]),
    ]
    if rung["badges"] and rung["badges"] != "—":
        stat_lines.append((RESOURCE_EMOJI["Compliance Badge"], "BADGES", rung["badges"]))

    for emoji, label, value in stat_lines:
        line = Paragraph(
            f"{icon_tag(emoji, 9)}<b>{xml_escape(value)}</b> "
            f"<font size=6>{xml_escape(label)}</font>",
            STYLE_RUNG_STAT,
        )
        lw, lh = line.wrapOn(c, w - 12, 24)
        line.drawOn(c, x + 6, cursor - lh)
        cursor -= lh + 3

    slot_r = 5
    slot_gap = 4
    slot_y = y_bottom + 14
    total_slot_w = PAWN_SLOTS * (slot_r * 2 + slot_gap) - slot_gap
    slot_x0 = cx - total_slot_w / 2
    c.saveState()
    c.setStrokeColor(MUTED)
    c.setLineWidth(0.8)
    for i in range(PAWN_SLOTS):
        sx = slot_x0 + i * (slot_r * 2 + slot_gap) + slot_r
        c.circle(sx, slot_y, slot_r, stroke=1, fill=0)
    c.restoreState()


def draw_ladder(c, rungs, x0, x1, y0, y1):
    n = len(rungs)
    gutter = 10
    col_w = (x1 - x0) / n
    platform_w = col_w - gutter
    platform_h = 160
    step_rise = (y1 - y0 - platform_h) / (n - 1) if n > 1 else 0

    centers = [
        (x0 + i * col_w + gutter / 2 + platform_w / 2, y0 + i * step_rise)
        for i in range(n)
    ]

    c.saveState()
    c.setStrokeColor(BURNT_ORANGE)
    c.setLineWidth(3)
    c.setDash(2, 4)
    for (cx0, yb0), (cx1, yb1) in zip(centers, centers[1:]):
        c.line(cx0, yb0 + platform_h / 2, cx1, yb1 + platform_h / 2)
    c.setDash()
    c.restoreState()

    for i, rung in enumerate(rungs):
        col_x = x0 + i * col_w + gutter / 2
        y_bottom = y0 + i * step_rise
        draw_rung_platform(c, col_x, y_bottom, platform_w, platform_h, rung)


def draw_quick_reference(c, x, y, w, h, formula, notes):
    c.saveState()
    c.setFillColor(TRACK_BG)
    c.roundRect(x, y, w, h, 6, stroke=0, fill=1)
    c.setStrokeColor(RULE)
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, 6, stroke=1, fill=0)
    c.restoreState()

    pad = 14
    divider_x = x + w * 0.42

    # --- Left: Stack Rank Formula, in bold large letters ---------------
    left_x, left_w = x + pad, divider_x - x - pad - 10
    cursor = y + h - 14

    formula_head = Paragraph("<b>STACK RANK FORMULA</b>", STYLE_REF_HEAD)
    fhw, fhh = formula_head.wrapOn(c, left_w, 14)
    formula_head.drawOn(c, left_x, cursor - fhh)
    cursor -= fhh + 8

    formula_p = Paragraph(xml_escape(formula), STYLE_FORMULA)
    fw, fh = formula_p.wrapOn(c, left_w, h)
    formula_p.drawOn(c, left_x, cursor - fh)

    c.saveState()
    c.setStrokeColor(RULE)
    c.setLineWidth(1)
    c.line(divider_x, y + 10, divider_x, y + h - 10)
    c.restoreState()

    # --- Right: Quick Reference bullets ---------------------------------
    right_x = divider_x + 16
    right_w = x + w - pad - right_x
    cursor = y + h - 14

    heading = Paragraph("<b>QUICK REFERENCE</b>", STYLE_REF_HEAD)
    hw, hh = heading.wrapOn(c, right_w, 14)
    heading.drawOn(c, right_x, cursor - hh)
    cursor -= hh + 4

    bullets = "<br/>".join(f"•&nbsp;&nbsp;{xml_escape(n)}" for n in notes)
    body = Paragraph(bullets, STYLE_REF_BODY)
    bw, bh = body.wrapOn(c, right_w, 200)
    body.drawOn(c, right_x, cursor - bh)


def draw_board(c, data):
    if not draw_image_cover(c, BACKGROUND_IMAGE, 0, 0, PAGE_W, PAGE_H):
        c.setFillColor(CREAM)
        c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    header_bottom = draw_header(c)

    notes_h = 112
    draw_quick_reference(c, CONTENT_X0, CONTENT_Y0, CONTENT_W, notes_h, data["formula"], data["notes"])

    ladder_top = header_bottom - 14
    ladder_bottom = CONTENT_Y0 + notes_h + 16
    draw_ladder(c, data["rungs"], CONTENT_X0, CONTENT_X1, ladder_bottom, ladder_top)


def main():
    if not HEADER_IMAGE.is_file():
        print(f"Note: no header image at {HEADER_IMAGE.relative_to(ROOT)} — using placeholder.")
    if not BACKGROUND_IMAGE.is_file():
        print(f"Note: no background image at {BACKGROUND_IMAGE.relative_to(ROOT)} — using plain cream background.")

    data = parse_leaderboard(LEADERBOARD_MD)

    OUTPUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT_PDF), pagesize=(PAGE_W, PAGE_H))
    c.setTitle("Stack Ranked — Career Ladder Board")
    draw_board(c, data)
    c.showPage()
    c.save()
    print(f"Wrote {OUTPUT_PDF} ({len(data['rungs'])} rungs)")


if __name__ == "__main__":
    main()
