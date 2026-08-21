"""Discovery and download of ALADIN CZ_1km files from the CHMI open data server.

The server exposes a plain nginx directory index per run hour, holding the last
three runs. A run is taken as complete once all FILES_PER_RUN files are listed.
"""

from __future__ import annotations

import bz2
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import requests

from .config import BASE_URL, FILES_PER_RUN, RUN_HOURS

FILE_RE = re.compile(r"ALADCZ1K4opendata_(\d{10})_([A-Z0-9_]+)\.grb\.bz2")

TIMEOUT = 120
CHUNK = 1 << 20


@dataclass(frozen=True)
class Run:
    """One model run, and the files it published."""

    started_at: datetime
    """Nominal run time, UTC."""

    hour_dir: int
    """Directory the run lives in, which equals its nominal hour."""

    file_parts: frozenset[str]
    """Parameter segments of the file names found for this run."""

    @property
    def run_id(self) -> str:
        return self.started_at.strftime("%Y-%m-%dT%H:%MZ")

    @property
    def stamp(self) -> str:
        return self.started_at.strftime("%Y%m%d%H")

    @property
    def is_complete(self) -> bool:
        return len(self.file_parts) >= FILES_PER_RUN

    def url_for(self, file_part: str) -> str:
        name = f"ALADCZ1K4opendata_{self.stamp}_{file_part}.grb.bz2"
        return f"{BASE_URL}/{self.hour_dir:02d}/{name}"


def parse_index(html: str, hour_dir: int) -> list[Run]:
    """Turn one directory index into the runs it lists."""
    by_stamp: dict[str, set[str]] = {}
    for stamp, part in FILE_RE.findall(html):
        by_stamp.setdefault(stamp, set()).add(part)
    runs = []
    for stamp, parts in by_stamp.items():
        started_at = datetime.strptime(stamp, "%Y%m%d%H").replace(tzinfo=timezone.utc)
        runs.append(Run(started_at, hour_dir, frozenset(parts)))
    return runs


def list_runs(session: requests.Session) -> list[Run]:
    """All runs currently on the server, newest first."""
    runs: list[Run] = []
    for hour in RUN_HOURS:
        response = session.get(f"{BASE_URL}/{hour:02d}/", timeout=TIMEOUT)
        response.raise_for_status()
        runs.extend(parse_index(response.text, hour))
    return sorted(runs, key=lambda run: run.started_at, reverse=True)


def latest_complete_run(session: requests.Session) -> Run:
    """The newest run that has published all of its files."""
    runs = list_runs(session)
    for run in runs:
        if run.is_complete:
            return run
    raise RuntimeError(f"no complete run among {len(runs)} listed")


def download(session: requests.Session, run: Run, file_part: str, target_dir: Path) -> Path:
    """Fetch one parameter file and decompress it next to the download."""
    target = target_dir / f"{run.stamp}_{file_part}.grb"
    with session.get(run.url_for(file_part), timeout=TIMEOUT, stream=True) as response:
        response.raise_for_status()
        decompressor = bz2.BZ2Decompressor()
        with target.open("wb") as out:
            for chunk in response.iter_content(CHUNK):
                out.write(decompressor.decompress(chunk))
    return target
