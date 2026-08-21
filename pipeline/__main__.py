"""Entry point: turn the newest complete ALADIN run into data/forecast.json.

Idempotent by design. When the newest complete run is the one already written,
nothing is downloaded and the file is left untouched.
"""

from __future__ import annotations

import argparse
import logging
import sys
import tempfile
from pathlib import Path

import requests

from .build import build_forecast, read_run_id, write_forecast
from .config import LOCATIONS, PARAMETERS, Location, location_is_on_grid
from .reader import read_point_series, to_output_units
from .source import Run, download, latest_complete_run

LOG = logging.getLogger("pipeline")

DEFAULT_OUTPUT = Path("data/forecast.json")
USER_AGENT = "mys-aladin/1.0 (personal forecast; https://github.com/miroslav-slavik/mys-aladin)"


def _session() -> requests.Session:
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    return session


def collect(session: requests.Session, run: Run, work_dir: Path) -> dict[Location, dict]:
    """Download each parameter once and extract every location from it."""
    series_by_location: dict[Location, dict] = {location: {} for location in LOCATIONS}
    for parameter in PARAMETERS:
        LOG.info("downloading %s", parameter.file_part)
        path = download(session, run, parameter.file_part, work_dir)
        for location in LOCATIONS:
            raw = read_point_series(path, parameter, location)
            series_by_location[location][parameter.field] = to_output_units(raw, parameter)
        path.unlink()
    return series_by_location


def run_pipeline(output: Path, force: bool = False) -> int:
    for location in LOCATIONS:
        if not location_is_on_grid(location):
            raise SystemExit(f"location {location.name} lies outside the CZ_1km grid")

    session = _session()
    run = latest_complete_run(session)
    LOG.info("newest complete run: %s", run.run_id)

    if not force and read_run_id(output) == run.run_id:
        LOG.info("run %s already published, nothing to do", run.run_id)
        return 0

    with tempfile.TemporaryDirectory(prefix="aladin-") as work:
        series_by_location = collect(session, run, Path(work))

    forecast = build_forecast(run.run_id, series_by_location)
    write_forecast(output, forecast)
    hours = len(forecast["locations"][0]["series"]) if forecast["locations"] else 0
    LOG.info("wrote %s: run %s, %d hours per location", output, run.run_id, hours)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--force",
        action="store_true",
        help="rebuild even when the newest run is already published",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    return run_pipeline(args.output, args.force)


if __name__ == "__main__":
    sys.exit(main())
