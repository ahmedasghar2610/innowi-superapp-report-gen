"""Fathom helpers that need no database: webhook signatures and the API
client's paging (against a mocked Fathom)."""
from __future__ import annotations

import asyncio
import base64
import datetime as dt

import httpx

from app.modules.ops import fathom

SECRET = "whsec_" + base64.b64encode(b"0123456789abcdef0123456789abcdef").decode()


def _headers(body: bytes, ts: int, sig: str | None = None) -> dict:
    return {"webhook-id": "msg_abc", "webhook-timestamp": str(ts), "webhook-signature": sig or fathom.sign_webhook(SECRET, "msg_abc", ts, body)}


def test_webhook_signature_valid_and_multiple_signatures():
    body = b'{"recording_id": 1}'
    ts = 1_800_000_000
    assert fathom.verify_webhook(SECRET, _headers(body, ts), body, now=ts)
    good = fathom.sign_webhook(SECRET, "msg_abc", ts, body)
    assert fathom.verify_webhook(SECRET, _headers(body, ts, f"v1,wrong {good}"), body, now=ts)
    # header names are case-insensitive
    assert fathom.verify_webhook(SECRET, {k.upper(): v for k, v in _headers(body, ts).items()}, body, now=ts)


def test_webhook_signature_rejects_tampering_old_and_missing():
    body = b'{"recording_id": 1}'
    ts = 1_800_000_000
    h = _headers(body, ts)
    assert not fathom.verify_webhook(SECRET, h, b'{"recording_id": 2}', now=ts)
    assert not fathom.verify_webhook(SECRET, h, body, now=ts + 301)
    assert not fathom.verify_webhook("whsec_" + base64.b64encode(b"other-secret-other-secret").decode(), h, body, now=ts)
    assert not fathom.verify_webhook(SECRET, {"webhook-id": "x"}, body, now=ts)
    assert not fathom.verify_webhook("", h, body, now=ts)


def test_fetch_meetings_pages_and_sends_key(monkeypatch):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.headers["X-Api-Key"] == "k-123"
        assert request.url.params["include_action_items"] == "true"
        if request.url.params.get("cursor") == "p2":
            return httpx.Response(200, json={"limit": 1, "next_cursor": None, "items": [{"recording_id": 2}]})
        return httpx.Response(200, json={"limit": 1, "next_cursor": "p2", "items": [{"recording_id": 1}]})

    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    items = asyncio.run(fathom.fetch_meetings("k-123", dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc), "https://api.fathom.ai/external/v1"))
    assert [i["recording_id"] for i in items] == [1, 2]
    assert seen[0].url.params["created_after"] == "2026-10-01T00:00:00Z"


def test_fetch_meetings_bad_key(monkeypatch):
    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(lambda r: httpx.Response(401)), **kw))
    try:
        asyncio.run(fathom.fetch_meetings("bad", None, "https://api.fathom.ai/external/v1"))
    except fathom.FathomError as e:
        assert "API key" in str(e)
    else:
        raise AssertionError("expected FathomError")
