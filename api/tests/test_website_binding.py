"""Form <-> visual-editor binding (modules/websites/binding.py)."""
from __future__ import annotations

import re

from app.modules.websites import binding as b

SNAP = """<h1 class="x" data-bind="hero.headline">Hot<br>Pizza</h1><p data-bind="hero.subtext">Fresh daily</p>
<a href="https://o.demo" class="btn" data-bind-href="hero.ctaLink"><span data-bind="hero.ctaLabel">Order</span></a>
<span data-bind="business.phone">(555) 111</span><a href="tel:555111" data-bind-href="business.phone" data-bind-href-fmt="tel">(555) 111</a>
<img src="/_next/image?url=x&amp;w=1" srcset="a 1x" data-bind-src="hero.image" alt="">
<div class="grid" data-bind-list="offerings.items"><div data-bind-item="" data-sb-id="n1" class="card"><h3 data-bind=".name">A</h3><p data-bind=".description">aa</p></div><div data-bind-item="" data-sb-id="n2" class="card"><h3 data-bind=".name">B</h3><p data-bind=".description">bb</p></div></div>
<section data-sb-id="extra"><p>Only in the visual editor</p></section>"""

V = {
    "hero": {"headline": "Hot\nPizza", "subtext": "Fresh daily", "ctaLink": "https://o.demo", "ctaLabel": "Order",
             "image": "/api/v1/websites/assets/local/website/x.jpg"},
    "business": {"phone": "(555) 111"},
    "offerings": {"items": [{"name": "A", "description": "aa", "price": "$1"},
                            {"name": "B", "description": "bb", "price": "$2"}]},
}
LOCK = {"business.phone"}


def url(s: str) -> str:
    return ("http://api" + s) if s.startswith("/api/") else s


def path(s: str) -> str:
    return s.split("http://api", 1)[-1]


def fill(html, values):
    return b.fill(html, values, LOCK, asset_url=url, asset_path=path)


def extract(html, values):
    return b.extract(html, values, LOCK, asset_path=path)


def test_first_read_only_stamps_and_is_idempotent():
    h1 = fill(SNAP, V)
    assert "Only in the visual editor" in h1 and 'srcset="a 1x"' in h1 and "Hot<br>Pizza" in h1
    assert fill(h1, V) == h1
    assert extract(h1, V) == {}


def test_form_changes_reach_the_edited_page():
    h1 = fill(SNAP, V)
    v2 = b.merge(V, {"hero": {"subtext": "Wood-fired since 1998", "image": "/api/v1/websites/assets/local/website/y.jpg"}})
    h2 = fill(h1, v2)
    assert "Wood-fired since 1998" in h2
    assert 'src="http://api/api/v1/websites/assets/local/website/y.jpg"' in h2 and "srcset" not in h2
    assert "Only in the visual editor" in h2 and "Hot<br>Pizza" in h2


def test_visual_edits_are_written_back():
    h1 = fill(SNAP, V)
    h2 = h1.replace(">Order<", ">Order now<").replace('href="https://o.demo"', 'href="https://new.demo"')
    changes = extract(h2, V)
    assert changes == {"hero": {"ctaLabel": "Order now", "ctaLink": "https://new.demo"}}
    v2 = b.merge(V, changes)
    assert extract(fill(h2, v2), v2) == {}


def test_profile_field_is_marked_edited_and_followed():
    h1 = fill(SNAP, V)
    assert "data-bind-profile" in h1
    # Edited on the page: reported like any other field (editor.py saves it to the Profile).
    edited = h1.replace(">(555) 111</span>", ">(555) 222</span>")
    assert extract(edited, V) == {"business": {"phone": "(555) 222"}}
    # Changed on the Profile: the page (text and tel: link) follows.
    v2 = b.merge(V, {"business": {"phone": "(626) 555-0148"}})
    updated = fill(h1, v2)
    assert "(626) 555-0148</span>" in updated and 'href="tel:6265550148"' in updated


def test_lists_follow_the_form_and_the_editor():
    h1 = fill(SNAP, V)
    grown_v = b.merge(V, {"offerings": {"items": V["offerings"]["items"] + [{"name": "C", "description": "cc"}]}})
    grown = fill(h1, grown_v)
    assert grown.count("data-bind-item") == 3 and ">C</h3>" in grown and ">cc</p>" in grown
    assert grown.count('data-sb-id="n2"') == 1  # the clone doesn't reuse the editor id

    shrunk = fill(grown, b.merge(grown_v, {"offerings": {"items": grown_v["offerings"]["items"][:1]}}))
    assert shrunk.count("data-bind-item") == 1 and ">A</h3>" in shrunk

    renamed = grown.replace(">B</h3>", ">B deluxe</h3>")
    items = extract(renamed, grown_v)["offerings"]["items"]
    assert [i["name"] for i in items] == ["A", "B deluxe", "C"] and items[1]["price"] == "$2"

    first_row = re.search(r'<div data-bind-item[^>]*data-bind-i="0"[^>]*>.*?</div>', grown).group(0)
    deleted = extract(grown.replace(first_row, ""), grown_v)
    assert [i["name"] for i in deleted["offerings"]["items"]] == ["B", "C"]


def test_unbound_pages_are_untouched():
    legacy = "<div><h1>Old page</h1></div>"
    assert b.fill(legacy, V, LOCK) == legacy
    assert b.extract(legacy, V, LOCK) == {}
    assert not b.has_bindings({"pages": {"/": {"html": legacy}}})
    assert b.has_bindings({"pages": {"/": {"html": SNAP}}})


def test_markup_round_trips_byte_for_byte():
    html = '<div class="a" data-sb-id="x"><svg viewBox="0 0 1 1"><path d="M0"></path></svg>&nbsp;<!-- c --><img src="a.png" alt=""><br></div>'
    assert b.serialize(b.parse(html)) == html


HOURS = {"business": {"hours": "Mon–Thu 11am–9pm · Fri–Sun 11am–11pm"}}
HOURS_SNAP = '<p data-bind="business.hours">Mon–Thu 11am–9pm · Fri–Sun 11am–11pm</p>'


def test_edit_made_before_the_first_save_is_written_back():
    edited = HOURS_SNAP.replace("11pm", "1pm")  # typed before the page was ever saved
    pending = b.mark_pending_edits(edited, HOURS)
    assert b.extract(pending, HOURS, {"business.hours"}) == {"business": {"hours": "Mon–Thu 11am–9pm · Fri–Sun 11am–1pm"}}


def test_page_stuck_with_an_unsynced_edit_is_repaired_on_save():
    # Saved by the earlier version: the edit was stamped as if it were the answer.
    stuck = '<p data-bind="business.hours" data-bind-v="{v}" data-bind-t="{t}">Mon–Thu 11am–9pm · Fri–Sun 11am–1pm</p>'.format(
        v=b.h(HOURS["business"]["hours"]), t=b.h("Mon–Thu 11am–9pm · Fri–Sun 11am–1pm"))
    assert b.extract(stuck, HOURS) == {}  # invisible to a plain extract
    repaired = b.extract(b.mark_pending_edits(stuck, HOURS), HOURS)
    assert repaired == {"business": {"hours": "Mon–Thu 11am–9pm · Fri–Sun 11am–1pm"}}


def test_mark_pending_leaves_real_edits_and_defaults_alone():
    h1 = fill(SNAP, V)
    assert b.mark_pending_edits(h1, V) == h1                      # nothing diverged
    edited = h1.replace(">Order<", ">Order now<")
    assert extract(b.mark_pending_edits(edited, V), V) == {"hero": {"ctaLabel": "Order now"}}
    default = '<span data-bind="about.eyebrow">About us</span>'  # empty answer, template default
    assert b.mark_pending_edits(default, {}) == default
