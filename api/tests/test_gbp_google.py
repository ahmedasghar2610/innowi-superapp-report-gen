"""Google Business Profile client: parsers, OAuth URL and state (no network, no DB)."""
from __future__ import annotations

import datetime as dt
from urllib.parse import parse_qs, urlparse

from app.modules.gbp import google


def test_authorize_url_asks_for_offline_business_manage():
    url = google.authorize_url("cid.apps.googleusercontent.com", "http://localhost:3000/api/v1/integrations/gbp/callback", "st")
    q = parse_qs(urlparse(url).query)
    assert q["client_id"] == ["cid.apps.googleusercontent.com"]
    assert q["redirect_uri"] == ["http://localhost:3000/api/v1/integrations/gbp/callback"]
    assert "https://www.googleapis.com/auth/business.manage" in q["scope"][0]
    assert q["access_type"] == ["offline"] and q["prompt"] == ["consent"] and q["state"] == ["st"]


def test_state_round_trip_and_not_an_access_token():
    import jwt as pyjwt
    import pytest

    from app.common.security.jwt import decode_access_token
    from app.modules.gbp import connection

    state = connection.make_state("user-1")
    assert connection.read_state(state) == "user-1"
    assert connection.read_state(state + "x") is None
    assert connection.read_state("garbage") is None
    # A state seen in a URL can never be replayed as a bearer token.
    with pytest.raises(pyjwt.PyJWTError):
        decode_access_token(state)


def _dv(y, m, d, v=None):
    out = {"date": {"year": y, "month": m, "day": d}}
    if v is not None:
        out["value"] = str(v)
    return out


def test_daily_metrics_zero_days_kept_trailing_unprocessed_days_dropped():
    body = {
        "multiDailyMetricTimeSeries": [
            {
                "dailyMetricTimeSeries": [
                    {
                        "dailyMetric": "CALL_CLICKS",
                        "timeSeries": {"datedValues": [_dv(2026, 9, 1, 3), _dv(2026, 9, 2), _dv(2026, 9, 3, 1), _dv(2026, 9, 4), _dv(2026, 9, 5)]},
                    },
                    {
                        "dailyMetric": "WEBSITE_CLICKS",
                        "timeSeries": {"datedValues": [_dv(2026, 9, 1), _dv(2026, 9, 2, 7), _dv(2026, 9, 3), _dv(2026, 9, 4), _dv(2026, 9, 5)]},
                    },
                    {"dailyMetric": "SOMETHING_NEW", "timeSeries": {"datedValues": [_dv(2026, 9, 5, 99)]}},
                ]
            }
        ]
    }
    days = google.parse_daily_metrics(body)
    assert sorted(days) == [dt.date(2026, 9, 1), dt.date(2026, 9, 2), dt.date(2026, 9, 3)]  # 4th/5th: not processed yet
    assert days[dt.date(2026, 9, 2)]["call_clicks"] == 0  # a real zero in the middle
    assert days[dt.date(2026, 9, 2)]["website_clicks"] == 7
    assert days[dt.date(2026, 9, 1)]["menu_clicks"] == 0  # metric not returned at all → 0
    assert google.parse_daily_metrics({}) == {}


def test_parse_location():
    raw = {
        "name": "locations/123",
        "title": "Zyka Indian Fusion",
        "storeCode": "10715684292312556419",
        "phoneNumbers": {"primaryPhone": "(510) 555-0100"},
        "categories": {"primaryCategory": {"displayName": "Indian restaurant"}, "additionalCategories": [{"displayName": "Halal restaurant"}]},
        "storefrontAddress": {"addressLines": ["47890 Warm Springs Blvd"], "locality": "Fremont", "administrativeArea": "CA", "postalCode": "94539", "regionCode": "US"},
        "websiteUri": "https://zyka.example",
        "regularHours": {"periods": [{"openDay": "MONDAY", "openTime": {"hours": 11}, "closeDay": "MONDAY", "closeTime": {"hours": 22, "minutes": 30}}]},
        "profile": {"description": "Family-owned."},
        "openInfo": {"status": "OPEN"},
        "metadata": {"mapsUri": "https://maps.google.com/?cid=1", "placeId": "ChIJ"},
        "latlng": {"latitude": 37.5, "longitude": -121.9},
    }
    p = google.parse_location(raw, "accounts/9")
    assert p["google_location_id"] == "locations/123" and p["google_account_id"] == "accounts/9"
    assert p["address_line"] == "47890 Warm Springs Blvd" and p["city"] == "Fremont" and p["postal_code"] == "94539"
    assert p["primary_category"] == "Indian restaurant" and p["additional_categories"] == ["Halal restaurant"]
    assert p["regular_hours"] == [{"day": "MONDAY", "open": "11:00", "close": "22:30", "closeDay": "MONDAY"}]
    assert p["phone"] == "(510) 555-0100" and p["maps_uri"].startswith("https://maps")
    assert google.parse_location({"name": "locations/1", "openInfo": {"status": "OPEN_FOR_BUSINESS_UNSPECIFIED"}}, "a")["open_status"] == "UNKNOWN"


def test_parse_attributes_media_verification():
    a = google.parse_attributes(
        [
            {"name": "attributes/url_menu", "uriValues": [{"uri": "https://x/menu"}]},
            {"name": "attributes/url_order_ahead", "uriValues": [{"uri": "https://x/order"}]},
            {"name": "attributes/url_instagram", "uriValues": [{"uri": "https://instagram.com/x"}]},
            {"name": "attributes/has_wheelchair_accessible_entrance", "values": [True]},
        ]
    )
    assert a == {"menu_url": "https://x/menu", "ordering_url": "https://x/order", "social_links": ["https://instagram.com/x"], "attribute_count": 4}
    m = google.parse_media({"mediaItems": [{"locationAssociation": {"category": "LOGO"}}, {"locationAssociation": {"category": "COVER"}}], "totalMediaItemCount": 31})
    assert m == {"photo_count": 31, "has_logo": True, "has_cover": True}
    assert google.parse_verification({"hasVoiceOfMerchant": True}) == "verified"
    assert google.parse_verification({"waitForVoiceOfMerchant": {}}) == "pending"
    assert google.parse_verification({"verify": {"hasPendingVerification": False}}) == "required"
    assert google.parse_verification({}) == "unknown"


def test_parse_keywords_reviews_posts():
    kws = google.parse_keywords(
        [{"searchKeyword": "biryani near me", "insightsValue": {"value": "120"}}, {"searchKeyword": "nihari", "insightsValue": {"threshold": "15"}}, {"searchKeyword": " "}]
    )
    assert kws == [
        {"keyword": "biryani near me", "impressions": 120, "threshold": None},
        {"keyword": "nihari", "impressions": None, "threshold": 15},
    ]
    rv = google.parse_review(
        {"name": "accounts/1/locations/2/reviews/abc", "starRating": "FOUR", "comment": "Good", "reviewer": {"displayName": "Ali"},
         "createTime": "2026-09-01T10:00:00Z", "updateTime": "2026-09-02T10:00:00Z", "reviewReply": {"comment": "Thanks!", "updateTime": "2026-09-03T00:00:00Z"}}
    )
    assert rv["star_rating"] == 4 and rv["has_reply"] is True and rv["reviewer_name"] == "Ali"
    assert rv["create_time"] == dt.datetime(2026, 9, 1, 10, tzinfo=dt.timezone.utc)
    assert google.parse_review({"name": "x"}) is None
    post = google.parse_post(
        {"name": "accounts/1/locations/2/localPosts/9", "topicType": "OFFER", "summary": "10% off\nall week", "state": "LIVE",
         "createTime": "2026-09-01T00:00:00Z", "event": {"title": "Family deal", "schedule": {"startDate": {"year": 2026, "month": 9, "day": 1}, "endDate": {"year": 2026, "month": 9, "day": 30}}},
         "offer": {"couponCode": "FAM10"}}
    )
    assert post["topic_type"] == "OFFER" and post["title"] == "Family deal" and post["coupon_code"] == "FAM10"
    assert post["end_date"] == dt.date(2026, 9, 30)


def test_profile_completion_is_a_plain_count():
    from types import SimpleNamespace

    from app.modules.gbp import profile

    loc = SimpleNamespace(
        title="X", address_line="1 Main", city="Fremont", phone="1", website_url="w", primary_category="c", additional_categories=[],
        regular_hours=[{"day": "MONDAY"}], attribute_count=0, description="", menu_url=None, ordering_url=None, social_links=[],
        photo_count=3, has_logo=True, has_cover=False,
    )
    fields = profile.compute(loc)
    assert len(fields) == 14
    done = {f["key"] for f in fields if f["done"]}
    assert done == {"name", "address", "phone", "website", "primaryCategory", "hours", "photos"}
    assert profile.pct(fields) == 50


def test_friendly_errors():
    assert "quota" in google.api_friendly(429, {}).lower()
    assert "isn't enabled" in google.api_friendly(403, {"error": {"message": "My Business API has not been used in project 1 before or it is disabled."}})
    assert "Connect again" in google.api_friendly(401, {})


def test_daily_schedule_slots():
    import datetime as dt

    from app.modules.gbp import scheduler

    utc = dt.timezone.utc
    # 06:00 Asia/Karachi = 01:00 UTC
    now = dt.datetime(2026, 10, 6, 3, 0, tzinfo=utc)  # 08:00 Karachi
    assert scheduler.last_slot(now, 6, "Asia/Karachi") == dt.datetime(2026, 10, 6, 1, 0, tzinfo=utc)
    assert scheduler.next_slot(now, 6, "Asia/Karachi") == dt.datetime(2026, 10, 7, 1, 0, tzinfo=utc)
    assert scheduler.is_due(now, None, 6, "Asia/Karachi")
    assert scheduler.is_due(now, dt.datetime(2026, 10, 5, 23, 0, tzinfo=utc), 6, "Asia/Karachi")  # ran before today's slot
    assert not scheduler.is_due(now, dt.datetime(2026, 10, 6, 2, 0, tzinfo=utc), 6, "Asia/Karachi")  # already ran today
    early = dt.datetime(2026, 10, 6, 0, 30, tzinfo=utc)  # 05:30 Karachi → yesterday's slot counts
    assert not scheduler.is_due(early, dt.datetime(2026, 10, 5, 4, 0, tzinfo=utc), 6, "Asia/Karachi")
