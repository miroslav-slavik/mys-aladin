"""Discovery of runs from the directory index."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from pipeline.config import FILES_PER_RUN
from pipeline.source import Run, parse_index

PARTS = [f"PART{i:02d}" for i in range(FILES_PER_RUN)]


def index_html(stamp: str, parts: list[str]) -> str:
    rows = "".join(
        f'<a href="ALADCZ1K4opendata_{stamp}_{part}.grb.bz2">'
        f"ALADCZ1K4opendata_{stamp}_{part}.grb.bz2</a> 21-Aug-2026 10:26 12345\n"
        for part in parts
    )
    return f"<html><body><pre>{rows}</pre></body></html>"


def test_index_yields_one_run_with_its_files():
    (run,) = parse_index(index_html("2026082106", PARTS), hour_dir=6)

    assert run.started_at == datetime(2026, 8, 21, 6, tzinfo=timezone.utc)
    assert run.run_id == "2026-08-21T06:00Z"
    assert len(run.file_parts) == FILES_PER_RUN
    assert run.is_complete


def test_several_runs_in_one_directory_are_kept_apart():
    html = index_html("2026082006", PARTS) + index_html("2026082106", PARTS)

    runs = sorted(parse_index(html, hour_dir=6), key=lambda run: run.started_at)

    assert [run.stamp for run in runs] == ["2026082006", "2026082106"]


def test_partial_run_is_not_complete():
    (run,) = parse_index(index_html("2026082106", PARTS[:-1]), hour_dir=6)

    assert not run.is_complete


def test_unrelated_files_are_ignored():
    html = index_html("2026082106", PARTS) + '<a href="Popis_obsahu.xlsx">x</a>'

    (run,) = parse_index(html, hour_dir=6)

    assert len(run.file_parts) == FILES_PER_RUN


def test_url_points_at_the_run_directory():
    run = Run(datetime(2026, 8, 21, 6, tzinfo=timezone.utc), 6, frozenset(PARTS))

    url = run.url_for("CLSTEMPERATURE")

    assert url.endswith("/06/ALADCZ1K4opendata_2026082106_CLSTEMPERATURE.grb.bz2")


@pytest.mark.parametrize("hour", [0, 6, 12, 18])
def test_midnight_run_keeps_its_own_hour(hour: int):
    (run,) = parse_index(index_html(f"20260821{hour:02d}", PARTS), hour_dir=hour)

    assert run.started_at.hour == hour
    assert f"/{hour:02d}/" in run.url_for("CLSTEMPERATURE")
