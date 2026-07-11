"""
STACK RANKED — Player Desk Mat PDF Generator
===============================================
Builds docs/Stack_Ranked_PlayerMat.pdf: a landscape US Letter Desk mat with
all the per-player tracks called for by the rulebook's Components list (6
Player Desk mats) — Career Capital (with promotion-threshold markers),
Political Capital, Productivity, Burnout (0-10), Compliance Badges (0-4), a
Management Style card slot, and open zones for the Skill/Tool tableau and
Backlog. COPIES identical pages are written so the PDF is ready to print and
cut apart without fiddling with printer "copies" settings.

The mat optionally carries a header banner image (top-right of the header
band) and a full-page background texture, both purely decorative — the mat
renders fine with neither. Point HEADER_IMAGE / BACKGROUND_IMAGE below at
files under table-images/ (see player-mat-art-prompts.txt for ready-to-use
image-generation prompts matching the box-cover art style) to enable them.

Run: python3 generate_player_mat.py
Requires: pip install reportlab pillow
"""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

from generate_print_and_play import RESOURCE_EMOJI, icon_tag, xml_escape

ROOT = Path(__file__).resolve().parent
OUTPUT_PDF = ROOT / "docs" / "Stack_Ranked_PlayerMat.pdf"

# Decorative art — both optional; missing files render a plain placeholder.
HEADER_IMAGE = ROOT / "table-images" / "player-mat-header.png"
BACKGROUND_IMAGE = ROOT / "table-images" / "player-mat-background.png"

COPIES = 6  # matches "6 Player Desk mats" in the rulebook's Components list

PAGE_W, PAGE_H = landscape(letter)
MARGIN = 24
CONTENT_X0, CONTENT_X1 = MARGIN, PAGE_W - MARGIN
CONTENT_Y0, CONTENT_Y1 = MARGIN, PAGE_H - MARGIN
CONTENT_W = CONTENT_X1 - CONTENT_X0

NAVY = HexColor("#1b2a3a")
CREAM = HexColor("#f5ecd9")
BURNT_ORANGE = HexColor("#c1541f")
INK = HexColor("#1a1a1a")
MUTED = HexColor("#5a5a5a")
RULE = HexColor("#c9bda3")
TRACK_BG = HexColor("#fffdf8")

CC_THRESHOLDS = {8: "SE", 18: "TL", 30: "MGR", 44: "DIR", 60: "VP", 78: "CEO"}
BADGE_TAGS = {2: "DIR", 4: "VP"}


def style(name, size, leading, alignment=TA_LEFT, color=INK, bold=False, italic=False):
    font = "Helvetica"
    if bold and italic:
        font = "Helvetica-BoldOblique"
    elif bold:
        font = "Helvetica-Bold"
    elif italic:
        font = "Helvetica-Oblique"
    return ParagraphStyle(name, fontName=font, fontSize=size, leading=leading,
                           alignment=alignment, textColor=color)


STYLE_TITLE = style("mat_title", 22, 24, bold=True, color=CREAM)
STYLE_SUBTITLE = style("mat_subtitle", 11, 13, color=CREAM)
STYLE_NAME_LINE = style("mat_name", 10, 12, color=CREAM)
STYLE_SECTION = style("mat_section", 9, 11, bold=True, color=NAVY)
STYLE_SECTION_DESC = style("mat_section_desc", 7, 9, italic=True, color=MUTED)
STYLE_ZONE_LABEL = style("mat_zone", 9.5, 12, bold=True, color=NAVY)
STYLE_ZONE_DESC = style("mat_zone_desc", 7.5, 9.5, italic=True, color=MUTED)
STYLE_REF_HEAD = style("mat_ref_head", 8.5, 10, bold=True, color=NAVY)
STYLE_REF_BODY = style("mat_ref_body", 7, 9.5, color=INK)


def draw_image_cover(c, img_path, x, y, w, h, valign="center"):
    """Draw img_path scaled/cropped to fill x,y,w,h exactly (CSS 'cover'
    behavior), clipped to that rect. Returns False (no-op) if missing.
    valign picks which edge keeps its content when the aspect ratio forces a
    vertical crop: "top" keeps the top of the source image (crops the
    bottom), "bottom" keeps the bottom (crops the top), "center" (default)
    crops evenly from both edges."""
    if not img_path.is_file():
        return False
    reader = ImageReader(str(img_path))
    iw, ih = reader.getSize()
    scale = max(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    dx = x + (w - dw) / 2
    if valign == "top":
        dy = y + h - dh
    elif valign == "bottom":
        dy = y
    else:
        dy = y + (h - dh) / 2
    c.saveState()
    p = c.beginPath()
    p.rect(x, y, w, h)
    c.clipPath(p, stroke=0, fill=0)
    c.drawImage(reader, dx, dy, dw, dh, mask="auto")
    c.restoreState()
    return True


def draw_placeholder(c, x, y, w, h, label):
    c.saveState()
    c.setFillColor(HexColor("#e8ddc4"))
    c.rect(x, y, w, h, stroke=0, fill=1)
    c.setDash(3, 3)
    c.setStrokeColor(RULE)
    c.rect(x, y, w, h, stroke=1, fill=0)
    c.setDash()
    c.setFillColor(MUTED)
    c.setFont("Helvetica-Oblique", 7)
    c.drawCentredString(x + w / 2, y + h / 2 - 3, label)
    c.restoreState()


def rounded_zone(c, x, y, w, h, label, desc):
    c.saveState()
    c.setFillColor(TRACK_BG)
    c.roundRect(x, y, w, h, 6, stroke=0, fill=1)
    c.setStrokeColor(RULE)
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, 6, stroke=1, fill=0)
    c.restoreState()
    label_p = Paragraph(xml_escape(label), STYLE_ZONE_LABEL)
    lw, lh = label_p.wrapOn(c, w - 16, 20)
    label_p.drawOn(c, x + 8, y + h - lh - 6)
    desc_p = Paragraph(xml_escape(desc), STYLE_ZONE_DESC)
    dw, dh = desc_p.wrapOn(c, w - 16, 20)
    desc_p.drawOn(c, x + 8, y + h - lh - dh - 8)


def draw_track_row(c, x, top, width, count, cell_h, highlight=None,
                    label_step=5, start_num=0, accent=BURNT_ORANGE):
    """One row of `count` numbered cells starting at start_num. Cells whose
    (start_num + i) key appears in `highlight` get an accent fill and the
    highlight's short tag printed just below the row. Returns the row's
    bottom y."""
    highlight = highlight or {}
    cell_w = width / count
    bottom = top - cell_h
    c.saveState()
    c.setLineWidth(0.6)
    for i in range(count):
        n = start_num + i
        cx = x + i * cell_w
        is_hl = i in highlight
        c.setFillColor(accent if is_hl else colors.white)
        c.rect(cx, bottom, cell_w, cell_h, stroke=0, fill=1)
        c.setStrokeColor(RULE)
        c.rect(cx, bottom, cell_w, cell_h, stroke=1, fill=0)
        show_num = is_hl or n % label_step == 0 or i == count - 1
        if show_num:
            c.setFillColor(colors.white if is_hl else MUTED)
            c.setFont("Helvetica-Bold" if is_hl else "Helvetica", 5.5)
            c.drawCentredString(cx + cell_w / 2, bottom + cell_h / 2 - 2, str(n))
        if is_hl:
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 5)
            c.drawCentredString(cx + cell_w / 2, bottom - 6.5, highlight[i])
    c.restoreState()
    return bottom


def draw_tracked_resource(c, x, top, width, emoji, title, desc, count, cell_h,
                           highlight=None, label_step=5, rows=1, row_gap=10):
    """Label line (icon + name + description) followed by one or more rows
    of numbered track cells (wrapping left-to-right, row-major). Returns the
    bottom y of the whole block, leaving room below for highlight tags."""
    header = Paragraph(icon_tag(emoji, 10) + f"<b>{xml_escape(title)}</b>  "
                        f"<i>{xml_escape(desc)}</i>", style("trk", 7.5, 9.5, color=INK))
    hw, hh = header.wrapOn(c, width, 16)
    header.drawOn(c, x, top - hh)
    cursor = top - hh - 3

    per_row = -(-count // rows)  # ceil
    n = 0
    for r in range(rows):
        this_count = min(per_row, count - n)
        if this_count <= 0:
            break
        row_hl = {k - n: v for k, v in (highlight or {}).items() if n <= k < n + this_count}
        cursor = draw_track_row(c, x, cursor, width, this_count, cell_h,
                                 highlight=row_hl, label_step=label_step, start_num=n)
        n += this_count
        if r < rows - 1:
            cursor -= row_gap
    has_tags = any((highlight or {}).values())
    return cursor - (9 if has_tags else 2)


def draw_management_slot(c, x, top, w, h):
    label = Paragraph(icon_tag("\U0001F3AD", 10) + "<b>MANAGEMENT STYLE</b>",
                       style("mgmt", 9, 11, alignment=TA_CENTER, bold=True, color=NAVY))
    lw, lh = label.wrapOn(c, w, 16)
    label.drawOn(c, x, top - lh)
    slot_top = top - lh - 6
    slot_h = h - lh - 6
    c.saveState()
    c.setDash(4, 3)
    c.setStrokeColor(RULE)
    c.setLineWidth(1.2)
    c.roundRect(x, slot_top - slot_h, w, slot_h, 8, stroke=1, fill=0)
    c.setDash()
    c.setFillColor(MUTED)
    c.setFont("Helvetica-Oblique", 7.5)
    c.drawCentredString(x + w / 2, slot_top - slot_h / 2,
                         "place drawn card")
    c.drawCentredString(x + w / 2, slot_top - slot_h / 2 - 11, "face-up here")
    c.restoreState()
    return slot_top - slot_h


def draw_quick_reference(c, x, top, w, h):
    c.saveState()
    c.setFillColor(TRACK_BG)
    c.roundRect(x, top - h, w, h, 6, stroke=0, fill=1)
    c.setStrokeColor(RULE)
    c.setLineWidth(1)
    c.roundRect(x, top - h, w, h, 6, stroke=1, fill=0)
    c.restoreState()

    inner_x, inner_w = x + 8, w - 16
    cursor = top - 12

    heading = Paragraph("<b>QUICK REFERENCE</b>", STYLE_REF_HEAD)
    hw, hh = heading.wrapOn(c, inner_w, 14)
    heading.drawOn(c, inner_x, cursor - hh)
    cursor -= hh + 5

    ap_rows = [
        ("Intern / Sw. Engineer", "2 AP"),
        ("Team Lead / Manager", "3 AP"),
        ("Director / VP / CEO", "4 AP"),
    ]
    for rung, ap in ap_rows:
        c.setFont("Helvetica", 6.8)
        c.setFillColor(INK)
        c.drawString(inner_x, cursor - 7, rung)
        c.setFont("Helvetica-Bold", 6.8)
        c.drawRightString(inner_x + inner_w, cursor - 7, ap)
        cursor -= 10
    cursor -= 4

    memo_icon = icon_tag("\U0001F4DD", 8)       # 📝
    handshake_icon = icon_tag("\U0001F91D", 8)  # 🤝
    bullets = (
        f"{icon_tag(RESOURCE_EMOJI['Political Capital'], 8)}<b>Network</b> (free): "
        "+2 Political Capital, +1 Career Capital.<br/>"
        f"<b>Self-Care</b> (free): −2 {icon_tag(RESOURCE_EMOJI['Burnout'], 8)}Burnout.<br/>"
        f"<b>Overtime</b> (1/round): +1 Action Point, +2 {icon_tag(RESOURCE_EMOJI['Burnout'], 8)}Burnout.<br/>"
        f"{icon_tag(RESOURCE_EMOJI['Burnout'], 8)}<b>Burnout Crisis</b> at 10: reset to 6, "
        "−2 Political Capital, skip next Sprint.<br/>"
        "<b>Review Score</b> = CC gained since Quarter Marker + Political Capital "
        "on hand + Feedback held − (Burnout ÷ 4, rounded down).<br/>"
        f"{memo_icon}<b>Feedback</b> (variant): 1 card each at Review, keep or "
        "give; ±2 pts, net capped ±4.<br/>"
        f"{handshake_icon}<b>Collaborate</b> (variant): pool Productivity on a shared "
        "Project — contributors split the CC; owner takes PC in lieu."
    )
    body = Paragraph(bullets, style("ref_bullets", 6.8, 9, color=INK))
    bw, bh = body.wrapOn(c, inner_w, 200)
    body.drawOn(c, inner_x, cursor - bh)


def draw_header(c):
    header_h = 96
    top = CONTENT_Y1
    left_w = 230

    left_x0, left_x1 = CONTENT_X0, CONTENT_X0 + left_w
    right_x0, right_x1 = left_x1, CONTENT_X1

    c.setFillColor(NAVY)
    c.rect(left_x0, top - header_h, left_w, header_h, stroke=0, fill=1)

    if not draw_image_cover(c, HEADER_IMAGE, right_x0, top - header_h,
                             right_x1 - right_x0, header_h, valign="top"):
        draw_placeholder(c, right_x0, top - header_h, right_x1 - right_x0, header_h,
                          "(header banner — see player-mat-art-prompts.txt)")

    pad = 14
    ty = top - pad - 4
    title = Paragraph("STACK RANKED", STYLE_TITLE)
    tw, th = title.wrapOn(c, left_w - 2 * pad, 30)
    title.drawOn(c, left_x0 + pad, ty - th)
    ty -= th + 4

    subtitle = Paragraph("PLAYER DESK MAT", STYLE_SUBTITLE)
    sw, sh = subtitle.wrapOn(c, left_w - 2 * pad, 16)
    subtitle.drawOn(c, left_x0 + pad, ty - sh)
    ty -= sh + 14

    c.setStrokeColor(CREAM)
    c.setLineWidth(0.75)
    name_label_w = 40
    c.setFillColor(CREAM)
    c.setFont("Helvetica", 9)
    c.drawString(left_x0 + pad, ty - 9, "Name:")
    c.line(left_x0 + pad + name_label_w, ty - 9, left_x1 - pad, ty - 9)

    return top - header_h


def draw_mat(c):
    if not draw_image_cover(c, BACKGROUND_IMAGE, 0, 0, PAGE_W, PAGE_H):
        c.setFillColor(CREAM)
        c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    header_bottom = draw_header(c)

    gutter = 12
    right_col_w = 190
    left_col_x0, left_col_x1 = CONTENT_X0, CONTENT_X1 - right_col_w - gutter
    right_col_x0 = left_col_x1 + gutter
    left_col_w = left_col_x1 - left_col_x0
    right_col_w = CONTENT_X1 - right_col_x0

    top = header_bottom - 10

    # --- Right column: Management Style slot + quick reference -----------
    mgmt_h = 3.5 * inch
    ref_bottom_after = draw_management_slot(c, right_col_x0, top, right_col_w, mgmt_h)
    ref_top = ref_bottom_after - 10
    draw_quick_reference(c, right_col_x0, ref_top, right_col_w, ref_top - CONTENT_Y0)

    # --- Left column: resource tracks -------------------------------------
    cursor = top

    cursor = draw_tracked_resource(
        c, left_col_x0, cursor, left_col_w,
        RESOURCE_EMOJI["Career Capital"], "CAREER CAPITAL",
        "permanent — gates every promotion; move the Quarter Marker cube to match at each Review",
        count=81, cell_h=17, rows=3, label_step=10, highlight=CC_THRESHOLDS,
    )
    cursor -= 8

    half_w = (left_col_w - 10) / 2
    pc_bottom = draw_tracked_resource(
        c, left_col_x0, cursor, half_w,
        RESOURCE_EMOJI["Political Capital"], "POLITICAL CAPITAL",
        "networking & Review tiebreaks", count=30, cell_h=17, rows=1, label_step=5,
    )
    prod_bottom = draw_tracked_resource(
        c, left_col_x0 + half_w + 10, cursor, half_w,
        RESOURCE_EMOJI["Productivity"], "PRODUCTIVITY",
        "spend to Hire & Work Projects", count=24, cell_h=17, rows=1, label_step=5,
    )
    cursor = min(pc_bottom, prod_bottom) - 8

    burnout_w = left_col_w * 0.62
    badge_w = left_col_w - burnout_w - 10
    burnout_bottom = draw_tracked_resource(
        c, left_col_x0, cursor, burnout_w,
        RESOURCE_EMOJI["Burnout"], "BURNOUT",
        "Crisis at 10 — reset to 6, −2 Political Capital, skip next Sprint",
        count=11, cell_h=22, rows=1, label_step=1,
        highlight={10: "CRISIS"},
    )
    badge_bottom = draw_tracked_resource(
        c, left_col_x0 + burnout_w + 10, cursor, badge_w,
        RESOURCE_EMOJI["Compliance Badge"], "BADGES",
        "Director needs 2, VP needs 4", count=5, cell_h=22, rows=1, label_step=1,
        highlight=BADGE_TAGS,
    )
    cursor = min(burnout_bottom, badge_bottom) - 10

    # --- Bottom zones: Skill/Tool tableau + Backlog -----------------------
    zone_top = cursor
    zone_h = zone_top - CONTENT_Y0
    tableau_w = left_col_w * 0.6
    backlog_w = left_col_w - tableau_w - gutter

    rounded_zone(c, left_col_x0, CONTENT_Y0, tableau_w, zone_h,
                 "SKILL / TOOL TABLEAU", "hired Permanent cards live here")
    rounded_zone(c, left_col_x0 + tableau_w + gutter, CONTENT_Y0, backlog_w, zone_h,
                 "BACKLOG", "Projects claimed, not yet paid for — mark one “shared” to collaborate")


def main():
    if not HEADER_IMAGE.is_file():
        print(f"Note: no header image at {HEADER_IMAGE.relative_to(ROOT)} — using placeholder.")
    if not BACKGROUND_IMAGE.is_file():
        print(f"Note: no background image at {BACKGROUND_IMAGE.relative_to(ROOT)} — using plain cream background.")

    OUTPUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT_PDF), pagesize=(PAGE_W, PAGE_H))
    c.setTitle("Stack Ranked — Player Desk Mat")
    for _ in range(COPIES):
        draw_mat(c)
        c.showPage()
    c.save()
    print(f"Wrote {OUTPUT_PDF} ({COPIES} page{'s' if COPIES != 1 else ''})")


if __name__ == "__main__":
    main()
