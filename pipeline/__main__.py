"""Entry point: turn the newest complete ALADIN run into the published data.

Two things come out of a run. data/forecast.json carries the listed locations
at the full resolution of the source and is committed. The area pack carries a
coarsened grid for points typed into the app; it is far too large to keep in
the history, so it is written to a build directory the workflow publishes.

Idempotent by design. When the newest complete run is the one already written,
nothing is downloaded and neither output is touched.
"""

from __future__ import annotations

import argparse
import logging
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from .area import align_grids, pack_size, write_area_pack
from .build import build_forecast, read_run_id, write_forecast
from .config import (
    AREA_FIELDS,
    AREA_STRIDE,
    LOCATIONS,
    PARAMETERS,
    Location,
    location_is_on_grid,
)
from .reader import (
    hourly_grid_from_accumulated,
    read_grid,
    read_point_series,
    to_output_units,
)
from .source import Run, download, latest_complete_run

LOG = logging.getLogger("pipeline")

DEFAULT_OUTPUT = Path("data/forecast.json")
DEFAULT_AREA_OUTPUT = Path("build/area")

AREA_FIELD_NAMES = frozenset(spec.field for spec in AREA_FIELDS)

USER_AGENT = "mys-aladin/1.0 (personal forecast; https://github.com/miroslav-slavik/mys-aladin)"


def _session() -> requests.Session:
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    return session


@dataclass
class Extracted:
    """Everything one download of a run yields."""

    points: dict[Location, dict] = field(default_factory=dict)
    """Per location, per field, the series that goes into forecast.json."""

    grids: dict[str, tuple[np.ndarray, pd.DatetimeIndex]] = field(default_factory=dict)
    """Per field of the area pack, the thinned grid in output units."""

    lats: np.ndarray | None = None
    lons: np.ndarray | None = None


def collect(
    session: requests.Session, run: Run, work_dir: Path, with_area: bool = True
) -> Extracted:
    """Download each parameter once and take everything needed out of it."""
    extracted = Extracted(points={location: {} for location in LOCATIONS})
    for parameter in PARAMETERS:
        LOG.info("downloading %s", parameter.file_part)
        path = download(session, run, parameter.file_part, work_dir)

        for location in LOCATIONS:
            raw = read_point_series(path, parameter, location)
            extracted.points[location][parameter.field] = to_output_units(raw, parameter)

        if with_area and parameter.field in AREA_FIELD_NAMES:
            grid = read_grid(path, parameter, AREA_STRIDE)
            values = grid.values
            if parameter.accumulated:
                values = hourly_grid_from_accumulated(values)
            # Every conversion is plain arithmetic, so it applies to the whole
            # field at once. Rounding is left to the pack, which quantises.
            extracted.grids[parameter.field] = (parameter.convert(values), grid.times)
            extracted.lats, extracted.lons = grid.lats, grid.lons

        path.unlink()
    return extracted


def run_pipeline(
    output: Path,
    force: bool = False,
    area_output: Path | None = DEFAULT_AREA_OUTPUT,
) -> int:
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
        extracted = collect(session, run, Path(work), with_area=area_output is not None)

    # One moment for both outputs, so the app can tell that a tile and the
    # forecast beside it came from the same run of this pipeline.
    moment = datetime.now(timezone.utc)

    forecast = build_forecast(run.run_id, extracted.points, generated_at=moment)
    write_forecast(output, forecast)
    hours = len(forecast["locations"][0]["series"]) if forecast["locations"] else 0
    LOG.info("wrote %s: run %s, %d hours per location", output, run.run_id, hours)

    if area_output is not None:
        grids, times = align_grids(extracted.grids)
        index = write_area_pack(
            area_output,
            run.run_id,
            moment,
            grids,
            times,
            extracted.lats,
            extracted.lons,
        )
        LOG.info(
            "wrote %s: %d x %d tiles over %d x %d points, %d hours, %.1f MB",
            area_output,
            index["tiles"]["x"],
            index["tiles"]["y"],
            index["grid"]["nx"],
            index["grid"]["ny"],
            index["hours"],
            pack_size(area_output) / 1e6,
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--area-output",
        type=Path,
        default=DEFAULT_AREA_OUTPUT,
        help="directory for the area pack; it is replaced on every run",
    )
    parser.add_argument(
        "--no-area",
        action="store_true",
        help="skip the area pack and publish the listed locations only",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="rebuild even when the newest run is already published",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    return run_pipeline(
        args.output,
        args.force,
        None if args.no_area else args.area_output,
    )


if __name__ == "__main__":
    sys.exit(main())
