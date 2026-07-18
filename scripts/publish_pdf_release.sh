#!/usr/bin/env bash
#
# publish_pdf_release.sh — publish the generated print-and-play PDFs as assets
# on the "pdf-assets" GitHub Release.
#
# The PDFs are build artifacts (see .gitignore: docs/*.pdf) and are hosted on a
# Release instead of being committed. Regenerate them first:
#
#   python3 generate_rulebook_pdf.py
#   python3 generate_print_and_play.py
#   python3 generate_player_mat.py
#   python3 generate_career_ladder.py
#
# ...then run this script to create/refresh the release and (over)write the
# assets. Requires the GitHub CLI (`gh auth login`) with contents:write on the
# repo.
#
# Usage: scripts/publish_pdf_release.sh
set -euo pipefail

TAG="pdf-assets"
TITLE="Printable PDFs"
REPO="mpechuk/stack-ranked"
DOCS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../docs" && pwd)"

PDFS=(
  "Stack_Ranked_Rulebook.pdf"
  "Stack_Ranked_PrintAndPlay.pdf"
  "Stack_Ranked_PlayerMat.pdf"
  "Stack_Ranked_CareerLadder.pdf"
)

# Verify every PDF exists before touching the release.
missing=0
for f in "${PDFS[@]}"; do
  if [[ ! -f "$DOCS_DIR/$f" ]]; then
    echo "missing: docs/$f — regenerate it first (see header)." >&2
    missing=1
  fi
done
[[ "$missing" -eq 0 ]] || exit 1

# Create the release if it doesn't exist yet.
if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Creating release $TAG ..."
  gh release create "$TAG" --repo "$REPO" --title "$TITLE" \
    --notes "Generated print-and-play PDFs for Stack Ranked. Build artifacts produced by the generate_*.py scripts, hosted here instead of tracked in the repo."
fi

# Upload/overwrite each asset.
for f in "${PDFS[@]}"; do
  echo "Uploading $f ..."
  gh release upload "$TAG" --repo "$REPO" --clobber "$DOCS_DIR/$f"
done

echo "Done: https://github.com/$REPO/releases/tag/$TAG"
