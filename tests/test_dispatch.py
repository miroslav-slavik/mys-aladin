"""The Cloudflare dispatcher repeats a few facts of the pipeline in JavaScript.

It cannot import them, so these tests keep the two copies from drifting apart.
"""

from __future__ import annotations

import re
from pathlib import Path

from pipeline.config import BASE_URL, FILES_PER_RUN, RUN_HOURS
from pipeline.source import FILE_RE

DISPATCH = Path(__file__).resolve().parent.parent / "cloudflare" / "dispatch"
SOURCE = (DISPATCH / "src" / "index.js").read_text(encoding="utf-8")
WRANGLER = (DISPATCH / "wrangler.toml").read_text(encoding="utf-8")


def test_completeness_rule_matches():
    (value,) = re.findall(r"export const FILES_PER_RUN = (\d+);", SOURCE)

    assert int(value) == FILES_PER_RUN


def test_file_pattern_matches():
    (pattern,) = re.findall(r"const FILE_RE = /(.+)/g;", SOURCE)

    assert pattern == FILE_RE.pattern


def test_run_step_matches_the_run_hours():
    (hours,) = re.findall(r"export const RUN_STEP = (\d+) \* HOUR;", SOURCE)
    steps = {(b - a) % 24 for a, b in zip(RUN_HOURS, RUN_HOURS[1:] + RUN_HOURS[:1])}

    assert steps == {int(hours)}


def test_source_url_matches():
    (url,) = re.findall(r'^SOURCE_URL = "(.+)"$', WRANGLER, flags=re.MULTILINE)

    assert url == BASE_URL
