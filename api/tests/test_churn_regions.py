"""Region folding in the churn importer (no database needed)."""
from app.modules.churn.importer import _region_key


def test_known_codes_pass_through():
    assert _region_key("BA") == "BA"
    assert _region_key("la") == "LA"
    assert _region_key("Sacramento") == "SACRAMENTO"
    assert _region_key("Central Valley") == "CENTRAL VALLEY"


def test_bay_area_cities_and_counties_fold_into_ba():
    for v in ("SF", "SJ", "San Francisco", "Santa Clara County", "SR", "Vallejo", "Bay Area"):
        assert _region_key(v) == "BA", v


def test_state_code_falls_back_to_the_sheet():
    assert _region_key("CA", "LA (Deployed - Closed)") == "LA"
    assert _region_key("CA", "BA (Deployed - Closed - 60/90 Days Follow Up)") == "BA"
    assert _region_key("", "NY churn") == "NY"
    # No usable sheet name: the state code is dropped rather than kept as a region.
    assert _region_key("CA") == ""
    assert _region_key("CA", "Data Jan- Sep with MRR") == ""


def test_empty_stays_empty():
    assert _region_key(None) == ""
    assert _region_key("  ") == ""
