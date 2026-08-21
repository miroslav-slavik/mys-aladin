#!/usr/bin/env bash
# Set up the environment for reading ALADIN GRIB2 output.
#
# Dependencies are installed from PyPI into an isolated venv, which avoids two
# problems specific to this environment:
#   1) the distro packages python3-eccodes / python3-cfgrib are built for
#      Python 3.12 while the default interpreter here is Python 3.11,
#   2) installing with pip into the system environment clashes with
#      dpkg-managed packages that carry no RECORD metadata.
# The PyPI eccodes package pulls in eccodeslib with a prebuilt ecCodes library,
# so neither a system libeccodes nor a PPA repository is required.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${GRIB_VENV_DIR:-$HOME/.venvs/grib}"
REQUIREMENTS="$PROJECT_DIR/requirements.txt"

if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

pip install --upgrade pip
if [ -f "$REQUIREMENTS" ]; then
  pip install -r "$REQUIREMENTS"
else
  # Fallback for a checkout without requirements.txt: the GRIB reader alone.
  pip install cfgrib eccodes
fi

python -m eccodes selfcheck
python -c "import cfgrib; print('cfgrib', cfgrib.__version__, 'OK')"

deactivate

echo "Done. Activate with: source $VENV_DIR/bin/activate"
