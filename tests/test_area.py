"""Tests of the area pack: quantisation, tiling and the layout the app reads.

The pack is written once and read by hand-written JavaScript in the browser,
so the tests decode a tile the way the app has to, byte offset by byte offset,
rather than trusting the writer to be its own witness.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from pipeline.area import (
    INDEX_NAME,
    align_grids,
    build_index,
    encode_field,
    write_area_pack,
)
from pipeline.config import AREA_FIELDS, AREA_STRIDE, AreaField, parameter_for
from pipeline.reader import hourly_grid_from_accumulated, read_grid, read_point_series
from pipeline.config import Location

FIXTURES = Path(__file__).parent / "fixtures"

MOMENT = datetime(2026, 8, 21, 9, 35, 12, tzinfo=timezone.utc)
HOME = Location("Home", 50.110113, 14.558445)

NUMPY_TYPES = {"int16": "<i2", "uint16": "<u2", "uint8": "|u1"}


def sample_grids(hours: int = 5, ny: int = 7, nx: int = 9) -> dict[str, np.ndarray]:
    """Fields whose value encodes its own position, so a misread shows up."""
    hour, row, column = np.meshgrid(
        np.arange(hours), np.arange(ny), np.arange(nx), indexing="ij"
    )
    return {
        "t2m": (hour + row / 10.0 + column / 100.0).astype("float64"),
        "precip_mm": (column / 10.0).astype("float64"),
        "cloud_pct": ((hour + row + column) % 101).astype("float64"),
    }


def sample_axes(hours: int = 5, ny: int = 7, nx: int = 9):
    times = pd.date_range("2026-08-21T07:00", periods=hours, freq="h", tz="UTC")
    lats = 48.5 + np.arange(ny) * 0.018
    lons = 12.0 + np.arange(nx) * 0.028
    return times, lats, lons


def read_back(directory: Path, index: dict, lat: float, lon: float) -> dict[str, list]:
    """Decode one point out of the pack, the way the app has to."""
    grid = index["grid"]
    ix = round((lon - grid["lon0"]) / grid["dlon"])
    iy = round((lat - grid["lat0"]) / grid["dlat"])
    tile = index["tile"]
    tx, ty = ix // tile, iy // tile
    width = min(tile, grid["nx"] - tx * tile)
    point = (iy - ty * tile) * width + (ix - tx * tile)

    payload = (directory / f"{tx}-{ty}.bin").read_bytes()
    hours = index["hours"]
    height = min(tile, grid["ny"] - ty * tile)
    points = width * height

    series: dict[str, list] = {}
    offset = 0
    for spec in index["fields"]:
        dtype = np.dtype(NUMPY_TYPES[spec["type"]])
        section = np.frombuffer(payload, dtype=dtype, count=points * hours, offset=offset)
        series[spec["name"]] = list(
            section[point * hours : (point + 1) * hours] / spec["scale"]
        )
        offset += points * hours * dtype.itemsize
    assert offset == len(payload), "the tile holds exactly the sections it declares"
    return series


def test_a_point_survives_the_round_trip(tmp_path):
    hours, ny, nx = 5, 7, 9
    grids = sample_grids(hours, ny, nx)
    times, lats, lons = sample_axes(hours, ny, nx)

    index = write_area_pack(tmp_path, "2026-08-21T06:00Z", MOMENT, grids, times, lats, lons, tile=4)

    iy, ix = 5, 7
    read = read_back(tmp_path, index, lats[iy], lons[ix])
    assert read["t2m"] == pytest.approx(grids["t2m"][:, iy, ix], abs=0.05)
    assert read["precip_mm"] == pytest.approx(grids["precip_mm"][:, iy, ix], abs=0.05)
    assert read["cloud_pct"] == pytest.approx(grids["cloud_pct"][:, iy, ix], abs=0.5)


def test_every_declared_tile_exists_and_the_edges_are_short(tmp_path):
    hours, ny, nx = 3, 7, 9
    grids = sample_grids(hours, ny, nx)
    times, lats, lons = sample_axes(hours, ny, nx)

    index = write_area_pack(tmp_path, "run", MOMENT, grids, times, lats, lons, tile=4)

    assert (index["tiles"]["x"], index["tiles"]["y"]) == (3, 2)
    for ty in range(index["tiles"]["y"]):
        for tx in range(index["tiles"]["x"]):
            width = min(4, nx - tx * 4)
            height = min(4, ny - ty * 4)
            # Two bytes for temperature and for precipitation, one for cloud.
            expected = width * height * hours * 5
            assert (tmp_path / f"{tx}-{ty}.bin").stat().st_size == expected


def test_the_index_describes_the_grid_the_app_has_to_walk(tmp_path):
    times, lats, lons = sample_axes()
    index = write_area_pack(tmp_path, "2026-08-21T06:00Z", MOMENT, sample_grids(), times, lats, lons, tile=4)

    written = json.loads((tmp_path / INDEX_NAME).read_text(encoding="utf-8"))
    assert written == index
    assert written["run_id"] == "2026-08-21T06:00Z"
    assert written["generated_at"] == "2026-08-21T09:35:12Z"
    assert written["byte_order"] == "little"
    assert written["grid"]["dlat"] == pytest.approx(0.018)
    assert written["grid"]["dlon"] == pytest.approx(0.028)
    assert written["times"][0] == "2026-08-21T07:00Z"
    assert [spec["name"] for spec in written["fields"]] == [
        spec.field for spec in AREA_FIELDS
    ]


def test_a_previous_pack_is_replaced_whole(tmp_path):
    times, lats, lons = sample_axes()
    write_area_pack(tmp_path, "old", MOMENT, sample_grids(), times, lats, lons, tile=4)
    stale = tmp_path / "9-9.bin"
    stale.write_bytes(b"from a run that no longer exists")

    write_area_pack(tmp_path, "new", MOMENT, sample_grids(), times, lats, lons, tile=4)

    assert not stale.exists()


def test_values_are_clipped_to_the_storage_type_rather_than_wrapped():
    spec = AreaField("precip_mm", "uint16", 10.0)
    encoded = encode_field(np.array([-0.4, 0.0, 12.34, 1e9]), spec)

    assert list(encoded[:3]) == [0, 0, 123]
    assert encoded[3] == np.iinfo(np.uint16).max


def test_a_missing_field_is_refused(tmp_path):
    times, lats, lons = sample_axes()
    grids = sample_grids()
    del grids["cloud_pct"]

    with pytest.raises(ValueError, match="missing fields: cloud_pct"):
        write_area_pack(tmp_path, "run", MOMENT, grids, times, lats, lons)


def test_a_field_of_the_wrong_shape_is_refused(tmp_path):
    times, lats, lons = sample_axes()
    grids = sample_grids()
    grids["t2m"] = grids["t2m"][:, :-1, :]

    with pytest.raises(ValueError, match="t2m: expected shape"):
        write_area_pack(tmp_path, "run", MOMENT, grids, times, lats, lons)


def test_alignment_drops_the_hour_precipitation_does_not_cover():
    hours = pd.date_range("2026-08-21T06:00", periods=4, freq="h", tz="UTC")
    instant = np.arange(4 * 2 * 2, dtype="float64").reshape(4, 2, 2)
    accumulated = np.arange(3 * 2 * 2, dtype="float64").reshape(3, 2, 2)

    aligned, times = align_grids(
        {"t2m": (instant, hours), "precip_mm": (accumulated, hours[1:])}
    )

    assert list(times) == list(hours[1:])
    assert aligned["t2m"].shape == aligned["precip_mm"].shape == (3, 2, 2)
    # The kept hours are the later ones, not the first three.
    assert aligned["t2m"][0].tolist() == instant[1].tolist()


def test_fields_without_a_shared_hour_are_refused():
    first = pd.date_range("2026-08-21T06:00", periods=2, freq="h", tz="UTC")
    second = pd.date_range("2026-08-22T06:00", periods=2, freq="h", tz="UTC")
    values = np.zeros((2, 2, 2))

    with pytest.raises(ValueError, match="share no valid time"):
        align_grids({"t2m": (values, first), "precip_mm": (values, second)})


def test_index_counts_tiles_so_that_none_of_the_grid_is_left_out():
    times, lats, lons = sample_axes(hours=1, ny=145, nx=251)
    index = build_index("run", MOMENT, times[:1], lats, lons, tile=12)

    assert index["tiles"] == {"x": 21, "y": 13}
    assert index["tiles"]["x"] * 12 >= index["grid"]["nx"]
    assert index["tiles"]["y"] * 12 >= index["grid"]["ny"]


def test_the_thinned_grid_keeps_the_geometry_of_the_source():
    """Read over the real fixture: a thinned field still covers the domain."""
    grid = read_grid(FIXTURES / "t2m_step0.grb", parameter_for("t2m"), AREA_STRIDE)

    assert grid.values.shape == (1, 145, 251)
    assert grid.lats[0] == pytest.approx(48.5, abs=1e-6)
    assert grid.lons[0] == pytest.approx(12.0, abs=1e-6)
    # Two steps of the source grid, whose own steps are 0.009 and 0.01399
    # degrees, both close to a kilometre. The longitude step is not the round
    # 0.014 the documentation quotes, which is why the index carries the step
    # measured from the data rather than a constant.
    assert float(grid.lats[1] - grid.lats[0]) == pytest.approx(0.018, abs=1e-6)
    assert float(grid.lons[1] - grid.lons[0]) == pytest.approx(0.02798, abs=1e-6)


def test_the_thinned_grid_agrees_with_the_point_extraction():
    """The pack must not read a different field than forecast.json does.

    Thinning moves the nearest point by up to one source step, so the two
    readings differ a little; the test allows a degree, which is far less than
    the spread over the country and far more than a coding slip would give.
    """
    parameter = parameter_for("t2m")
    grid = read_grid(FIXTURES / "t2m_step0.grb", parameter, AREA_STRIDE)
    point = read_point_series(FIXTURES / "t2m_step0.grb", parameter, HOME)

    iy = int(round((HOME.lat - grid.lats[0]) / (grid.lats[1] - grid.lats[0])))
    ix = int(round((HOME.lon - grid.lons[0]) / (grid.lons[1] - grid.lons[0])))

    assert float(grid.values[0, iy, ix]) == pytest.approx(float(point.iloc[0]), abs=1.0)


def test_hourly_totals_over_a_grid_match_the_series_convention():
    accumulated = np.array([[[1.0]], [[1.5]], [[1.4999]], [[3.0]]])

    hourly = hourly_grid_from_accumulated(accumulated)

    # The first step keeps its value, the rest are differences, and packing
    # noise that would show as negative rain is clipped away.
    assert hourly[:, 0, 0].tolist() == pytest.approx([1.0, 0.5, 0.0, 1.5001], abs=1e-6)
