"""
STACK RANKED — Rulebook PDF Generator
=======================================
Converts docs/STACK_RANKED_RULEBOOK.md into a paginated, print-ready PDF:
docs/Stack_Ranked_Rulebook.pdf. Headings become PDF bookmarks (visible in
the reader's outline/sidebar), and every "[text](#anchor)" link in the
Markdown — the Table of Contents and the inline cross-references scattered
through the rules — becomes a clickable jump to that heading, using the
same slug algorithm GitHub uses so the existing anchors resolve as-is.

Run: python3 generate_rulebook_pdf.py
Requires: pip install reportlab markdown beautifulsoup4
"""
import io
import re
from pathlib import Path

import markdown
from bs4 import BeautifulSoup, NavigableString, Tag

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    Flowable, HRFlowable, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
    Table, TableStyle,
)

ROOT = Path(__file__).resolve().parent
RULEBOOK_MD = ROOT / "docs" / "STACK_RANKED_RULEBOOK.md"
OUTPUT_PDF = ROOT / "docs" / "Stack_Ranked_Rulebook.pdf"

PAGE_W, PAGE_H = letter
MARGIN = 0.75 * inch
CONTENT_W = PAGE_W - 2 * MARGIN

ACCENT = HexColor("#2c5f8a")
TEXT = HexColor("#1e1e1e")
MUTED = HexColor("#666666")
RULE_COLOR = HexColor("#c9c9c9")
TABLE_HEAD_BG = ACCENT
TABLE_ROW_ALT = HexColor("#f2f2f2")

HEADING_LEVEL = {"h2": 1, "h3": 2, "h4": 3}


def para_style(name, size, leading, **kwargs):
    kwargs.setdefault("fontName", "Helvetica")
    kwargs.setdefault("textColor", TEXT)
    return ParagraphStyle(name, fontSize=size, leading=leading, **kwargs)


STYLES = {
    "title": para_style("title", 30, 34, fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=6),
    "subtitle": para_style("subtitle", 15, 19, fontName="Helvetica-Bold", alignment=TA_CENTER, textColor=MUTED, spaceAfter=6),
    "tagline": para_style("tagline", 11.5, 15, fontName="Helvetica-Oblique", alignment=TA_CENTER, textColor=MUTED, spaceAfter=6),
    "meta": para_style("meta", 11, 15, fontName="Helvetica-Bold", alignment=TA_CENTER, textColor=ACCENT, spaceAfter=10),
    "cover_body": para_style("cover_body", 10.5, 15, alignment=TA_CENTER, spaceAfter=8),
    "h2": para_style("h2", 18, 22, fontName="Helvetica-Bold", textColor=ACCENT, spaceBefore=0, spaceAfter=4),
    "h3": para_style("h3", 13, 16, fontName="Helvetica-Bold", spaceBefore=14, spaceAfter=6),
    "h4": para_style("h4", 11, 14, fontName="Helvetica-BoldOblique", spaceBefore=10, spaceAfter=4),
    "body": para_style("body", 10, 14.5, spaceAfter=8, alignment=TA_LEFT),
    "li0": para_style("li0", 10, 14.5, spaceAfter=4, leftIndent=16, bulletIndent=4),
    "li1": para_style("li1", 10, 14.5, spaceAfter=4, leftIndent=32, bulletIndent=20),
    "cell": para_style("cell", 8.5, 11),
    "cell_head": para_style("cell_head", 8.5, 11, fontName="Helvetica-Bold", textColor=colors.white),
}


# ---------------------------------------------------------------------------
# Heading anchors (GitHub-style slugs) + PDF bookmarks/outline
# ---------------------------------------------------------------------------

_SLUG_STRIP = re.compile(r"[^\w\s-]")
_SLUG_SPACE = re.compile(r"\s+")
_used_slugs = set()


def slugify(text):
    s = _SLUG_SPACE.sub("-", _SLUG_STRIP.sub("", text.lower()).strip())
    base, n = s, 1
    while s in _used_slugs:
        n += 1
        s = f"{base}-{n}"
    _used_slugs.add(s)
    return s


class Bookmark(Flowable):
    """Zero-height flowable that registers a PDF named-destination + outline
    entry at its position, so `<a href="#slug">` links and the reader's
    bookmark sidebar both work."""

    def __init__(self, key, title, level):
        Flowable.__init__(self)
        self.key, self.title, self.level = key, title, level
        self.width = self.height = 0

    def draw(self):
        self.canv.bookmarkPage(self.key)
        self.canv.addOutlineEntry(self.title, self.key, level=self.level, closed=self.level >= 2)


# ---------------------------------------------------------------------------
# Inline markup: HTML (from python-markdown) -> reportlab Paragraph markup
# ---------------------------------------------------------------------------

def xml_escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def clean_text(text):
    # Drop characters outside the Basic Multilingual Plane (emoji etc.) that
    # the base Helvetica font can't render — everything else (em dash, curly
    # quotes, arrows, trademark sign...) renders fine as-is.
    return "".join(ch for ch in text if ord(ch) <= 0xFFFF)


def inline_markup(tag, skip_tags=frozenset()):
    parts = []
    for child in tag.contents:
        if isinstance(child, NavigableString):
            parts.append(xml_escape(clean_text(str(child))))
        elif isinstance(child, Tag):
            if child.name in skip_tags:
                continue
            inner = inline_markup(child, skip_tags)
            if child.name == "a":
                href = child.get("href", "")
                if href.startswith("#"):
                    parts.append(f'<a href="{href}" color="#2c5f8a">{inner}</a>')
                elif href:
                    parts.append(f'<a href="{xml_escape(href)}" color="#2c5f8a">{inner}</a>')
                else:
                    parts.append(inner)
            elif child.name in ("strong", "b"):
                parts.append(f"<b>{inner}</b>")
            elif child.name in ("em", "i"):
                parts.append(f"<i>{inner}</i>")
            elif child.name == "code":
                parts.append(f'<font face="Courier">{inner}</font>')
            elif child.name == "br":
                parts.append("<br/>")
            else:
                parts.append(inner)
    return "".join(parts)


def next_meaningful_sibling(tag):
    sib = tag.next_sibling
    while isinstance(sib, NavigableString) and not sib.strip():
        sib = sib.next_sibling
    return sib


# ---------------------------------------------------------------------------
# Block-level renderers
# ---------------------------------------------------------------------------

def render_list(tag, depth=0):
    flowables = []
    ordered = tag.name == "ol"
    style = STYLES["li0"] if depth == 0 else STYLES["li1"]
    for i, li in enumerate(tag.find_all("li", recursive=False), start=1):
        nested = li.find_all(["ul", "ol"], recursive=False)
        own_text = inline_markup(li, skip_tags=frozenset({"ul", "ol"}))
        bullet = f"{i}." if ordered else "•"
        flowables.append(Paragraph(f"{bullet}&nbsp;&nbsp;{own_text}", style))
        for nested_list in nested:
            flowables.extend(render_list(nested_list, depth=depth + 1))
    return flowables


def compute_col_widths(raw_rows):
    """Give every column at least enough room for its single longest word
    (so text wraps between words, never mid-word), then hand out whatever
    width is left over in proportion to each column's overall content
    length, so long prose columns (Effect, Flavor) still get the bulk of it."""
    ncols = len(raw_rows[0])
    min_widths = []
    weights = []
    for c in range(ncols):
        values = [row[c] for row in raw_rows if c < len(row)]
        longest_word = max((w for v in values for w in v.split()), key=len, default="")
        word_w = stringWidth(longest_word, "Helvetica", 8.5) + 10
        min_widths.append(max(24, word_w))
        weights.append(max(3, max((len(v) for v in values), default=3)))

    if sum(min_widths) >= CONTENT_W:
        scale = CONTENT_W / sum(min_widths)
        return [w * scale for w in min_widths]

    remaining = CONTENT_W - sum(min_widths)
    total_weight = sum(weights)
    return [m + remaining * w / total_weight for m, w in zip(min_widths, weights)]


def render_table(tag):
    header_cells = [th.get_text(" ", strip=True) for th in tag.select("thead th")]
    body_rows = [
        [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        for tr in tag.select("tbody tr")
    ]
    raw_rows = ([header_cells] if header_cells else []) + body_rows
    if not raw_rows:
        return None

    col_widths = compute_col_widths(raw_rows)

    data = []
    if header_cells:
        data.append([Paragraph(xml_escape(clean_text(c)), STYLES["cell_head"]) for c in header_cells])
    for tr in tag.select("tbody tr"):
        row = []
        for td in tr.find_all("td"):
            row.append(Paragraph(inline_markup(td), STYLES["cell"]))
        data.append(row)

    table = Table(data, colWidths=col_widths, repeatRows=1 if header_cells else 0)
    style_cmds = [
        ("GRID", (0, 0), (-1, -1), 0.5, RULE_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header_cells:
        style_cmds += [
            ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEAD_BG),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, TABLE_ROW_ALT]),
        ]
    else:
        style_cmds.append(("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, TABLE_ROW_ALT]))
    table.setStyle(TableStyle(style_cmds))
    return table


def render_document(soup):
    flowables = []
    seen_h2 = False

    for node in soup.contents:
        if not isinstance(node, Tag):
            continue
        name = node.name

        if name == "h1":
            title_text = node.get_text()
            flowables.append(Spacer(1, 0.6 * inch))
            flowables.append(Bookmark(slugify(title_text), title_text, 0))
            flowables.append(Paragraph(inline_markup(node), STYLES["title"]))

        elif name == "h3" and not seen_h2:
            flowables.append(Paragraph(inline_markup(node), STYLES["subtitle"]))

        elif name in HEADING_LEVEL:
            if name == "h2":
                seen_h2 = True
                flowables.append(PageBreak())
            heading_text = node.get_text()
            flowables.append(Bookmark(slugify(heading_text), heading_text, HEADING_LEVEL[name]))
            flowables.append(Paragraph(inline_markup(node), STYLES[name]))
            if name == "h2":
                flowables.append(HRFlowable(width="100%", thickness=1, color=ACCENT, spaceAfter=12))

        elif name == "p":
            if not seen_h2:
                only_child = node.contents[0] if len(node.contents) == 1 and isinstance(node.contents[0], Tag) else None
                if only_child is not None and only_child.name == "em":
                    style = STYLES["tagline"]
                elif only_child is not None and only_child.name == "strong":
                    style = STYLES["meta"]
                else:
                    style = STYLES["cover_body"]
            else:
                style = STYLES["body"]
            flowables.append(Paragraph(inline_markup(node), style))

        elif name == "hr":
            nxt = next_meaningful_sibling(node)
            if not (isinstance(nxt, Tag) and nxt.name in ("h1", "h2")):
                flowables.append(HRFlowable(width="100%", thickness=0.5, color=RULE_COLOR, spaceBefore=8, spaceAfter=8))

        elif name in ("ul", "ol"):
            flowables.extend(render_list(node))
            flowables.append(Spacer(1, 4))

        elif name == "table":
            table = render_table(node)
            if table is not None:
                flowables.append(table)
                flowables.append(Spacer(1, 12))

        elif name == "blockquote":
            flowables.append(Paragraph(inline_markup(node), STYLES["tagline"]))

    return flowables


# ---------------------------------------------------------------------------
# Page furniture: running footer with "Page X of Y" (skips the cover page)
#
# The total page count isn't known until the whole story has been laid out,
# so this does a throwaway first pass just to count pages, then builds the
# real file with that total baked into the footer callback. (A trick of
# deferring page-finalization into a custom Canvas.save() — the usual way to
# get "Page X of Y" — silently breaks bookmarkPage()/internal links, since
# they'd all resolve against a page that doesn't exist yet at draw time.)
# ---------------------------------------------------------------------------

class PageCounter:
    def __init__(self):
        self.count = 0

    def __call__(self, canvas, doc):
        self.count = max(self.count, canvas.getPageNumber())


def draw_furniture(canvas, doc, total_pages):
    page_num = canvas.getPageNumber()
    if page_num == 1:
        return
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, PAGE_H - 0.5 * inch, "STACK RANKED — RULEBOOK")
    canvas.drawCentredString(PAGE_W / 2, 0.5 * inch, f"Page {page_num} of {total_pages}")
    canvas.restoreState()


def build_flowables(soup):
    _used_slugs.clear()
    return render_document(soup)


def make_doc():
    return SimpleDocTemplate(
        str(OUTPUT_PDF), pagesize=letter,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN,
        title="Stack Ranked — Rulebook", author="Synergy Corp",
    )


def main():
    text = RULEBOOK_MD.read_text(encoding="utf-8")
    html = markdown.markdown(text, extensions=["tables", "sane_lists"], tab_length=2)
    soup = BeautifulSoup(html, "html.parser")

    counter = PageCounter()
    SimpleDocTemplate(
        io.BytesIO(), pagesize=letter,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN,
    ).build(build_flowables(soup), onFirstPage=counter, onLaterPages=counter)
    total_pages = counter.count

    furniture = lambda canvas, doc: draw_furniture(canvas, doc, total_pages)
    make_doc().build(build_flowables(soup), onFirstPage=furniture, onLaterPages=furniture)

    all_headings = {n.get_text() for n in soup.find_all(["h1", "h2", "h3", "h4"])}
    href_targets = {a["href"][1:] for a in soup.find_all("a", href=True) if a["href"].startswith("#")}
    missing = href_targets - _used_slugs
    if missing:
        print(f"Warning: {len(missing)} link(s) point to a heading that wasn't found: {sorted(missing)}")

    print(f"Wrote {OUTPUT_PDF} ({total_pages} pages, {len(all_headings)} headings, {len(href_targets)} internal links)")


if __name__ == "__main__":
    main()
