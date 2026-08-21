"""Reader tests over the stored GRIB fixtures.

Each fixture holds a single message of a single parameter, cut from run
2026082106: t2m_step0.grb covers a parameter ecCodes can name, and
cloud_step0.grb one from the local table of centre 89, which arrives as a
variable called "unknown". Both paths have to work.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from pipeline.config import Location, Parameter
from pipeline.reader import hourly_from_accumulated, read_point_series, to_output_units

FIXTURES = Path(__file__).parent / "fixtures"

T2M = Parameter("t2m", "CLSTEMPERATURE", 11, lambda v: v - 273.15, 1)
CLOUD = Parameter("cloud_pct", "SURFNEBUL_TOTALE", 171, lambda v: v * 100.0, None)

HOME = Location("Home", 50.110113, 14.558445)


def test_named_parameter_is_read_at_the_nearest_point():
    series = read_point_series(FIXTURES / "t2m_step0.grb", T2M, HOME)

    assert len(series) == 1
    assert series.index[0] == pd.Timestamp("2026-08-21T06:00", tz="UTC")
    # Source unit is kelvin; a late August morning near Prague.
    assert 280.0 < series.iloc[0] < 305.0


def test_locally_tabled_parameter_is_read_despite_having_no_name():
    series = read_point_series(FIXTURES / "cloud_step0.grb", CLOUD, HOME)

    assert len(series) == 1
    assert 0.0 <= series.iloc[0] <= 1.0


def test_wrong_parameter_file_is_rejected():
    mislabelled = Parameter("t2m", "CLSTEMPERATURE", 11, lambda v: v, 1)

    with pytest.raises(ValueError, match="indicatorOfParameter"):
        read_point_series(FIXTURES / "cloud_step0.grb", mislabelled, HOME)


def test_nearest_point_is_the_expected_grid_cell():
    """The grid has a 1 km step, so the chosen cell must sit within a kilometre."""
    import xarray as xr

    with xr.open_dataset(
        FIXTURES / "t2m_step0.grb", engine="cfgrib", backend_kwargs={"indexpath": ""}
    ) as dataset:
        point = dataset["t2m"].sel(
            latitude=HOME.lat, longitude=HOME.lon, method="nearest"
        )
        assert abs(float(point.latitude) - HOME.lat) < 0.009
        assert abs(float(point.longitude) - HOME.lon) < 0.014


def test_conversion_to_output_units():
    series = read_point_series(FIXTURES / "t2m_step0.grb", T2M, HOME)

    celsius = to_output_units(series, T2M)

    assert celsius.iloc[0] == pytest.approx(series.iloc[0] - 273.15, abs=0.05)
    assert -50.0 < celsius.iloc[0] < 50.0


def test_cloud_fraction_becomes_whole_percent():
    series = read_point_series(FIXTURES / "cloud_step0.grb", CLOUD, HOME)

    percent = to_output_units(series, CLOUD)

    assert percent.dtype == "int64"
    assert 0 <= percent.iloc[0] <= 100


def _accumulated(values: list[float]) -> pd.Series:
    index = pd.date_range("2026-08-21T07:00", periods=len(values), freq="h", tz="UTC")
    return pd.Series(values, index=index)


def test_hourly_totals_come_from_differencing():
    hourly = hourly_from_accumulated(_accumulated([0.5, 1.5, 4.0, 4.0]))

    assert list(hourly) == [0.5, 1.0, 2.5, 0.0]


def test_first_step_already_covers_its_hour():
    """Precipitation starts at step 1, so the first value is not a difference."""
    hourly = hourly_from_accumulated(_accumulated([2.0, 3.0]))

    assert hourly.iloc[0] == 2.0


def test_packing_noise_never_yields_negative_rain():
    hourly = hourly_from_accumulated(_accumulated([1.0, 0.9995, 1.4]))

    assert list(hourly) == [1.0, 0.0, pytest.approx(0.4005)]
    assert (hourly >= 0).all()


def test_empty_series_is_handled():
    empty = pd.Series(dtype=float, index=pd.DatetimeIndex([], tz="UTC"))

    assert hourly_from_accumulated(empty).empty
