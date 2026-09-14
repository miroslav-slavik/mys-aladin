#!/usr/bin/env python
"""Build web/places.json: every Czech municipality with its coordinates.

The app has to answer for a place typed into it, and typing coordinates is not
what anyone wants to do. The names therefore travel with the app: the list is
small enough to bundle, and bundling keeps the search working offline and
leaves the app with no third-party call at runtime.

Source: the Geonames service of CUZK, layer "Mesta, obce", which publishes
standardised names as points in WGS-84. Run this by hand when the list needs
refreshing; it is not part of the scheduled pipeline.

    ~/.venvs/grib/bin/python scripts/make-places.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import requests

SERVICE = (
    "https://ags.cuzk.cz/arcgis/rest/services/GEONAMES/Geonames/MapServer/0/query"
)
PAGE = 2000
TIMEOUT = 60
OUTPUT = Path(__file__).resolve().parent.parent / "web" / "places.json"

USER_AGENT = "mys-aladin/1.0 (personal forecast; https://github.com/miroslav-slavik/mys-aladin)"

#: "Kyje; okr. Domazlice; Plzensky kraj" - the district is the middle part.
DISTRICT = re.compile(r"okr\.\s*([^;]+)")


def fetch_page(session: requests.Session, offset: int) -> list[dict]:
    response = session.get(
        SERVICE,
        params={
            "where": "1=1",
            "outFields": "jmeno,lokalizace",
            "returnGeometry": "true",
            "outSR": "4326",
            "orderByFields": "OBJECTID",
            "resultOffset": offset,
            "resultRecordCount": PAGE,
            "f": "json",
        },
        timeout=TIMEOUT,
    )
    response.raise_for_status()
    payload = response.json()
    if "error" in payload:
        raise SystemExit(f"service refused the query: {payload['error']}")
    return payload.get("features", [])


def district(localisation: str) -> str:
    found = DISTRICT.search(localisation or "")
    return found.group(1).strip() if found else ""


def main() -> int:
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    rows: list[list] = []
    seen: set[tuple] = set()
    offset = 0
    while True:
        features = fetch_page(session, offset)
        if not features:
            break
        for feature in features:
            name = (feature["attributes"].get("jmeno") or "").strip()
            geometry = feature.get("geometry") or {}
            if not name or "x" not in geometry:
                continue
            row = (name, district(feature["attributes"].get("lokalizace", "")))
            if row in seen:
                continue
            seen.add(row)
            # Four decimals is about eleven metres, far finer than the two
            # kilometre grid the coordinates are looked up in.
            rows.append([row[0], row[1], round(geometry["y"], 4), round(geometry["x"], 4)])
        offset += PAGE
        print(f"{offset:5d} requested, {len(rows):5d} kept")

    rows.sort(key=lambda row: (row[0], row[1]))
    document = {
        "source": "ČÚZK, Geonames",
        "count": len(rows),
        "places": rows,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as handle:
        json.dump(document, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    print(f"wrote {OUTPUT} with {len(rows)} places, {OUTPUT.stat().st_size / 1024:.0f} kB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
