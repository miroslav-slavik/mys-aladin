#!/bin/bash
# SessionStart hook: pripravi prostredi pro cteni meteorologickych GRIB2 souboru.
#
# Delegat na scripts/setup-env.sh, ktery instaluje cfgrib a eccodes do
# izolovaneho venv. Hook je idempotentni, takze opakovane spusteni jen overi,
# ze uz pripravene prostredi funguje.
set -euo pipefail

# Lokalne (mimo Claude Code on the web) hook nic nedela, aby nezasahoval
# do vyvojaskeho prostredi na stanici.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
VENV_DIR="${GRIB_VENV_DIR:-$HOME/.venvs/grib}"

GRIB_VENV_DIR="$VENV_DIR" bash "$PROJECT_DIR/scripts/setup-env.sh"

# Zpristupni venv po zbytek relace, aby prikazy python a pip mirily do nej.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export VIRTUAL_ENV=\"$VENV_DIR\""
    echo "export PATH=\"$VENV_DIR/bin:\$PATH\""
  } >> "$CLAUDE_ENV_FILE"
fi
