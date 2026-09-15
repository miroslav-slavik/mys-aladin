#!/usr/bin/env python
"""Build web/places.json: every Czech municipality with its coordinates.

The app has to answer for a place typed into it, and typing coordinates is not
what anyone wants to do. The names therefore travel with the app: the list is
small enough to bundle, and bundling keeps the search working offline and
leaves the app with no third-party call at runtime.

Source: the Geonames service of CUZK, two layers of it: the municipalities and
the parts they are divided into. Both publish standardised names as points in
WGS-84. The parts matter for the cities: Prague is a single point in the middle
of a place forty kilometres across, so without them a position anywhere in it
is named by its coordinates instead of by the quarter it is in.

Run this by hand when the list needs refreshing; it is not part of the
scheduled pipeline.

    ~/.venvs/grib/bin/python scripts/make-places.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import requests

SERVICE = "https://ags.cuzk.cz/arcgis/rest/services/GEONAMES/Geonames/MapServer/{layer}/query"

#: Layer number and the kind it carries: 0 for a municipality, 1 for a part.
LAYERS = ((0, 0), (1, 1))
PAGE = 2000
TIMEOUT = 60
OUTPUT = Path(__file__).resolve().parent.parent / "web" / "places.json"

USER_AGENT = "mys-aladin/1.0 (personal forecast; https://github.com/miroslav-slavik/mys-aladin)"

#: "Kyje; okr. Domazlice; Plzensky kraj": the municipality comes first and the
#: district follows the "okr." marker.
DISTRICT = re.compile(r"okr\.\s*([^;]+)")


def fetch_page(session: requests.Session, layer: int, offset: int) -> list[dict]:
    response = session.get(
        SERVICE.format(layer=layer),
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


def municipality(localisation: str) -> str:
    return (localisation or "").split(";")[0].strip()


def collect(session: requests.Session, layer: int, kind: int) -> list[tuple]:
    """Every feature of one layer as (name, detail, kind, lat, lon).

    The detail is what tells two places of the same name apart: for a
    municipality its district, for a part the municipality it belongs to.
    """
    found: list[tuple] = []
    offset = 0
    while True:
        features = fetch_page(session, layer, offset)
        if not features:
            break
        for feature in features:
            attributes = feature["attributes"]
            name = (attributes.get("jmeno") or "").strip()
            geometry = feature.get("geometry") or {}
            if not name or "x" not in geometry:
                continue
            localisation = attributes.get("lokalizace", "")
            parent = municipality(localisation)
            # A part named after its own municipality is that municipality for
            # every practical purpose, and the list already holds it.
            if kind and name == parent:
                continue
            detail = parent if kind else district(localisation)
            # Four decimals is about eleven metres, far finer than the two
            # kilometre grid the coordinates are looked up in.
            found.append((name, detail, kind, round(geometry["y"], 4), round(geometry["x"], 4)))
        offset += PAGE
        print(f"  layer {layer}: {offset:6d} requested, {len(found):6d} kept")
    return found


def main() -> int:
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    seen: set[tuple] = set()
    places: list[tuple] = []
    for layer, kind in LAYERS:
        for place in collect(session, layer, kind):
            key = place[:3]
            if key in seen:
                continue
            seen.add(key)
            places.append(place)

    places.sort(key=lambda place: (place[0], place[2], place[1]))

    # The details repeat by the thousand - every quarter of Prague names the
    # same city - so they live in a table and the rows hold an index into it.
    details: dict[str, int] = {}
    rows: list[list] = []
    for name, detail, kind, lat, lon in places:
        if detail not in details:
            details[detail] = len(details)
        rows.append([name, kind, details[detail], lat, lon])

    document = {
        "source": "ČÚZK, Geonames",
        "count": len(rows),
        "details": list(details),
        "places": rows,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as handle:
        json.dump(document, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    kinds = sum(1 for row in rows if row[1])
    print(
        f"wrote {OUTPUT}: {len(rows) - kinds} municipalities, {kinds} parts, "
        f"{len(details)} details, {OUTPUT.stat().st_size / 1024:.0f} kB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
