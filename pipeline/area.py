"""The area pack: a coarsened grid, cut into tiles, for points nobody listed.

The listed locations are extracted at the full resolution of the source and
published in data/forecast.json. That cannot answer for a place typed into the
app, so this module writes the other half: temperature, precipitation and cloud
cover over the whole domain, thinned to about two kilometres and split into
tiles the app fetches one at a time. A tile is a few tens of kilobytes, while
the whole pack is measured in megabytes, so the phone never pays for the
country to answer for one point.

Layout of a tile file. Sections follow the order of AREA_FIELDS with no padding
between them, and inside a section the whole time series of a point sits
together:

    index = (row * width + column) * hours + hour

Values are little-endian integers, and the value the app wants is the stored
integer divided by the scale of its field. Everything needed to read a tile -
grid origin and step, tile size, field order, scales, times - is in index.json
beside the tiles, so the app never has to guess the format.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from .config import AREA_FIELDS, AREA_TILE, AreaField

#: Storage types, spelled little-endian so the file does not depend on the
#: machine that wrote it.
DTYPES: dict[str, str] = {"int16": "<i2", "uint16": "<u2", "uint8": "|u1"}

INDEX_NAME = "index.json"


def align_grids(
    by_field: dict[str, tuple[np.ndarray, pd.DatetimeIndex]],
) -> tuple[dict[str, np.ndarray], pd.DatetimeIndex]:
    """Cut every field to the hours all of them share.

    Precipitation starts an hour later than the instantaneous fields, because
    an accumulation over a zero-length interval has no meaning. Without this
    the pack would carry an hour that only some of its fields cover.
    """
    if not by_field:
        raise ValueError("no fields to align")

    common: pd.DatetimeIndex | None = None
    for _, times in by_field.values():
        common = times if common is None else common.intersection(times)
    common = common.sort_values()
    if not len(common):
        raise ValueError("the fields share no valid time")

    aligned = {
        field: values[times.get_indexer(common)]
        for field, (values, times) in by_field.items()
    }
    return aligned, common


def encode_field(values: np.ndarray, spec: AreaField) -> np.ndarray:
    """Quantise one field to its storage type.

    Values are clipped to what the type holds rather than allowed to wrap
    around, so a stray reading can only be wrong by its own size, never by the
    width of the type.
    """
    dtype = np.dtype(DTYPES[spec.dtype])
    limits = np.iinfo(dtype)
    scaled = np.round(np.asarray(values, dtype="float64") * spec.scale)
    return np.clip(scaled, limits.min, limits.max).astype(dtype)


def tile_payload(
    encoded: list[tuple[AreaField, np.ndarray]], rows: slice, columns: slice
) -> bytes:
    """One tile: every field of it, each point's hours kept together."""
    chunks = []
    for _, array in encoded:
        window = array[:, rows, columns]
        # From [hour, row, column] to [row, column, hour], which in C order is
        # exactly the layout the app reads.
        chunks.append(np.moveaxis(window, 0, -1).ravel(order="C").tobytes())
    return b"".join(chunks)


def _format_time(moment: pd.Timestamp) -> str:
    return moment.tz_convert("UTC").strftime("%Y-%m-%dT%H:%MZ")


def build_index(
    run_id: str,
    generated_at: datetime,
    times: pd.DatetimeIndex,
    lats: np.ndarray,
    lons: np.ndarray,
    tile: int,
) -> dict:
    """The description the app reads before it touches a single tile."""
    return {
        "run_id": run_id,
        "generated_at": generated_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "byte_order": "little",
        "grid": {
            "lat0": float(lats[0]),
            "lon0": float(lons[0]),
            "dlat": float(lats[1] - lats[0]),
            "dlon": float(lons[1] - lons[0]),
            "ny": int(len(lats)),
            "nx": int(len(lons)),
        },
        "tile": int(tile),
        "tiles": {
            "x": int(-(-len(lons) // tile)),
            "y": int(-(-len(lats) // tile)),
        },
        "hours": int(len(times)),
        "times": [_format_time(moment) for moment in times],
        "fields": [
            {"name": spec.field, "type": spec.dtype, "scale": spec.scale}
            for spec in AREA_FIELDS
        ],
    }


def write_area_pack(
    directory: Path,
    run_id: str,
    generated_at: datetime,
    grids: dict[str, np.ndarray],
    times: pd.DatetimeIndex,
    lats: np.ndarray,
    lons: np.ndarray,
    tile: int = AREA_TILE,
) -> dict:
    """Write index.json and one file per tile, and return the index.

    grids hold the fields in the units of data/forecast.json, indexed
    [hour, latitude, longitude]; precipitation is expected to be hourly
    already. The directory is replaced wholesale, so a pack never mixes tiles
    from two runs.
    """
    missing = [spec.field for spec in AREA_FIELDS if spec.field not in grids]
    if missing:
        raise ValueError(f"area pack is missing fields: {', '.join(missing)}")

    shape = (len(times), len(lats), len(lons))
    for field, values in grids.items():
        if values.shape != shape:
            raise ValueError(f"{field}: expected shape {shape}, got {values.shape}")

    encoded = [(spec, encode_field(grids[spec.field], spec)) for spec in AREA_FIELDS]
    index = build_index(run_id, generated_at, times, lats, lons, tile)

    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)

    for ty in range(index["tiles"]["y"]):
        rows = slice(ty * tile, min((ty + 1) * tile, len(lats)))
        for tx in range(index["tiles"]["x"]):
            columns = slice(tx * tile, min((tx + 1) * tile, len(lons)))
            payload = tile_payload(encoded, rows, columns)
            (directory / f"{tx}-{ty}.bin").write_bytes(payload)

    with (directory / INDEX_NAME).open("w", encoding="utf-8") as handle:
        json.dump(index, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    return index


def pack_size(directory: Path) -> int:
    """Bytes on disk, for the log line that says what a run published."""
    return sum(path.stat().st_size for path in directory.glob("*") if path.is_file())
