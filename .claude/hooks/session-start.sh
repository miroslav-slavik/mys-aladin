#!/bin/bash
# SessionStart hook: prepares the environment for reading ALADIN GRIB2 output.
#
# Delegates to scripts/setup-env.sh, which installs the project dependencies
# into an isolated venv. The hook is idempotent, so a repeated run only
# verifies that an already prepared environment still works.
set -euo pipefail

# Outside Claude Code on the web the hook does nothing, so that a local
# development machine stays untouched.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
VENV_DIR="${GRIB_VENV_DIR:-$HOME/.venvs/grib}"

GRIB_VENV_DIR="$VENV_DIR" bash "$PROJECT_DIR/scripts/setup-env.sh"

# Expose the venv for the rest of the session, so python and pip resolve to it.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export VIRTUAL_ENV=\"$VENV_DIR\""
    echo "export PATH=\"$VENV_DIR/bin:\$PATH\""
  } >> "$CLAUDE_ENV_FILE"
fi
