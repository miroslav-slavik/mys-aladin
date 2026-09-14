"""Tests of the place files.

Anyone can add a place by writing a file, and the app offers to write one, so
the loader has to be strict about what it accepts and forgiving about what it
finds beside it: one bad file cannot be allowed to cost the forecast for every
other place.
"""

from __future__ import annotations

import json

import pytest

from pipeline.config import PLACES_DIR, Places, load_places, parse_place


def write(directory, name: str, document) -> None:
    path = directory / f"{name}.json"
    path.write_text(
        document if isinstance(document, str) else json.dumps(document),
        encoding="utf-8",
    )


def test_the_repository_ships_a_home_place():
    places = load_places()

    assert places.problems == ()
    assert places.locations[0].name == "Home"
    assert places.locations[0].label == "Kyje, Praha 9"


def test_a_place_is_read_with_its_label(tmp_path):
    write(tmp_path, "chata", {"name": "chata", "label": "Pec pod Sněžkou", "lat": 50.6935, "lon": 15.7332})

    places = load_places(tmp_path)

    assert places.problems == ()
    assert places.locations == (
        type(places.locations[0])("chata", 50.6935, 15.7332, "Pec pod Sněžkou"),
    )


def test_the_file_name_stands_in_for_a_missing_name(tmp_path):
    write(tmp_path, "beroun", {"lat": 49.9639, "lon": 14.0721})

    (place,) = load_places(tmp_path).locations

    assert place.name == "beroun"
    assert place.label == ""


def test_home_comes_first_whatever_else_is_there(tmp_path):
    write(tmp_path, "aaa", {"lat": 49.0, "lon": 15.0})
    write(tmp_path, "home", {"lat": 50.1, "lon": 14.5})
    write(tmp_path, "zzz", {"lat": 49.5, "lon": 16.0})

    names = [place.name for place in load_places(tmp_path).locations]

    assert names == ["home", "aaa", "zzz"]


@pytest.mark.parametrize(
    "document, expected",
    [
        ({"lat": 50.1}, "missing lon"),
        ({"lat": "50.1", "lon": 14.5}, "lat is not a number"),
        ({"lat": 50.1, "lon": 14.5, "long": 14.5}, "unknown keys: long"),
        ({"lat": 60.0, "lon": 14.5}, "outside the CZ_1km grid"),
        ({"name": "  ", "lat": 50.1, "lon": 14.5}, "name is empty"),
        ([50.1, 14.5], "expected an object"),
    ],
)
def test_a_bad_place_is_named_in_the_problem(document, expected):
    with pytest.raises(ValueError, match=expected):
        parse_place(document, "somewhere")


def test_a_broken_file_is_skipped_and_the_rest_survives(tmp_path):
    write(tmp_path, "home", {"lat": 50.1, "lon": 14.5})
    write(tmp_path, "typo", "{ this is not json")
    write(tmp_path, "faraway", {"lat": 60.0, "lon": 14.5})

    places = load_places(tmp_path)

    assert [place.name for place in places.locations] == ["home"]
    assert len(places.problems) == 2
    assert any("typo.json" in problem for problem in places.problems)
    assert any("faraway.json: 60.0" in problem for problem in places.problems)


def test_two_files_cannot_claim_the_same_name(tmp_path):
    write(tmp_path, "one", {"name": "chata", "lat": 50.1, "lon": 14.5})
    write(tmp_path, "two", {"name": "chata", "lat": 49.1, "lon": 15.5})

    places = load_places(tmp_path)

    assert len(places.locations) == 1
    assert "already taken" in places.problems[0]


def test_a_missing_directory_is_a_problem_not_a_crash(tmp_path):
    places = load_places(tmp_path / "nowhere")

    assert places.locations == ()
    assert "not a directory" in places.problems[0]


def test_places_directory_of_the_repository_is_where_the_app_points_people():
    assert PLACES_DIR.name == "places"
    assert (PLACES_DIR / "home.json").is_file()
    assert isinstance(load_places(), Places)
