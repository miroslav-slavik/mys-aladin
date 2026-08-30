"""Assembly of the published JSON."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd
import pytest

from pipeline.build import build_forecast, build_series, read_run_id, write_forecast
from pipeline.config import Location

HOME = Location("Home", 50.110113, 14.558445, label="Kyje, Praha 9")


def series(values: list[float], start: str = "2026-08-21T07:00", periods: int | None = None):
    index = pd.date_range(start, periods=periods or len(values), freq="h", tz="UTC")
    return pd.Series(values, index=index)


def by_field(hours: int = 3) -> dict[str, pd.Series]:
    return {
        "t2m": series([19.7, 20.8, 22.0][:hours]),
        "precip_mm": series([0.0, 0.1, 0.0][:hours]),
        "cloud_pct": series([48, 48, 68][:hours]).astype("int64"),
        "wind_ms": series([1.0, 1.3, 1.3][:hours]),
        "wind_dir": series([184, 156, 151][:hours]).astype("int64"),
    }


def test_rows_carry_every_field_at_each_time():
    rows = build_series(by_field())

    assert len(rows) == 3
    assert rows[0] == {
        "time": "2026-08-21T07:00Z",
        "t2m": 19.7,
        "precip_mm": 0.0,
        "cloud_pct": 48,
        "wind_ms": 1.0,
        "wind_dir": 184,
    }


def test_field_types_follow_the_parameter_not_the_value():
    """A round temperature stays a float; a percentage stays an integer."""
    fields = by_field()
    fields["t2m"] = series([25.0, 20.8, 22.0])

    row = build_series(fields)[0]

    assert isinstance(row["t2m"], float)
    assert isinstance(row["wind_ms"], float)
    assert isinstance(row["cloud_pct"], int)
    assert isinstance(row["wind_dir"], int)


def test_times_are_utc_with_the_z_suffix():
    rows = build_series(by_field())

    assert all(row["time"].endswith("Z") for row in rows)
    assert [row["time"] for row in rows] == [
        "2026-08-21T07:00Z",
        "2026-08-21T08:00Z",
        "2026-08-21T09:00Z",
    ]


def test_analysis_step_is_dropped_because_precipitation_starts_later():
    """Instantaneous fields begin an hour before precipitation does."""
    fields = by_field()
    for name in ("t2m", "cloud_pct", "wind_ms", "wind_dir"):
        fields[name] = series([0.0] + list(fields[name]), start="2026-08-21T06:00")

    rows = build_series(fields)

    assert [row["time"] for row in rows][0] == "2026-08-21T07:00Z"
    assert len(rows) == 3


def test_forecast_matches_the_documented_schema():
    forecast = build_forecast(
        "2026-08-21T06:00Z",
        {HOME: by_field()},
        generated_at=datetime(2026, 8, 21, 11, 5, 12, tzinfo=timezone.utc),
    )

    assert forecast["run_id"] == "2026-08-21T06:00Z"
    assert forecast["generated_at"] == "2026-08-21T11:05:12Z"
    (location,) = forecast["locations"]
    assert location["name"] == "Home"
    assert location["lat"] == pytest.approx(50.110113)
    assert location["lon"] == pytest.approx(14.558445)
    assert len(location["series"]) == 3


def test_location_carries_a_display_label():
    forecast = build_forecast("2026-08-21T06:00Z", {HOME: by_field()})

    assert forecast["locations"][0]["label"] == "Kyje, Praha 9"
    assert forecast["locations"][0]["name"] == "Home"


def test_label_falls_back_to_the_name():
    unlabelled = Location("Chata", 49.5, 15.5)

    forecast = build_forecast("2026-08-21T06:00Z", {unlabelled: by_field()})

    assert forecast["locations"][0]["label"] == "Chata"


def test_written_file_round_trips(tmp_path):
    path = tmp_path / "data" / "forecast.json"
    forecast = build_forecast("2026-08-21T06:00Z", {HOME: by_field()})

    write_forecast(path, forecast)

    assert json.loads(path.read_text(encoding="utf-8")) == forecast
    assert read_run_id(path) == "2026-08-21T06:00Z"


def test_no_temporary_file_is_left_behind(tmp_path):
    path = tmp_path / "forecast.json"

    write_forecast(path, build_forecast("2026-08-21T06:00Z", {HOME: by_field()}))

    assert [p.name for p in tmp_path.iterdir()] == ["forecast.json"]


def test_missing_or_broken_output_reports_no_run(tmp_path):
    missing = tmp_path / "absent.json"
    broken = tmp_path / "broken.json"
    broken.write_text("{ not json", encoding="utf-8")

    assert read_run_id(missing) is None
    assert read_run_id(broken) is None
