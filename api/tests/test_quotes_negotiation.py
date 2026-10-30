"""Quote negotiation: bundling, revisions (both directions), signatures, decline.

Runs against the configured Postgres, like test_quotes_api.py (skipped when
unreachable or not migrated). The fixtures there are reused via import.
"""
from __future__ import annotations

import base64
import io
import struct
import zlib
from decimal import Decimal as D

import pytest  # noqa: F401 - fixtures below need pytest collection

from tests.test_quotes_api import _items, _link, api, sessions  # noqa: F401 - pytest fixtures

CONTACT = {"name": "Maria Rossi", "email": "maria@example.com"}


def _png_data_url(width: int = 40, height: int = 16) -> str:
    """A tiny valid PNG (black rectangle) as a data URL, like a canvas export."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    raw = b"".join(b"\x00" + b"\x00\x00\x00\xff" * width for _ in range(height))  # RGBA rows
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw))
           + chunk(b"IEND", b""))
    return "data:image/png;base64," + base64.b64encode(png).decode()


async def _submit(c, token, sel, **extra):
    body = {"items": sel, "contact": CONTACT, **extra}
    res = await c["anon"].post(f"/public/quotes/{token}/requests", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _sign_body(rev_no: int, name: str = "Maria Rossi", method: str = "TYPED", data: str | None = None):
    return {"revisionNo": rev_no, "name": name, "method": method,
            "signatureData": data if data is not None else name, "agree": True}


# ── bundling: marketing already includes email/SMS ─────────────────────────
async def test_bundle_strips_included_item(api):  # noqa: F811
    c, _, _ = api
    items = await _items(c)
    assert items["SW-EMAIL-SMS"]["bundledInSku"] == "MKT-PACKAGE"
    _, token = await _link(c)

    offer = (await c["anon"].get(f"/public/quotes/{token}")).json()
    sms = next(i for s in offer["sections"] for i in s["items"] if i["sku"] == "SW-EMAIL-SMS")
    assert sms["bundledInSku"] == "MKT-PACKAGE" and sms["bundledInName"] == "Marketing package"

    both = [{"itemId": items["MKT-PACKAGE"]["id"], "qty": 1}, {"itemId": items["SW-EMAIL-SMS"]["id"], "qty": 1}]
    priced = (await c["anon"].post(f"/public/quotes/{token}/price", json={"items": both})).json()
    assert priced["bundledOut"] == ["Email and SMS campaigns"]
    assert all(line["sku"] != "SW-EMAIL-SMS" for line in priced["lines"])
    assert D(priced["totals"]["monthly"]) == D("249.00")

    # Alone (no marketing), the add-on still prices normally.
    alone = (await c["anon"].post(f"/public/quotes/{token}/price",
                                  json={"items": [{"itemId": items["SW-EMAIL-SMS"]["id"], "qty": 1}]})).json()
    assert priced["bundledOut"] and D(alone["totals"]["monthly"]) == D("49.95")

    # The stored request is stripped too, even if the client bypasses the UI.
    req = await _submit(c, token, both)
    assert all(line["sku"] != "SW-EMAIL-SMS" for line in req["lines"])
    assert D(req["totals"]["monthly"]) == D("249.00")


async def test_bundle_rule_is_admin_editable_and_validated(api):  # noqa: F811
    c, _, _ = api
    items = await _items(c)
    sms = items["SW-EMAIL-SMS"]
    bad = await c["admin"].patch(f"/quotes/price-list/{sms['id']}", json={"bundledInSku": "NO-SUCH-SKU"})
    assert bad.status_code == 400
    bad = await c["admin"].patch(f"/quotes/price-list/{sms['id']}", json={"bundledInSku": "SW-EMAIL-SMS"})
    assert bad.status_code == 400
    ok = await c["admin"].patch(f"/quotes/price-list/{sms['id']}", json={"clear": ["bundledInSku"]})
    assert ok.status_code == 200 and ok.json()["bundledInSku"] is None
    ok = await c["admin"].patch(f"/quotes/price-list/{sms['id']}", json={"bundledInSku": "MKT-PACKAGE"})
    assert ok.status_code == 200 and ok.json()["bundledInSku"] == "MKT-PACKAGE"


# ── revisions: staff counter, client counter, diffable trail ───────────────
async def test_staff_revision_and_client_counter(api):  # noqa: F811
    c, _, sent = api
    items = await _items(c)
    _, token = await _link(c)
    req = await _submit(c, token, [{"itemId": items["DEV-POS"]["id"], "qty": 1}])
    assert req["currentRevisionNo"] == 1 and len(req["revisions"]) == 1
    rid = req["id"]

    # Staff counter: two stations and the install kit, with a note.
    res = await c["manager"].post(f"/quotes/requests/{rid}/revise", json={
        "items": [{"itemId": items["DEV-POS"]["id"], "qty": 2}, {"itemId": items["HW-INSTALL-KIT"]["id"], "qty": 1}],
        "note": "Added a second station and the install kit.",
    })
    assert res.status_code == 200, res.text
    staff = res.json()
    assert staff["currentRevisionNo"] == 2 and staff["status"] == "PROPOSED"
    assert [rev["revNo"] for rev in staff["revisions"]] == [1, 2]
    assert staff["revisions"][1]["authorKind"] == "STAFF"
    assert staff["revisions"][1]["note"] == "Added a second station and the install kit."
    assert staff["revisions"][0]["contentHash"] != staff["revisions"][1]["contentHash"]
    kinds = [e["kind"] for e in staff["events"]]
    assert "SUBMITTED" in kinds and "REVISED_STAFF" in kinds

    # The restaurant sees the trail on their link, newest totals on top.
    pub = (await c["anon"].get(f"/public/quotes/{token}/requests/{rid}")).json()
    assert pub["currentRevisionNo"] == 2 and len(pub["revisions"]) == 2
    assert pub["revisions"][1]["note"] == "Added a second station and the install kit."
    assert D(pub["totals"]["oneTime"]) == D(staff["totals"]["oneTime"])

    # Client counter: back to one station, as a revision on the SAME request.
    counter = await _submit(c, token, [{"itemId": items["DEV-POS"]["id"], "qty": 1}],
                            requestId=rid, notes="One station is enough for now.")
    assert counter["id"] == rid and counter["currentRevisionNo"] == 3
    assert counter["revisions"][2]["authorKind"] == "RESTAURANT"
    staff2 = (await c["rep"].get(f"/quotes/requests/{rid}")).json()
    assert staff2["currentRevisionNo"] == 3 and staff2["revisions"][2]["note"] == "One station is enough for now."
    # Only one request exists for this link.
    lst = (await c["rep"].get("/quotes/requests")).json()
    assert lst["meta"]["total"] == 1


async def test_hidden_link_reveal_prices_flow(api):  # noqa: F811
    c, _, _ = api
    items = await _items(c)
    _, token = await _link(c, mode="HIDE_PRICES", discountPercent="15")
    req = await _submit(c, token, [{"itemId": items["DEV-POS"]["id"], "qty": 1}])
    assert req["showPrices"] is False and "totals" not in req
    rid = req["id"]

    # A staff revision without reveal keeps prices hidden.
    res = await c["manager"].post(f"/quotes/requests/{rid}/revise", json={
        "items": [{"itemId": items["DEV-POS"]["id"], "qty": 1}], "revealPrices": False})
    assert res.status_code == 200 and res.json()["pricesRevealed"] is False
    pub = (await c["anon"].get(f"/public/quotes/{token}/requests/{rid}")).json()
    assert pub["showPrices"] is False and "totals" not in pub

    # Reveal: the client now sees this request priced (with the special pricing) and can sign.
    res = await c["manager"].post(f"/quotes/requests/{rid}/revise", json={
        "items": [{"itemId": items["DEV-POS"]["id"], "qty": 1}], "revealPrices": True,
        "note": "Here's your pricing."})
    assert res.status_code == 200 and res.json()["pricesRevealed"] is True
    pub = (await c["anon"].get(f"/public/quotes/{token}/requests/{rid}")).json()
    assert pub["showPrices"] is True and pub["status"] == "PROPOSED"
    assert D(pub["totals"]["monthlySoftware"]) == D("84.15")  # first station: 99 x 0.85
    # Earlier revisions stay priced in the trail once revealed.
    assert pub["revisions"][0]["totals"] is not None
    # The PDF now works for the client too.
    assert (await c["anon"].get(f"/public/quotes/{token}/requests/{rid}/pdf")).status_code == 200
    # The link's catalog itself stays hidden-price.
    offer = (await c["anon"].get(f"/public/quotes/{token}")).json()
    assert offer["showPrices"] is False

    ok = await c["anon"].post(f"/public/quotes/{token}/requests/{rid}/sign", json=_sign_body(3))
    assert ok.status_code == 200 and ok.json()["status"] == "SIGNED"


# ── signing: stale revision, drawn signatures, countersign, voiding ───────
async def test_sign_stale_revision_rejected(api):  # noqa: F811
    c, _, _ = api
    items = await _items(c)
    _, token = await _link(c)
    req = await _submit(c, token, [{"itemId": items["DEV-KDS-15"]["id"], "qty": 1}])
    rid = req["id"]
    await c["manager"].post(f"/quotes/requests/{rid}/revise",
                            json={"items": [{"itemId": items["DEV-KDS-15"]["id"], "qty": 2}]})
    stale = await c["anon"].post(f"/public/quotes/{token}/requests/{rid}/sign", json=_sign_body(1))
    assert stale.status_code == 409
    ok = await c["anon"].post(f"/public/quotes/{token}/requests/{rid}/sign", json=_sign_body(2))
    assert ok.status_code == 200


async def test_full_signature_flow_with_drawn_signatures(api):  # noqa: F811
    c, _, sent = api
    items = await _items(c)
    _, token = await _link(c)
    req = await _submit(c, token, [{"itemId": items["DEV-POS"]["id"], "qty": 1},
                                   {"itemId": items["SVC-DEPLOY"]["id"], "qty": 1}])
    rid = req["id"]

    bad = await c["anon"].post(f"/public/quotes/{token}/requests/{rid}/sign",
                               json=_sign_body(1, method="DRAWN", data="data:image/png;base64,AAAA"))
    assert bad.status_code == 400

    ok = await c["anon"].post(f"/public/quotes/{token}/requests/{rid}/sign",
                              json=_sign_body(1, method="DRAWN", data=_png_data_url()))
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "SIGNED"

    # Countersign needs the client's signature first; a fresh request can't be countersigned.
    other = await _submit(c, token, [{"itemId": items["SVC-MENU"]["id"], "qty": 1}])
    res = await c["rep"].post(f"/quotes/requests/{other['id']}/countersign", json={
        "name": "Alex Rep", "method": "TYPED", "signatureData": "Alex Rep", "agree": True})
    assert res.status_code == 409

    res = await c["rep"].post(f"/quotes/requests/{rid}/countersign", json={
        "name": "Alex Rep", "title": "Sales", "method": "DRAWN", "signatureData": _png_data_url(60, 20),
        "agree": True})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "EXECUTED"
    assert sorted(s["role"] for s in body["signatures"]) == ["CLIENT", "INNOWI"]
    assert all(s["voidedAt"] is None for s in body["signatures"])
    assert {e["kind"] for e in body["events"]} >= {"SIGNED_CLIENT", "SIGNED_INNOWI"}
    assert body["notified"]["executed"]["teams"] is True

    # Fully signed: no further revisions from either side, and the PDF carries the certificate.
    assert (await c["manager"].post(f"/quotes/requests/{rid}/revise", json={
        "items": [{"itemId": items["DEV-POS"]["id"], "qty": 3}]})).status_code == 409
    counter = await c["anon"].post(f"/public/quotes/{token}/requests",
                                   json={"items": [{"itemId": items["DEV-POS"]["id"], "qty": 3}],
                                         "contact": CONTACT, "requestId": rid})
    assert counter.status_code == 409
    pdf = await c["anon"].get(f"/public/quotes/{token}/requests/{rid}/pdf")
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    assert b"Signature certificate" in pdf.content or len(pdf.content) > 4000  # text may be compressed


async def test_revision_after_signature_voids_it(api):  # noqa: F811
    c, _, _ = api
    items = await _items(c)
    _, token = await _link(c)
    req = await _submit(c, token, [{"itemId": items["DEV-POS"]["id"], "qty": 1}])
    rid = req["id"]
    await c["anon"].post(f"/public/quotes/{token}/requests/{rid}/sign", json=_sign_body(1))

    res = await c["manager"].post(f"/quotes/requests/{rid}/revise", json={
        "items": [{"itemId": items["DEV-POS"]["id"], "qty": 2}], "note": "Need two stations after all."})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "PROPOSED" and body["acceptedAt"] is None
    assert body["signatures"][0]["voidedAt"] is not None
    assert any(e["kind"] == "SIGNATURE_VOIDED" for e in body["events"])

    # The client signs the new revision; the old signature stays voided on rev 1.
    ok = await c["anon"].post(f"/public/quotes/{token}/requests/{rid}/sign", json=_sign_body(2))
    assert ok.status_code == 200 and ok.json()["status"] == "SIGNED"
    sigs = ok.json()["signatures"]
    assert [(s["revNo"], s.get("voidedAt") is None) for s in sigs] == [(1, False), (2, True)]


async def test_decline_and_summary_counts(api):  # noqa: F811
    c, _, _ = api
    items = await _items(c)
    _, token = await _link(c)
    a = await _submit(c, token, [{"itemId": items["DEV-POS"]["id"], "qty": 1}])
    res = await c["anon"].post(f"/public/quotes/{token}/requests/{a['id']}/decline",
                               json={"name": "Maria Rossi", "reason": "Too rich for us right now."})
    assert res.status_code == 200 and res.json()["status"] == "DECLINED"
    assert res.json()["declinedReason"] == "Too rich for us right now."
    assert (await c["anon"].post(f"/public/quotes/{token}/requests/{a['id']}/decline",
                                 json={"name": "Maria Rossi"})).status_code == 409

    b = await _submit(c, token, [{"itemId": items["DEV-POS"]["id"], "qty": 1}])
    await c["anon"].post(f"/public/quotes/{token}/requests/{b['id']}/sign", json=_sign_body(1))
    s = (await c["rep"].get("/quotes/summary")).json()
    assert s["accepted30d"] == 1  # SIGNED counts as won; DECLINED doesn't
    await c["rep"].post(f"/quotes/requests/{b['id']}/countersign", json={
        "name": "Alex Rep", "method": "TYPED", "signatureData": "Alex Rep", "agree": True})
    s = (await c["rep"].get("/quotes/summary")).json()
    assert s["accepted30d"] == 1  # EXECUTED still counts once


async def test_staff_pdf_for_an_earlier_revision(api):  # noqa: F811
    c, _, _ = api
    items = await _items(c)
    _, token = await _link(c)
    req = await _submit(c, token, [{"itemId": items["SVC-WEBSITE"]["id"], "qty": 1}])
    rid = req["id"]
    await c["manager"].post(f"/quotes/requests/{rid}/revise",
                            json={"items": [{"itemId": items["SVC-WEBSITE"]["id"], "qty": 1},
                                            {"itemId": items["SVC-MENU"]["id"], "qty": 1}]})
    ok = await c["rep"].get(f"/quotes/requests/{rid}/pdf", params={"rev": 1})
    assert ok.status_code == 200 and ok.content[:4] == b"%PDF"
    assert (await c["rep"].get(f"/quotes/requests/{rid}/pdf", params={"rev": 9})).status_code == 404


async def test_client_email_notifications_on_staff_revision(api):  # noqa: F811
    c, _, sent = api
    items = await _items(c)
    _, token = await _link(c)
    req = await _submit(c, token, [{"itemId": items["DEV-POS"]["id"], "qty": 1}])
    res = await c["manager"].post(f"/quotes/requests/{req['id']}/revise", json={
        "items": [{"itemId": items["DEV-POS"]["id"], "qty": 2}], "note": "Two is better."})
    body = res.json()
    # Resend is off in the fixture, so the client e-mail reads "not set up" - the
    # channel outcome must still be recorded per event.
    assert "revised_staff" in body["notified"]
    assert body["notified"]["revised_staff"]["clientEmail"] is None
