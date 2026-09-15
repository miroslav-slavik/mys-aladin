"""Checks over the files of the app that a person would otherwise have to do.

The app is plain files with no build step, which is the point, but it leaves a
few facts written down in two places. These tests hold those pairs together.
"""

from __future__ import annotations

import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"

CACHE = re.compile(r'const CACHE = "mys-aladin-(v\d+)"')
APP_VERSION = re.compile(r'const APP_VERSION = "(v\d+)"')


def read(name: str) -> str:
    return (WEB / name).read_text(encoding="utf-8")


def test_the_version_in_the_footer_is_the_version_of_the_cache():
    """Otherwise the footer would report a build that is not what shipped."""
    worker = CACHE.search(read("sw.js"))
    app = APP_VERSION.search(read("app.js"))

    assert worker and app, "both versions have to be findable"
    assert app.group(1) == worker.group(1)


def test_every_shell_file_the_worker_precaches_exists():
    shell = re.search(r"const SHELL = \[(.*?)\];", read("sw.js"), re.S)
    assert shell

    for name in re.findall(r'"([^"]+)"', shell.group(1)):
        if name == "./":
            continue
        assert (WEB / name).is_file(), f"{name} is precached but not in web/"


def test_the_page_loads_the_scripts_it_needs():
    page = read("index.html")

    for name in ("area.js", "app.js", "style.css"):
        assert name in page, f"{name} is not referenced from index.html"
    # area.js defines what app.js calls, so it has to come first.
    assert page.index("area.js") < page.index("app.js")
