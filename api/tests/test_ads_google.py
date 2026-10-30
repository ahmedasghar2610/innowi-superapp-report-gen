"""Google Ads REST response parsers (modules/ads/google.py) — no network."""
from __future__ import annotations

import datetime as dt

from app.modules.ads import google


def test_parse_clients_skips_managers_and_hidden():
    rows = [
        {"customerClient": {"id": "2840308978", "descriptiveName": "Casa Villa", "manager": False, "status": "ENABLED", "currencyCode": "USD", "timeZone": "America/Los_Angeles"}},
        {"customerClient": {"id": "1316498631", "descriptiveName": "Innowi MCC", "manager": True}},
        {"customerClient": {"id": "1111111111", "descriptiveName": "Old", "manager": False, "hidden": True}},
    ]
    out = google.parse_clients(rows)
    assert [c["customer_id"] for c in out] == ["2840308978"]
    assert out[0]["name"] == "Casa Villa" and out[0]["currency_code"] == "USD"


def test_parse_campaigns_and_dates():
    rows = [{"campaign": {"id": "11", "name": "Casa Villa - PMAX", "status": "ENABLED", "advertisingChannelType": "PERFORMANCE_MAX"}, "campaignBudget": {"amountMicros": "25000000"}}]
    c = google.parse_campaigns(rows)["11"]
    assert c == {"name": "Casa Villa - PMAX", "status": "ENABLED", "channel_type": "PERFORMANCE_MAX", "daily_budget": 25.0}
    new = google.parse_campaign_dates([{"campaign": {"id": "11", "startDateTime": "2025-10-01 00:00:00", "endDateTime": "2037-12-30 23:59:59"}}])
    assert new["11"] == {"start_date": dt.date(2025, 10, 1), "end_date": None}
    old = google.parse_campaign_dates([{"campaign": {"id": "11", "startDate": "2025-10-01", "endDate": "2026-12-31"}}])
    assert old["11"]["end_date"] == dt.date(2026, 12, 31)


def test_parse_daily_keeps_fractions_and_converts_micros():
    rows = [
        {
            "campaign": {"id": "11", "name": "Casa Villa - PMAX", "status": "ENABLED"},
            "segments": {"date": "2026-09-03"},
            "metrics": {
                "costMicros": "3290000",
                "impressions": "2024",
                "clicks": "71",
                "allConversionsFromLocationAssetClickToCall": 1.0,
                "allConversionsFromLocationAssetDirections": 41.5,
                "allConversionsFromLocationAssetWebsite": 2,
                "allConversionsFromLocationAssetOrder": 0.4,
                "allConversionsFromLocationAssetMenu": 5,
            },
        },
        {"campaign": {"id": "12"}, "segments": {}, "metrics": {}},  # no date → skipped
    ]
    out = google.parse_daily(rows)
    assert len(out) == 1
    d = out[0]
    assert d["date"] == dt.date(2026, 9, 3) and d["cost"] == 3.29 and d["impressions"] == 2024 and d["clicks"] == 71
    assert (d["calls"], d["directions"], d["website"], d["orders"], d["menu"]) == (1.0, 41.5, 2.0, 0.4, 5.0)


def test_q_daily_uses_the_n8n_metrics():
    q = google.q_daily(dt.date(2026, 9, 1), dt.date(2026, 9, 30))
    for m in ("metrics.cost_micros", "metrics.impressions", "metrics.all_conversions_from_location_asset_order", "segments.date"):
        assert m in q
    assert "BETWEEN '2026-09-01' AND '2026-09-30'" in q


def test_parse_assets():
    rows = [
        {"assetGroup": {"campaign": "customers/1/campaigns/11"}, "assetGroupAsset": {"fieldType": "HEADLINE", "status": "ENABLED"}, "asset": {"id": "5", "type": "TEXT", "textAsset": {"text": "Order Online Today"}}},
        {"assetGroup": {"campaign": "customers/1/campaigns/11"}, "assetGroupAsset": {"fieldType": "HEADLINE", "status": "ENABLED"}, "asset": {"id": "5", "type": "TEXT", "textAsset": {"text": "Order Online Today"}}},
        {"assetGroup": {"campaign": "customers/1/campaigns/11"}, "assetGroupAsset": {"fieldType": "SQUARE_MARKETING_IMAGE"}, "asset": {"id": "6", "type": "IMAGE", "imageAsset": {"fullSize": {"url": "https://x/y.jpg", "widthPixels": 1200, "heightPixels": 1200}}}},
        {"assetGroup": {"campaign": "customers/1/campaigns/11"}, "assetGroupAsset": {"fieldType": "LOGO"}, "asset": {"id": "7", "type": "IMAGE"}},
        {"assetGroup": {"campaign": "customers/1/campaigns/11"}, "assetGroupAsset": {"fieldType": "YOUTUBE_VIDEO"}, "asset": {"id": "8", "type": "YOUTUBE_VIDEO", "youtubeVideoAsset": {"youtubeVideoId": "abc"}}},
    ]
    out = google.parse_asset_group_assets(rows)
    assert [(a["google_campaign_id"], a["kind"]) for a in out] == [("11", "text"), ("11", "image"), ("11", "logo"), ("11", "video")]
    assert out[1]["width"] == 1200 and out[3]["details"] == {"youtubeId": "abc"}

    ext = [
        {"campaign": {"id": "11"}, "campaignAsset": {"fieldType": "SITELINK", "status": "PAUSED"}, "asset": {"id": "9", "finalUrls": ["https://x/menu"], "sitelinkAsset": {"linkText": "View Menu", "description1": "See our menu"}}},
        {"campaign": {"id": "11"}, "campaignAsset": {"fieldType": "PROMOTION", "status": "ENABLED"}, "asset": {"id": "10", "promotionAsset": {"promotionTarget": "Family meal", "percentOff": "200000", "promotionCode": "FAMILY20", "startDate": "2026-07-01"}}},
        {"campaign": {"id": "11"}, "campaignAsset": {"fieldType": "PROMOTION"}, "asset": {"id": "12", "promotionAsset": {"promotionTarget": "Catering", "moneyAmountOff": {"amountMicros": "5000000"}}}},
    ]
    e = google.parse_extension_assets(ext, "campaignAsset")
    assert e[0]["kind"] == "sitelink" and e[0]["status"] == "PAUSED" and e[0]["details"]["finalUrl"] == "https://x/menu"
    assert e[1]["details"]["discount"] == "20% off" and e[1]["details"]["code"] == "FAMILY20" and e[1]["text"] == "20% off on Family meal"
    assert e[2]["details"]["discount"] == "$5.00 off"
    acct = google.parse_extension_assets([{"customerAsset": {"fieldType": "CALLOUT"}, "asset": {"id": "13", "calloutAsset": {"calloutText": "Free delivery"}}}], "customerAsset")
    assert acct[0]["google_campaign_id"] is None and acct[0]["text"] == "Free delivery"


def test_parse_verification():
    assert google.parse_verification({}) == ("not_required", None, None)
    v, msg, deadline = google.parse_verification(
        {"identityVerification": [{"verificationProgress": {"programStatus": "PENDING_USER_ACTION"}, "identityVerificationRequirement": {"verificationCompletionDeadlineTime": "2026-11-01 00:00:00"}}]}
    )
    assert v == "required" and "Nov 01, 2026" in msg and deadline.year == 2026
    assert google.parse_verification({"identityVerification": [{"verificationProgress": {"programStatus": "SUCCESS"}}]})[0] == "verified"
    assert google.parse_verification({"identityVerification": [{"verificationProgress": {"programStatus": "FAILURE"}}]})[0] == "failed"


def test_api_friendly():
    body = [{"error": {"code": 403, "message": "The caller does not have permission", "details": [{"errors": [{"errorCode": {"authorizationError": "DEVELOPER_TOKEN_NOT_APPROVED"}, "message": "The developer token is only approved for use with test accounts."}]}]}}]
    assert "Upgrade access level" in google.api_friendly(403, body)
    # Since Google sunset developer tokens (9 Sep 2026) access follows the Cloud project.
    body = [{"error": {"code": 403, "message": "The caller does not have permission", "details": [{"errors": [{"errorCode": {"authorizationError": "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"}}]}]}}]
    assert "Upgrade access level" in google.api_friendly(403, body)
    body = [{"error": {"code": 403, "message": "The caller does not have permission", "details": [{"errors": [{"errorCode": {"authorizationError": "SOMETHING_NEW"}}]}]}}]
    assert "authorizationError=SOMETHING_NEW" in google.api_friendly(403, body)
    assert "quota" in google.api_friendly(429, {"error": {"message": "RESOURCE_EXHAUSTED"}}).lower()
    body = {"error": {"message": "x", "details": [{"errors": [{"errorCode": {"authorizationError": "USER_PERMISSION_DENIED"}}]}]}}
    assert "manager account" in google.api_friendly(403, body)
