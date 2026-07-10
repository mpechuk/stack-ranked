"""
STACK RANKED — Print-and-Play PDF Generator
=============================================
Builds docs/Stack_Ranked_PrintAndPlay.pdf straight from cards.json: a cover
page with assembly instructions plus poker-sized (2.5in x 3.5in) card sheets,
9-up on US Letter paper, one category per sheet run. Physical copy counts
(e.g. Tier 1 Skill/Tool and Early Project cards need 2 copies each to keep
the decks from running dry) follow the Deck Composition table in
docs/STACK_RANKED_RULEBOOK.md.

Each card's effect/reward text is split into clauses (on sentence and
semicolon boundaries, one per line) and any mention of a tracked resource
(Career Capital, Political Capital, Burnout, Productivity, Compliance
Badge, Action Point) is bolded and given a small icon.

A card may optionally carry an "image" field (path relative to the repo
root) to print artwork on the card; cards without one render as plain text.

Run: python3 generate_print_and_play.py
Requires: pip install reportlab pillow
Icons need a color emoji font (Apple Color Emoji on macOS); on platforms
without one, cards render fine with bold text but no icons.
"""
import atexit
import json
import math
import re
import shutil
import tempfile
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    Image = ImageDraw = ImageFont = None

ROOT = Path(__file__).resolve().parent
CARDS_JSON = ROOT / "cards.json"
OUTPUT_PDF = ROOT / "docs" / "Stack_Ranked_PrintAndPlay.pdf"

PAGE_W, PAGE_H = letter
CARD_W, CARD_H = 2.5 * inch, 3.5 * inch
COLS, ROWS = 3, 3
PER_SHEET = COLS * ROWS
GRID_W, GRID_H = COLS * CARD_W, ROWS * CARD_H
MARGIN_X = (PAGE_W - GRID_W) / 2
MARGIN_Y = (PAGE_H - GRID_H) / 2

PAD_X = 10
PAD_TOP = 12
IMAGE_MAX_H = 68

# label, accent (border/heading), bg (fill)
PALETTE = {
    "skill": (HexColor("#2c5f8a"), HexColor("#eaf2fb")),
    "project": (HexColor("#2e7d46"), HexColor("#eaf7ee")),
    "chaos": (HexColor("#b23a24"), HexColor("#fdedea")),
    "training": (HexColor("#6a3fa0"), HexColor("#f3eafb")),
    "management": (HexColor("#a9720f"), HexColor("#fbf3e3")),
}

CATEGORY_EMOJI = {
    "skill": "\U0001F6E0",       # 🛠 tools
    "project": "\U0001F4CB",     # 📋 clipboard
    "chaos": "\U0001F32A",       # 🌪 tornado
    "training": "\U0001F393",    # 🎓 grad cap
    "management": "\U0001F454",  # 👔 necktie
}

TYPE_COLORS = {
    "Permanent": HexColor("#1a7a5e"),
    "One-Shot": HexColor("#b5432e"),
}
TYPE_EMOJI = {
    "Permanent": "\U0001F501",   # 🔁
    "One-Shot": "\U0001F4A5",    # 💥
}
EVERGREEN_EMOJI = "\U0000267E"  # ♾

# Tracked resources: display name -> (emoji, regex-safe alt spellings)
RESOURCE_EMOJI = {
    "Productivity": "\U00002699",         # ⚙
    "Political Capital": "\U0001F91D",    # 🤝
    "Career Capital": "\U0001F4C8",       # 📈
    "Burnout": "\U0001F525",              # 🔥
    "Compliance Badge": "\U0001F396",     # 🎖
    "Action Point": "\U0001F3AF",         # 🎯
}
RESOURCE_PATTERN = re.compile(
    r"(?P<amount>[+−-]\s?\d+|\d+)?\s*"
    r"(?P<resource>Political Capital|Career Capital|Compliance Badges?|"
    r"Action Points?|Productivity|Burnout)(?P<suffix>/round)?"
)
CLAUSE_SPLIT = re.compile(r"(?<=[;.])\s+")


# ---------------------------------------------------------------------------
# Emoji rasterization (color emoji glyphs -> cached PNGs, embedded as <img>)
# ---------------------------------------------------------------------------

_EMOJI_FONT_CANDIDATES = [
    "/System/Library/Fonts/Apple Color Emoji.ttc",
]
_EMOJI_RENDER_PX = 160
_emoji_cache_dir = None
_emoji_path_cache = {}
_emoji_font = "unresolved"


def _emoji_font_path():
    global _emoji_font
    if _emoji_font == "unresolved":
        _emoji_font = next((p for p in _EMOJI_FONT_CANDIDATES if Path(p).is_file()), None)
    return _emoji_font


def emoji_png_path(char):
    """Rasterize one emoji glyph to a cached transparent PNG file, returning
    its path, or None if no color emoji font / Pillow is available."""
    if char in _emoji_path_cache:
        return _emoji_path_cache[char]
    path = None
    font_path = _emoji_font_path()
    if Image is not None and font_path:
        global _emoji_cache_dir
        if _emoji_cache_dir is None:
            _emoji_cache_dir = tempfile.mkdtemp(prefix="stack_ranked_emoji_")
            atexit.register(shutil.rmtree, _emoji_cache_dir, ignore_errors=True)
        try:
            font = ImageFont.truetype(font_path, _EMOJI_RENDER_PX)
            size = _EMOJI_RENDER_PX * 2
            img = Image.new("RGBA", (size, size), (255, 255, 255, 0))
            ImageDraw.Draw(img).text((0, 0), char, font=font, embedded_color=True)
            bbox = img.getbbox()
            if bbox:
                img = img.crop(bbox)
                path = str(Path(_emoji_cache_dir) / f"{ord(char[0]):x}.png")
                img.save(path)
        except OSError:
            path = None
    _emoji_path_cache[char] = path
    return path


def icon_tag(emoji_char, size=11):
    path = emoji_png_path(emoji_char)
    if not path:
        return ""
    return f'<img src="{path}" width="{size}" height="{size}" valign="-2"/> '


# ---------------------------------------------------------------------------
# Text markup helpers
# ---------------------------------------------------------------------------

def xml_escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _normalize_resource(word):
    if word.startswith("Compliance Badge"):
        return "Compliance Badge"
    if word.startswith("Action Point"):
        return "Action Point"
    return word


def _resource_sub(match):
    amount = match.group("amount") or ""
    resource = match.group("resource")
    suffix = match.group("suffix") or ""
    emoji = RESOURCE_EMOJI[_normalize_resource(resource)]
    text = f"{amount} {resource}{suffix}".strip() if amount else f"{resource}{suffix}"
    return f"{icon_tag(emoji)}<b>{text}</b>"


def apply_resource_emphasis(escaped_text):
    return RESOURCE_PATTERN.sub(_resource_sub, escaped_text)


def split_clauses(text):
    clauses = []
    for part in CLAUSE_SPLIT.split(text.strip()):
        part = part.strip().rstrip(".;").strip()
        if part:
            clauses.append(part)
    return clauses


def build_body_markup(raw_text):
    clauses = split_clauses(raw_text)
    lines = [apply_resource_emphasis(xml_escape(clause)) for clause in clauses]
    return "<br/>".join(lines)


def style(name, size, leading, alignment, color, bold=False, italic=False):
    font = "Helvetica"
    if bold and italic:
        font = "Helvetica-BoldOblique"
    elif bold:
        font = "Helvetica-Bold"
    elif italic:
        font = "Helvetica-Oblique"
    return ParagraphStyle(
        name, fontName=font, fontSize=size, leading=leading,
        alignment=alignment, textColor=color,
    )


STYLE_TITLE = style("title", 13, 15, TA_CENTER, HexColor("#1a1a1a"), bold=True)
STYLE_BODY = style("body", 9.5, 13, TA_LEFT, HexColor("#1e1e1e"))
STYLE_FLAVOR = style("flavor", 8.5, 10.5, TA_LEFT, HexColor("#555555"), italic=True)


def build_deck(data):
    """Expand cards.json into category groups, physical copies already
    duplicated in place."""
    skills = data["skills"]
    projects = data["projects"]
    groups = [
        ("skill_tier1", "SKILL / TOOL · TIER 1", "skill", True, True, "effect", 2, skills["tier1"]),
        ("skill_tier2", "SKILL / TOOL · TIER 2", "skill", True, True, "effect", 1, skills["tier2"]),
        ("skill_tier3", "SKILL / TOOL · TIER 3", "skill", True, True, "effect", 1, skills["tier3"]),
        ("project_early", "PROJECT · EARLY", "project", True, False, "reward", 2, projects["early"]),
        ("project_mid", "PROJECT · MID", "project", True, False, "reward", 1, projects["mid"]),
        ("project_late", "PROJECT · LATE", "project", True, False, "reward", 1, projects["late"]),
        ("project_evergreen", "PROJECT · EVERGREEN", "project", True, False, "reward", 1, projects["evergreen"]),
        ("events", "OFFICE CHAOS", "chaos", False, False, "effect", 1, data["events"]),
        ("trainings", "MANDATORY TRAINING", "training", False, False, "effect", 1, data["trainings"]),
        ("management", "MANAGEMENT STYLE", "management", False, False, "effect", 1, data["management"]),
    ]
    decks = []
    for key, label, palette_key, has_cost, has_type, reward_key, copies, cards in groups:
        physical = []
        for card in cards:
            physical.extend([card] * copies)
        decks.append({
            "key": key, "label": label, "palette": palette_key,
            "has_cost": has_cost, "has_type": has_type,
            "reward_key": reward_key, "cards": physical,
        })
    return decks


def draw_card_image(c, x0, cursor, content_w, image_rel_path):
    img_path = ROOT / image_rel_path
    if not img_path.is_file():
        print(f"Warning: card image not found, skipping: {image_rel_path}")
        return 0
    reader = ImageReader(str(img_path))
    iw, ih = reader.getSize()
    scale = min(content_w / iw, IMAGE_MAX_H / ih)
    draw_w, draw_h = iw * scale, ih * scale
    img_x = x0 + PAD_X + (content_w - draw_w) / 2
    c.drawImage(reader, img_x, cursor - draw_h, draw_w, draw_h, mask="auto")
    return draw_h


def draw_card(c, x_left, y_top, card, deck):
    x0, y0 = x_left, y_top - CARD_H
    accent, bg = PALETTE[deck["palette"]]

    c.setFillColor(bg)
    c.rect(x0, y0, CARD_W, CARD_H, stroke=0, fill=1)
    c.setStrokeColor(accent)
    c.setLineWidth(0.75)
    c.rect(x0, y0, CARD_W, CARD_H, stroke=1, fill=0)

    content_w = CARD_W - 2 * PAD_X
    cursor = y_top - PAD_TOP

    category_style = style("category", 7.5, 9, TA_CENTER, accent, bold=True)
    category = Paragraph(icon_tag(CATEGORY_EMOJI[deck["palette"]], 10) + deck["label"], category_style)
    cw, ch = category.wrapOn(c, content_w, 20)
    category.drawOn(c, x0 + PAD_X, cursor - ch)
    cursor -= ch + 4
    c.setStrokeColor(accent)
    c.setLineWidth(0.5)
    c.line(x0 + PAD_X, cursor, x0 + CARD_W - PAD_X, cursor)
    cursor -= 8

    if deck["has_cost"] and "cost" in card:
        c.setFillColor(accent)
        c.circle(x0 + CARD_W / 2, cursor - 6, 10, stroke=0, fill=1)
        c.setFillColor(HexColor("#ffffff"))
        c.setFont("Helvetica-Bold", 13)
        c.drawCentredString(x0 + CARD_W / 2, cursor - 10.5, str(card["cost"]))
        cursor -= 26

    title = Paragraph(xml_escape(card["name"]), STYLE_TITLE)
    tw, th = title.wrapOn(c, content_w, 100)
    title.drawOn(c, x0 + PAD_X, cursor - th)
    cursor -= th + 4

    card_type = card.get("type")
    if deck["has_type"] and card_type:
        emoji = TYPE_EMOJI.get(card_type, "")
        tag_style = style("type", 8.5, 10, TA_CENTER, TYPE_COLORS.get(card_type, accent), bold=True)
        tag = Paragraph(icon_tag(emoji, 10) + card_type.upper(), tag_style)
        tgw, tgh = tag.wrapOn(c, content_w, 16)
        tag.drawOn(c, x0 + PAD_X, cursor - tgh)
        cursor -= tgh + 4
    elif deck["key"] == "project_evergreen":
        tag_style = style("type", 8.5, 10, TA_CENTER, accent, bold=True)
        tag = Paragraph(icon_tag(EVERGREEN_EMOJI, 10) + "EVERGREEN", tag_style)
        tgw, tgh = tag.wrapOn(c, content_w, 16)
        tag.drawOn(c, x0 + PAD_X, cursor - tgh)
        cursor -= tgh + 4

    if card.get("image"):
        img_h = draw_card_image(c, x0, cursor, content_w, card["image"])
        if img_h:
            cursor -= img_h + 6

    body_text = card.get(deck["reward_key"], "")
    body = Paragraph(build_body_markup(body_text), STYLE_BODY)
    bw, bh = body.wrapOn(c, content_w, 220)
    body.drawOn(c, x0 + PAD_X, cursor - bh)
    cursor -= bh + 7

    flavor = Paragraph(xml_escape(f"“{card['flavor']}”"), STYLE_FLAVOR)
    fw, fh = flavor.wrapOn(c, content_w, 200)
    flavor.drawOn(c, x0 + PAD_X, cursor - fh)

    c.setFillColor(HexColor("#999999"))
    c.setFont("Helvetica", 6.5)
    c.drawCentredString(x0 + CARD_W / 2, y0 + 5, "SYNERGY CORP")


def draw_sheet_footer(c, label, sheet_num, total_sheets):
    c.setFillColor(HexColor("#777777"))
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(
        PAGE_W / 2, MARGIN_Y - 11,
        f"STACK RANKED — {label}  (sheet {sheet_num} of {total_sheets})",
    )


def draw_category_sheets(c, deck):
    cards = deck["cards"]
    total_sheets = max(1, math.ceil(len(cards) / PER_SHEET))
    for sheet_idx in range(total_sheets):
        chunk = cards[sheet_idx * PER_SHEET:(sheet_idx + 1) * PER_SHEET]
        for i, card in enumerate(chunk):
            row, col = divmod(i, COLS)
            x_left = MARGIN_X + col * CARD_W
            y_top = PAGE_H - MARGIN_Y - row * CARD_H
            draw_card(c, x_left, y_top, card, deck)
        draw_sheet_footer(c, deck["label"], sheet_idx + 1, total_sheets)
        c.showPage()


def draw_cover_page(c, decks):
    total = sum(len(d["cards"]) for d in decks)

    skill_total = sum(len(d["cards"]) for d in decks if d["key"].startswith("skill"))
    project_total = sum(len(d["cards"]) for d in decks if d["key"].startswith("project"))
    chaos_total = next(len(d["cards"]) for d in decks if d["key"] == "events")
    training_total = next(len(d["cards"]) for d in decks if d["key"] == "trainings")
    management_total = next(len(d["cards"]) for d in decks if d["key"] == "management")

    x = MARGIN_X
    width = PAGE_W - 2 * MARGIN_X
    y = PAGE_H - 1.1 * inch

    c.setFillColor(HexColor("#1a1a1a"))
    c.setFont("Helvetica-Bold", 24)
    c.drawString(x, y, "STACK RANKED")
    y -= 22
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(HexColor("#555555"))
    c.drawString(x, y, "PRINT-AND-PLAY CARD SHEETS")
    y -= 40

    def section(heading, body_text):
        nonlocal y
        c.setFillColor(HexColor("#1a1a1a"))
        c.setFont("Helvetica-Bold", 12)
        c.drawString(x, y, heading)
        y -= 16
        p = Paragraph(xml_escape(body_text), style("cover_body", 10, 14, TA_LEFT, HexColor("#222222")))
        pw, ph = p.wrapOn(c, width, 300)
        p.drawOn(c, x, y - ph)
        y -= ph + 26

    section(
        "How to assemble this deck",
        "Print single-sided on US Letter (8.5″ x 11″) paper at 100% scale / "
        "“Actual Size” (not “Fit to Page”), so cards come out at true poker "
        "size, 2.5″ x 3.5″. Cut along the colored border on each card. For "
        "durability, print on cardstock and slide into standard poker-sized card "
        "sleeves (with an opaque sleeve back, or any solid-color card as a "
        "backer, since these sheets are front-only).",
    )
    section(
        "What's on each sheet",
        "Every sheet is labeled at the bottom with its category and a "
        "“sheet X of Y” counter. Categories never share a sheet, so you can "
        "print and cut one category at a time. Cards that need multiple "
        "physical copies (Tier 1 Skill/Tool cards and Early Project cards) "
        "are already duplicated here — print every sheet once and you'll "
        "have the complete deck. Key resources (Career Capital, Political "
        "Capital, Burnout, Productivity, Compliance Badges, Action Points) "
        "are bolded with an icon wherever they appear.",
    )
    section(
        f"Deck contents ({total} physical cards)",
        f"{skill_total} Skill/Tool — {project_total} Project — {chaos_total} Office "
        f"Chaos — {training_total} Mandatory Training — {management_total} Management "
        "Style.\nMatches the Card Reference Appendix in the main rulebook — see "
        "that document for full rules on how each card is used.",
    )
    c.showPage()


def main():
    data = json.loads(CARDS_JSON.read_text(encoding="utf-8"))
    decks = build_deck(data)

    if _emoji_font_path() is None:
        print("Note: no color emoji font found — cards will render without icons.")

    OUTPUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT_PDF), pagesize=letter)
    c.setTitle("Stack Ranked — Print-and-Play")

    draw_cover_page(c, decks)
    for deck in decks:
        draw_category_sheets(c, deck)

    c.save()
    total_cards = sum(len(d["cards"]) for d in decks)
    total_pages = 1 + sum(max(1, math.ceil(len(d["cards"]) / PER_SHEET)) for d in decks)
    print(f"Wrote {OUTPUT_PDF} ({total_pages} pages, {total_cards} physical cards)")


if __name__ == "__main__":
    main()
