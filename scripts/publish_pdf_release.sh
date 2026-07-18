#!/usr/bin/env bash
#
# publish_pdf_release.sh — publish the generated print-and-play PDFs as assets
# on a GitHub Release.
#
# The PDFs are build artifacts (see .gitignore: docs/*.pdf) and are hosted on a
# Release instead of being committed. Regenerate them first:
#
#   python3 generate_rulebook_pdf.py
#   python3 generate_print_and_play.py
#   python3 generate_player_mat.py
#   python3 generate_career_ladder.py
#
# ...then run this script to create/refresh a release and (over)write the
# assets. Requires the GitHub CLI (`gh auth login`) with contents:write on the
# repo. The `.github/workflows/publish-pdfs.yml` workflow does exactly this on
# every merge to main that touches a PDF source — this script is the manual
# fallback and its shared implementation.
#
# Usage: scripts/publish_pdf_release.sh [TAG] [--latest]
#
#   TAG       release tag to publish to (default: pdf-assets, the stable manual
#             target). CI passes a unique per-build tag, e.g. pdf-42.
#   --latest  explicitly flag this release as the repo's "Latest", so that
#             /releases/latest/download/<asset> resolves to it (that's what the
#             README download links use).
#
# Env overrides: REPO, RELEASE_TITLE, RELEASE_NOTES.
set -euo pipefail

TAG="pdf-assets"
MARK_LATEST=0
for arg in "$@"; do
  case "$arg" in
    --latest) MARK_LATEST=1 ;;
    --*)      echo "unknown flag: $arg" >&2; exit 2 ;;
    *)        TAG="$arg" ;;
  esac
done

REPO="${REPO:-mpechuk/stack-ranked}"
TITLE="${RELEASE_TITLE:-Printable PDFs}"
NOTES="${RELEASE_NOTES:-Generated print-and-play PDFs for Stack Ranked. Build artifacts produced by the generate_*.py scripts, hosted here instead of tracked in the repo.}"
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

# Create the release if it doesn't exist yet; otherwise keep the latest flag current.
if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Creating release $TAG ..."
  create_args=("$TAG" --repo "$REPO" --title "$TITLE" --notes "$NOTES")
  [[ "$MARK_LATEST" -eq 1 ]] && create_args+=(--latest)
  gh release create "${create_args[@]}"
elif [[ "$MARK_LATEST" -eq 1 ]]; then
  gh release edit "$TAG" --repo "$REPO" --latest >/dev/null
fi

# Upload/overwrite each asset.
for f in "${PDFS[@]}"; do
  echo "Uploading $f ..."
  gh release upload "$TAG" --repo "$REPO" --clobber "$DOCS_DIR/$f"
done

echo "Done: https://github.com/$REPO/releases/tag/$TAG"
