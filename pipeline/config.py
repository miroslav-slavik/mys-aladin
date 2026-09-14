"""Static configuration: the locations we forecast for and the ALADIN fields
we read.

Facts encoded here (grid layout, parameter numbers, units, the accumulated
nature of precipitation) were verified in Phase 1; see docs/parametry.md.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
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
    """Short key, stable across renames of the label."""

    lat: float
    lon: float

    label: str = ""
    """What the app puts on screen; falls back to the name when empty."""


#: Locations live one per file, so a new one can be added by writing a file
#: rather than by editing code - which is what lets the app offer to add the
#: place it is showing.
PLACES_DIR = Path(__file__).resolve().parent.parent / "places"

PLACE_KEYS = {"name", "label", "lat", "lon"}


@dataclass(frozen=True)
class Places:
    """What a directory of place files yielded, problems included.

    A typo in one file must not cost the forecast for every other place, so
    the loader reports what it could not read and carries on with the rest.
    """

    locations: tuple[Location, ...]
    problems: tuple[str, ...]


def parse_place(document: object, key: str) -> Location:
    """One place file, checked before it can reach the pipeline."""
    if not isinstance(document, dict):
        raise ValueError("expected an object")
    unknown = set(document) - PLACE_KEYS
    if unknown:
        raise ValueError(f"unknown keys: {', '.join(sorted(unknown))}")
    for required in ("lat", "lon"):
        if required not in document:
            raise ValueError(f"missing {required}")
        if not isinstance(document[required], (int, float)) or isinstance(document[required], bool):
            raise ValueError(f"{required} is not a number")

    name = str(document.get("name") or key).strip()
    if not name:
        raise ValueError("name is empty")

    location = Location(
        name=name,
        lat=float(document["lat"]),
        lon=float(document["lon"]),
        label=str(document.get("label") or "").strip(),
    )
    if not location_is_on_grid(location):
        raise ValueError(
            f"{location.lat}, {location.lon} lies outside the CZ_1km grid"
        )
    return location


def load_places(directory: Path = PLACES_DIR) -> Places:
    """Every place file of a directory, in a stable order.

    home.json comes first, the rest by file name, because the app opens on the
    first location when it has no choice of its own remembered.
    """
    if not directory.is_dir():
        return Places((), (f"{directory} is not a directory",))

    locations: list[Location] = []
    problems: list[str] = []
    taken: set[str] = set()
    paths = sorted(directory.glob("*.json"), key=lambda path: (path.stem != "home", path.stem))
    for path in paths:
        try:
            location = parse_place(json.loads(path.read_text(encoding="utf-8")), path.stem)
        except (ValueError, OSError, json.JSONDecodeError) as error:
            problems.append(f"{path.name}: {error}")
            continue
        if location.name in taken:
            problems.append(f"{path.name}: name {location.name} is already taken")
            continue
        taken.add(location.name)
        locations.append(location)
    return Places(tuple(locations), tuple(problems))


#: The area pack: a coarsened copy of the whole grid, so the app can answer for
#: a point nobody listed in advance. Every AREA_STRIDE-th point of the 1 km
#: source grid is kept, which gives a step of about two kilometres.
AREA_STRIDE = 2

#: Side of one tile, in points of the coarsened grid. Twelve keeps a tile near
#: fifty kilobytes, small enough to fetch over a phone connection.
AREA_TILE = 12


@dataclass(frozen=True)
class AreaField:
    """One field of the area pack and how its values are stored.

    The value the app reads back is the stored integer divided by the scale,
    in the units of data/forecast.json.
    """

    field: str
    dtype: str
    scale: float


#: Temperature and precipitation are what the pack exists for. Cloud cover
#: comes along because it costs a single byte per point and hour and the hourly
#: icons cannot be drawn without it. Wind is deliberately absent: it would add
#: two bytes for a quantity that matters least, and the listed locations carry
#: it anyway, at the full resolution of the source grid.
AREA_FIELDS: tuple[AreaField, ...] = (
    AreaField("t2m", "int16", 10.0),        # 0.1 °C
    AreaField("precip_mm", "uint16", 10.0),  # 0.1 mm
    AreaField("cloud_pct", "uint8", 1.0),    # whole per cent
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


def parameter_for(field: str) -> Parameter:
    """The source parameter that fills one field of the output."""
    for parameter in PARAMETERS:
        if parameter.field == field:
            return parameter
    raise KeyError(field)


def location_is_on_grid(location: Location) -> bool:
    return (
        GRID_LAT_MIN <= location.lat <= GRID_LAT_MAX
        and GRID_LON_MIN <= location.lon <= GRID_LON_MAX
    )
