#!/usr/bin/env bash
# One-time installer for the document skills (pdf, docx, pptx, xlsx) from
# https://github.com/anthropics/skills, plus the Python/Node deps they need.
#
# Usage:
#   ./scripts/sync-skills.sh            # full install (skills + statutes + deps)
#   ./scripts/sync-skills.sh --skills   # only refetch the skill folders
#   ./scripts/sync-skills.sh --statutes # only install CA statute corpus
#   ./scripts/sync-skills.sh --deps     # only reinstall python/node deps
#
# This script is intentionally not run on every launch. Run it once after
# cloning, or whenever you want to refresh the skills/deps.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_REPO_URL="${RECOURSE_SKILLS_REPO_URL:-https://github.com/anthropics/skills.git}"
SKILLS_REPO_REF="${RECOURSE_SKILLS_REPO_REF:-main}"
DOC_SKILLS=(pdf docx pptx xlsx)

SKILLS_DEST="$REPO_ROOT/resources/skills"
STATUTES_DEST="$REPO_ROOT/resources/ca/statutes"
STATUTES_REPO_URL="${RECOURSE_STATUTES_REPO_URL:-https://github.com/johnakelly-yahoo-com/california-codes.git}"
STATUTES_REPO_REF="${RECOURSE_STATUTES_REPO_REF:-main}"
RUNTIME_DIR="$REPO_ROOT/.recourse-runtime"
VENV_DIR="$RUNTIME_DIR/python/venv"
NODE_DIR="$RUNTIME_DIR/node"
TMP_DIR="$RUNTIME_DIR/tmp"

PY_PACKAGES=(
  "pypdf"
  "pdfplumber"
  "pdf2image"
  "pytesseract"
  "reportlab"
  "pikepdf"
  "python-docx"
  "openpyxl"
  "markitdown[pptx,docx,xlsx,pdf]"
  "Pillow"
  "lxml"
  "defusedxml"
)
NPM_PACKAGES=(docx pptxgenjs)
SYSTEM_BINARIES=(qpdf pdftoppm tesseract soffice pandoc)

color() { printf '\033[%sm%s\033[0m' "$1" "$2"; }
say()   { printf '%s %s\n' "$(color '1;36' '›')" "$1"; }
warn()  { printf '%s %s\n' "$(color '1;33' '!')" "$1"; }
ok()    { printf '%s %s\n' "$(color '1;32' '✓')" "$1"; }

mode="all"
case "${1:-}" in
  --skills)   mode="skills" ;;
  --statutes) mode="statutes" ;;
  --deps)     mode="deps" ;;
  "")         mode="all" ;;
  *) echo "Unknown flag: $1"; exit 64 ;;
esac

sync_skills() {
  say "Fetching document skills from $SKILLS_REPO_URL@$SKILLS_REPO_REF"
  mkdir -p "$TMP_DIR" "$SKILLS_DEST"
  rm -rf "$TMP_DIR/anthropic-skills"
  git clone --depth 1 --branch "$SKILLS_REPO_REF" --filter=blob:none --sparse \
    "$SKILLS_REPO_URL" "$TMP_DIR/anthropic-skills" >/dev/null 2>&1

  ( cd "$TMP_DIR/anthropic-skills"
    git sparse-checkout set "${DOC_SKILLS[@]/#/skills/}" >/dev/null
  )

  for skill in "${DOC_SKILLS[@]}"; do
    src="$TMP_DIR/anthropic-skills/skills/$skill"
    dst="$SKILLS_DEST/$skill"
    if [[ ! -d "$src" ]]; then
      warn "Skill '$skill' not present upstream — skipping"
      continue
    fi
    rm -rf "$dst"
    mkdir -p "$dst"
    cp -R "$src/." "$dst/"
    ok "Installed skill: $skill"
  done

  rm -rf "$TMP_DIR/anthropic-skills"
}

sync_statutes() {
  say "Fetching CA statute corpus from $STATUTES_REPO_URL@$STATUTES_REPO_REF"
  mkdir -p "$TMP_DIR" "$STATUTES_DEST"
  rm -rf "$TMP_DIR/ca-codes"
  git clone --depth 1 --branch "$STATUTES_REPO_REF" \
    "$STATUTES_REPO_URL" "$TMP_DIR/ca-codes" >/dev/null 2>&1

  if [[ ! -d "$TMP_DIR/ca-codes/codes" ]]; then
    warn "Statute corpus missing codes/ directory upstream — aborting"
    rm -rf "$TMP_DIR/ca-codes"
    exit 1
  fi

  mkdir -p "$STATUTES_DEST"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$TMP_DIR/ca-codes/codes/" "$STATUTES_DEST/"
  else
    rm -rf "$STATUTES_DEST"/*
    cp -R "$TMP_DIR/ca-codes/codes/." "$STATUTES_DEST/"
  fi

  rm -rf "$TMP_DIR/ca-codes"
  local count
  count="$(find "$STATUTES_DEST" -maxdepth 1 -name '*.txt' 2>/dev/null | wc -l | tr -d ' ')"
  ok "Installed CA statute corpus ($count code files)"
}

ensure_python() {
  if ! command -v python3 >/dev/null 2>&1; then
    warn "python3 is required but was not found. Install it (e.g. brew install python) and re-run."
    exit 1
  fi
}

install_python_deps() {
  ensure_python
  say "Creating Python venv at .recourse-runtime/python/venv"
  if [[ ! -d "$VENV_DIR" ]]; then
    python3 -m venv "$VENV_DIR"
  fi
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
  python -m pip install --quiet --upgrade pip
  say "Installing Python packages"
  python -m pip install --quiet --upgrade "${PY_PACKAGES[@]}"
  deactivate
  ok "Python deps ready"
}

install_node_deps() {
  if ! command -v npm >/dev/null 2>&1; then
    warn "npm is required but was not found. Install Node (e.g. brew install node) and re-run."
    exit 1
  fi
  say "Installing local Node packages: ${NPM_PACKAGES[*]}"
  mkdir -p "$NODE_DIR"
  ( cd "$NODE_DIR"
    if [[ ! -f package.json ]]; then
      cat > package.json <<'JSON'
{
  "name": "recourse-skill-runtime",
  "private": true,
  "version": "0.0.0",
  "description": "Project-local runtime for document skills used by Recourse."
}
JSON
    fi
    npm install --silent --no-audit --no-fund "${NPM_PACKAGES[@]}"
  )
  ok "Node deps ready"
}

check_system_binaries() {
  say "Checking system binaries (the agent needs these on PATH)"
  local missing=()
  for bin in "${SYSTEM_BINARIES[@]}"; do
    if command -v "$bin" >/dev/null 2>&1; then
      ok "$bin"
    else
      missing+=("$bin")
      warn "$bin not found"
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    cat <<EOF

$(color '1;33' 'Missing system binaries:') ${missing[*]}

On macOS you can install them with:
  brew install qpdf poppler tesseract pandoc
  brew install --cask libreoffice    # provides 'soffice'

These are required by the document skills (PDF tooling, OCR, Office conversion).
The Recourse app will still run, but skill commands that depend on them will fail.
EOF
  fi
}

case "$mode" in
  skills) sync_skills ;;
  statutes) sync_statutes ;;
  deps)
    install_python_deps
    install_node_deps
    check_system_binaries
    ;;
  all)
    sync_skills
    sync_statutes
    install_python_deps
    install_node_deps
    check_system_binaries
    ;;
esac

ok "Done. Restart 'npm run dev' if it was already running."
