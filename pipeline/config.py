"""Static configuration: the locations we forecast for and the ALADIN fields
we read.

Facts encoded here (grid layout, parameter numbers, units, the accumulated
nature of precipitation) were verified in Phase 1; see docs/parametry.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

BASE_URL = "https://opendata.chmi.cz/meteorology/weather/nwp_aladin/CZ_1km"

#: Nominal model run hours, UTC.
RUN_HOURS = (0, 6, 12, 18)

#: A complete run publishes this many files; fewer means it is still landing.
FILES_PER_RUN = 31

#: Bounding box of the CZ_1km grid, used to reject locations outside it.
GRID_LAT_MIN, GRID_LAT_MAX = 48.5, 51.098
GRID_LON_MIN, GRID_LON_MAX = 12.0, 18.995


@dataclass(frozen=True)
class Location:
    name: str
    lat: float
    lon: float


LOCATIONS: tuple[Location, ...] = (
    # Lipnická 1450, Kyje, 198 00 Praha 9 (RUIAN address point 25225472).
    Location("Home", 50.110113, 14.558445),
)


@dataclass(frozen=True)
class Parameter:
    """One ALADIN field and how it maps onto a field of the output JSON."""

    field: str
    """Key used in data/forecast.json."""

    file_part: str
    """Parameter segment of the source file name."""

    indicator: int
    """GRIB1 indicatorOfParameter, the only reliable identifier in the message."""

    convert: Callable[[float], float]
    """Source unit to output unit."""

    decimals: int | None
    """Rounding of the output value; None means round to a whole number."""

    accumulated: bool = False
    """True when the field accumulates from the start of the run."""


PARAMETERS: tuple[Parameter, ...] = (
    Parameter("t2m", "CLSTEMPERATURE", 11, lambda v: v - 273.15, 1),
    Parameter("precip_mm", "SURFPREC_TOTAL", 61, lambda v: v, 1, accumulated=True),
    Parameter("cloud_pct", "SURFNEBUL_TOTALE", 171, lambda v: v * 100.0, None),
    Parameter("wind_ms", "CLSWIND_SPEED", 32, lambda v: v, 1),
    Parameter("wind_dir", "CLSWIND_DIREC", 31, lambda v: v, None),
)


def location_is_on_grid(location: Location) -> bool:
    return (
        GRID_LAT_MIN <= location.lat <= GRID_LAT_MAX
        and GRID_LON_MIN <= location.lon <= GRID_LON_MAX
    )
