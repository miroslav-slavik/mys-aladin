"""Assembly of data/forecast.json from per-parameter point series."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .config import Location, Parameter


def _format_time(moment: pd.Timestamp) -> str:
    return moment.tz_convert("UTC").strftime("%Y-%m-%dT%H:%MZ")


def build_series(by_field: dict[str, pd.Series]) -> list[dict]:
    """Merge per-parameter series into one row per valid time.

    Only times present in every parameter are emitted. That drops the analysis
    step on its own: precipitation starts an hour later than the instantaneous
    fields, because an accumulation over a zero-length interval has no meaning.
    """
    # Whole-number fields are typed from the series, not from the value, so a
    # temperature of exactly 25 stays 25.0 rather than turning into an integer.
    whole = {
        field: pd.api.types.is_integer_dtype(series)
        for field, series in by_field.items()
    }
    frame = pd.DataFrame(by_field).dropna(how="any").sort_index()
    rows = []
    for moment, values in frame.iterrows():
        row = {"time": _format_time(moment)}
        for field in by_field:
            value = values[field]
            row[field] = int(value) if whole[field] else float(value)
        rows.append(row)
    return rows


def build_forecast(
    run_id: str,
    series_by_location: dict[Location, dict[str, pd.Series]],
    generated_at: datetime | None = None,
) -> dict:
    moment = generated_at or datetime.now(timezone.utc)
    return {
        "run_id": run_id,
        "generated_at": moment.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "locations": [
            {
                "name": location.name,
                "lat": location.lat,
                "lon": location.lon,
                "series": build_series(by_field),
            }
            for location, by_field in series_by_location.items()
        ],
    }


def read_run_id(path: Path) -> str | None:
    """Run already published to data/forecast.json, if any."""
    if not path.exists():
        return None
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle).get("run_id")
    except (json.JSONDecodeError, OSError):
        return None


def write_forecast(path: Path, forecast: dict) -> None:
    """Write the forecast, replacing the file only once it is fully written."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(forecast, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temporary.replace(path)


def field_names(parameters: tuple[Parameter, ...]) -> list[str]:
    return [parameter.field for parameter in parameters]
