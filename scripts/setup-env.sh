#!/usr/bin/env bash
# Inicializace prostredi pro cteni meteorologickych GRIB2 souboru (cfgrib + eccodes).
#
# Instalace probiha do izolovaneho virtualniho prostredi (venv) pres pip z PyPI.
# Tim se obchazeji dva problemy tohoto prostredi:
#   1) distribucni balicky python3-eccodes / python3-cfgrib jsou zkompilovane
#      pro Python 3.12, zatimco vychozi interpret je zde Python 3.11,
#   2) instalace pipem do systemoveho prostredi kolidovala s balicky spravovanymi
#      pres dpkg, kterym chybi metadata RECORD.
# Balicek eccodes z PyPI si stahne i eccodeslib s predkompilovanou knihovnou
# ecCodes, takze neni potreba zadny systemovy libeccodes ani PPA repozitar.
set -euo pipefail

VENV_DIR="${GRIB_VENV_DIR:-$HOME/.venvs/grib}"

if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

pip install --upgrade pip
pip install cfgrib eccodes

python -m eccodes selfcheck
python -c "import cfgrib; print('cfgrib', cfgrib.__version__, 'OK')"

deactivate

echo "Hotovo. Pro pouziti aktivujte: source $VENV_DIR/bin/activate"
