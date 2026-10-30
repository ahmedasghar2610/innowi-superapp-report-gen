"""
Website import from a "One-Page Website Content" .docx, and website images.

The parser is exercised against the real Primo Cafe content file
(tests/fixtures/primo-cafe-website-content.docx) plus small synthetic
documents for the edge cases: missing sections, fewer menu rows, [CONFIRM]
notes and files that aren't content files at all.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import pytest
from fastapi.testclient import TestClient

from app.common.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.modules.websites import router as websites_router
from app.modules.websites.docx_import import DocxImportError, parse_docx

FIXTURE = Path(__file__).parent / "fixtures" / "primo-cafe-website-content.docx"


@pytest.fixture(scope="module")
def primo():
    return parse_docx(FIXTURE.read_bytes())


# ------------------------------------------------------------ real file --
def test_business_details_come_from_client_line_and_contact(primo):
    b = primo.values["business"]
    assert b["name"] == "Primo Cafe"
    assert b["address"] == "44599 Valley Central Way #6526"
    assert b["city"] == "Lancaster, CA 93536"
    assert b["phone"] == "(661) 951-7288"
    assert b["hours"] == "Monday – Sunday\n7:00 AM – 8:30 PM"
    assert b["country"] == "United States"
    assert "email" not in b  # never in the file; the wizard asks for it
    assert primo.values["orderUrl"] == "https://online-ordering.innowi.com/branch/primocafe"


def test_global_seo(primo):
    m = primo.values["meta"]
    assert m["title"].startswith("Primo Cafe — All-Day Diner")
    assert m["description"].endswith("Order direct.")
    assert m["ogTitle"] and m["ogDescription"]
    assert m["keywords"].startswith("diner Lancaster CA, breakfast Lancaster CA")
    assert '"@type": "Restaurant"' in m["jsonLd"]
    assert m["siteUrl"] == "https://primocafeav.com/"
    assert primo.values["labels"] == {"nav": "Home · About · Menu · Catering · Contact", "headerCta": "Order Online"}


def test_hero_and_about_buttons_carry_their_own_text(primo):
    v = primo.values
    assert v["hero"]["headline"] == "Lancaster's All-Day Diner Off Highway 14"
    assert v["hero"]["ctaLabel"] == "Order Direct — Priority Pickup"
    assert v["hero"]["ctaLink"] == v["orderUrl"]
    assert v["hero"]["imageAlt"] == "Pancakes with berries at Primo Cafe, Lancaster CA"
    assert v["about"]["eyebrow"] == "About Us"
    assert v["about"]["ctaLabel"] == "Order Direct"
    assert v["about"]["story"].startswith("Primo Cafe is in the Valley Central")


def test_menu_table_and_card_button(primo):
    o = primo.values["offerings"]
    assert [i["name"] for i in o["items"]] == [
        "Chorizo Burrito", "Chicken Fried Steak & Egg", "Bac & Eggs", "Avocado & Chz Omelette",
        "Fish & Chips", "Menudo Large", "Primo's Fajita Dinner", "Buffalo Chicken Pizza",
    ]
    assert all("price" not in i for i in o["items"])
    assert o["cardCta"] == "See price & order"
    assert o["ctaLabel"] == "View Full Menu & Order Direct"
    assert o["intro"].startswith("Eight of the plates")


def test_selling_points_drop_confirm_notes(primo):
    points = primo.values["social"]["points"]
    assert [p["title"] for p in points] == [
        "Open 7 AM to 8:30 PM, seven days", "One menu, all day", "Weekday specials",
        "Catering that's already on the menu",
    ]
    assert "CONFIRM" not in str(primo.values)


def test_catering_contact_reviews_footer(primo):
    v = primo.values
    assert v["catering"]["formFields"].startswith("Your name · Email · Phone · Event date · Time")
    assert v["catering"]["submitLabel"] == "Request Catering"
    assert v["catering"]["ctaLabel"] == "Call (661) 951-7288"
    assert v["contact"]["formType"] == "Contact + catering/quote form"
    assert v["contact"]["directionsLabel"] == "Get Directions"
    assert v["contact"]["line"].endswith("Parking is in the center lot.")
    # The instruction to the web team is not site copy.
    assert v["social"]["ratingText"] == "Rated 4.0 on Google from over a thousand reviews."
    assert v["footer"]["rights"] == "All Rights Reserved"
    assert v["footer"]["credit"] == "Powered by Innowi Inc."
    assert v["footer"]["freshness"].startswith("Reviewed by the Primo Cafe team")


def test_internal_parts_are_not_imported(primo):
    text = str(primo.values)
    for internal in ("Menu hygiene", "Old Menu", "Grounding", "Dropped", "GIFT CARD", "Quality gates"):
        assert internal not in text
    assert primo.warnings == []
    assert primo.sections == ["G", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "JSON-LD"]


# ------------------------------------------------------- synthetic files --
def _docx(*blocks: str) -> bytes:
    body = "".join(blocks)
    xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


def h(level: int, text: str) -> str:
    return f'<w:p><w:pPr><w:pStyle w:val="Heading{level}"/></w:pPr><w:r><w:t>{escape(text)}</w:t></w:r></w:p>'


def field(label: str, value: str) -> str:
    return (
        f"<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{escape(label)}</w:t></w:r>"
        f'<w:r><w:t xml:space="preserve"> {escape(value)}</w:t></w:r></w:p>'
    )


def table(*rows: list[str]) -> str:
    def cell(t):
        return f"<w:tc><w:p><w:r><w:t>{escape(t)}</w:t></w:r></w:p></w:tc>"

    return "<w:tbl>" + "".join("<w:tr>" + "".join(cell(c) for c in r) + "</w:tr>" for r in rows) + "</w:tbl>"


def test_fewer_menu_rows_and_missing_sections():
    data = _docx(
        field("Client:", "Rosa Pizza · 1 Main St, Austin, TX 78701 · (512) 555-0100 · Daily 11 AM–10 PM"),
        field("Order URL in every CTA:", "https://order.example.com/rosa"),
        h(1, "Part 2 — Rosa Pizza: Section Copy"),
        h(2, "S1 · Hero"),
        field("H1:", "Austin's Wood-Fired Pizza [CONFIRM tagline]"),
        h(2, "S3 · Menu picks"),
        field("H2:", "Our pizzas"),
        table(["Card", "Dish", "One line"], ["1", "Margherita", "Tomato, basil."], ["2", "Pepperoni", ""]),
    )
    r = parse_docx(data)
    assert r.values["business"]["name"] == "Rosa Pizza"
    assert r.values["business"]["hours"] == "Daily\n11 AM–10 PM"
    assert r.values["hero"]["headline"] == "Austin's Wood-Fired Pizza"
    assert r.values["offerings"]["items"] == [
        {"name": "Margherita", "description": "Tomato, basil."},
        {"name": "Pepperoni"},
    ]
    assert r.values["orderUrl"] == "https://order.example.com/rosa"
    assert "catering" not in r.values
    assert r.values["contact"]["formType"] == "Contact form"
    assert any("Catering section (S5)" in w for w in r.warnings)
    assert r.sections == ["S1", "S3"]


def test_not_a_content_file():
    with pytest.raises(DocxImportError):
        parse_docx(_docx(field("Hello:", "world")))
    with pytest.raises(DocxImportError):
        parse_docx(b"not a zip at all")


# ------------------------------------------------------------ endpoints --
@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.common.storage.local_disk import LocalDiskStorage

    storage = LocalDiskStorage.__new__(LocalDiskStorage)
    storage.root = tmp_path.resolve()
    monkeypatch.setattr(websites_router, "get_storage", lambda: storage)
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id="u1", email="a@b.c", role="SUPER_ADMIN"
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_import_endpoint(client):
    r = client.post(
        "/api/v1/websites/import-docx",
        files={"file": ("primo.docx", FIXTURE.read_bytes(), "application/octet-stream")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fileName"] == "primo.docx"
    assert body["values"]["business"]["name"] == "Primo Cafe"


def test_import_endpoint_rejects_other_files(client):
    r = client.post("/api/v1/websites/import-docx", files={"file": ("a.pdf", b"%PDF", "application/pdf")})
    assert r.status_code == 400
    r = client.post("/api/v1/websites/import-docx", files={"file": ("a.docx", b"nope", "application/octet-stream")})
    assert r.status_code == 422


PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082"
)


def test_image_upload_and_public_read(client):
    r = client.post("/api/v1/websites/assets", files={"file": ("Logo Final.png", PNG, "image/png")})
    assert r.status_code == 201, r.text
    asset = r.json()
    assert asset["url"].startswith("/api/v1/websites/assets/local/website/")
    app.dependency_overrides.clear()  # the read is public
    got = client.get(asset["url"])
    assert got.status_code == 200
    assert got.content == PNG
    assert got.headers["content-type"] == "image/png"
    assert "immutable" in got.headers["cache-control"]


def test_image_upload_rejects_non_images(client):
    r = client.post("/api/v1/websites/assets", files={"file": ("x.html", b"<script>", "text/html")})
    assert r.status_code == 400


def test_asset_read_is_confined_to_website_images(client):
    assert client.get("/api/v1/websites/assets/local/merchant-docs/2026/01/x.pdf").status_code == 404
    assert client.get("/api/v1/websites/assets/local/website/../../etc/passwd").status_code == 404


def test_import_requires_auth():
    r = TestClient(app).post("/api/v1/websites/import-docx", files={"file": ("a.docx", b"x", "application/octet-stream")})
    assert r.status_code == 401
