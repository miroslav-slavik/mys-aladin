"""Reading point time series out of ALADIN GRIB files.

Two properties of the source shape this module, both established in Phase 1.
Locally-tabled parameters reach cfgrib as a variable literally named
"unknown", so a field is identified by its GRIB1 indicatorOfParameter rather
than by name. Precipitation accumulates from the start of the run, so hourly
totals come from differencing.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

from .config import Location, Parameter


def _open(path: Path) -> xr.Dataset:
    return xr.open_dataset(
        path,
        engine="cfgrib",
        # An empty index path keeps cfgrib from writing .idx files beside the data.
        backend_kwargs={"indexpath": "", "read_keys": ["indicatorOfParameter"]},
    )


def _checked_variable(dataset: xr.Dataset, path: Path, parameter: Parameter) -> xr.DataArray:
    """The single field of the file, once it is proven to be the right one."""
    (variable,) = dataset.data_vars.values()
    indicator = variable.attrs.get("GRIB_indicatorOfParameter")
    if indicator != parameter.indicator:
        raise ValueError(
            f"{path.name}: expected indicatorOfParameter "
            f"{parameter.indicator}, found {indicator}"
        )
    return variable


@dataclass(frozen=True)
class Grid:
    """A field over the whole grid, in source units.

    values is indexed [hour, latitude, longitude] and its axes are the three
    arrays beside it. Latitudes run south to north, the order the source uses.
    """

    values: np.ndarray
    times: pd.DatetimeIndex
    lats: np.ndarray
    lons: np.ndarray


def read_grid(path: Path, parameter: Parameter, stride: int = 1) -> Grid:
    """One parameter over the whole grid, optionally thinned by a stride.

    Thinning happens here rather than later so that a run never holds more of
    the field in memory than it publishes.
    """
    with _open(path) as dataset:
        variable = _checked_variable(dataset, path, parameter)
        # A single-step file has no time axis at all; give it one, so callers
        # see the same shape either way.
        extra = [dim for dim in variable.dims if dim not in ("latitude", "longitude")]
        variable = variable.transpose(*extra, "latitude", "longitude")
        values = np.asarray(variable.values, dtype="float32")
        if values.ndim == 2:
            values = values[np.newaxis, :, :]
        times = pd.to_datetime(np.atleast_1d(variable.valid_time.values), utc=True)
        lats = np.asarray(variable.latitude.values, dtype=float)
        lons = np.asarray(variable.longitude.values, dtype=float)

    order = np.argsort(times.values)
    values, times = values[order], times[order]
    if stride > 1:
        values = values[:, ::stride, ::stride]
        lats, lons = lats[::stride], lons[::stride]
    return Grid(np.ascontiguousarray(values), times, lats, lons)


def hourly_grid_from_accumulated(values: np.ndarray) -> np.ndarray:
    """Per-hour totals over a whole grid, the field-wide twin of the series
    version above: the first step already covers its hour, the rest are
    differences, and packing noise below the meaningful resolution is clipped.
    """
    hourly = np.empty_like(values)
    hourly[0] = values[0]
    hourly[1:] = values[1:] - values[:-1]
    return np.clip(hourly, 0.0, None)


def read_point_series(path: Path, parameter: Parameter, location: Location) -> pd.Series:
    """Values of one parameter at the grid point nearest to a location.

    The result is indexed by valid time and still carries source units.
    """
    with _open(path) as dataset:
        variable = _checked_variable(dataset, path, parameter)
        point = variable.sel(
            latitude=location.lat, longitude=location.lon, method="nearest"
        )
        values = np.atleast_1d(np.asarray(point.values, dtype=float))
        times = pd.to_datetime(np.atleast_1d(point.valid_time.values), utc=True)
    return pd.Series(values, index=times).sort_index()


def hourly_from_accumulated(series: pd.Series) -> pd.Series:
    """Per-hour totals from a series accumulated since the start of the run.

    The first step already covers the first hour, so it is kept as is. Negative
    differences occur in about a tenth of the grid because of GRIB packing
    noise, far below the resolution that carries meaning, and are clipped away.
    """
    hourly = series.diff()
    if len(series):
        hourly.iloc[0] = series.iloc[0]
    return hourly.clip(lower=0.0)


def to_output_units(series: pd.Series, parameter: Parameter) -> pd.Series:
    """Convert to the units of data/forecast.json and round for publication."""
    if parameter.accumulated:
        series = hourly_from_accumulated(series)
    converted = series.map(parameter.convert)
    if parameter.decimals is None:
        return converted.round().astype("int64")
    return converted.round(parameter.decimals)
