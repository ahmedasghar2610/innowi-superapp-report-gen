"""Support case insights: departments (recorded or estimated) and issue categories.

- every Issue Category in Salesforce maps to a department or is deliberately Unclassified;
- the department is the recorded team when set, else the estimate, else Unclassified;
- the breakdowns respect the Sales screens' visibility (a rep: their own restaurants);
- a click on any breakdown lists exactly the cases it counted (same filters, same numbers);
- the sync copies the new fields, and still copies cases if Salesforce refuses them.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from app.db.schemas import qualified
from app.models import salesforce as m
from app.modules.salesforce import case_insights as ci
from app.modules.salesforce.sync import run_sync
from tests.salesforce_fake import FakeSalesforce, seed, stamp
from tests.test_sales_api import api  # noqa: F401 - pytest fixture, used by name
from tests.test_salesforce_sync import _factory
from tests.test_salesforce_sync import sessions  # noqa: F401 - pytest fixture, used by name

SF = qualified("salesforce")
TOLIN, CASA = "001000000000000A01", "001000000000000A02"
# Issue Category picklist on innowi33, read 2026-10-20 (getObjectSchema Case).
PICKLIST = ["Cancelation", "Credentials", "Ethernet Cable", "Internet", "KDS", "Kiosk", "Marketing", "Menu",
            "Mobile POS", "Online Ordering", "Other", "Payment", "Payment Terminal Error", "POS", "Power Cable",
            "Printer", "Refund", "Router", "Sales", "Schedule Change", "Website"]

# id, account, category, team, closed after hours (None = open), priority
CASES = [
    ("500000000000000T01", CASA, "Printer", None, 4, "High"),
    ("500000000000000T02", CASA, "Printer", None, None, "Medium"),
    ("500000000000000T03", CASA, "Payment", "Payments", 10, "Medium"),
    ("500000000000000T04", TOLIN, "Menu", None, 2, "Low"),
    ("500000000000000T05", TOLIN, "Other", None, 6, "Medium"),
    ("500000000000000T06", TOLIN, "Printer", "Operations", 8, "High"),  # recorded team wins over the estimate
    ("500000000000000T07", TOLIN, None, None, None, "Medium"),
]


def test_every_salesforce_category_is_mapped_or_deliberately_unclassified():
    assert set(ci.CATEGORY_DEPARTMENT) <= set(PICKLIST)
    assert set(PICKLIST) - set(ci.CATEGORY_DEPARTMENT) == {"Other"}


@pytest.fixture()
async def cases(api):
    clients, users, sessions_ = api
    async with sessions_() as db:
        await db.execute(text(f"delete from {SF}.case where id like '500000000000000T%'"))
        for cid, acc, cat, team, hours, prio in CASES:
            await db.execute(text(
                f"insert into {SF}.case (id, case_number, subject, status, priority, origin, account_id, owner_id, is_closed, "
                f"sf_created_at, sf_closed_at, issue_category, assigned_team) values (:id, :n, :s, :st, :p, 'Phone', :a, "
                f"'005000000000000SUP', :closed, timestamptz '2026-10-05 15:00+00', "
                f"case when cast(:h as int) is null then null else timestamptz '2026-10-05 15:00+00' + make_interval(hours => cast(:h as int)) end, "
                f":cat, :team)"),
                {"id": cid, "n": cid[-4:], "s": f"{cat or 'Unknown'} problem at the counter", "st": "Closed" if hours else "Open",
                 "p": prio, "a": acc, "closed": hours is not None, "h": hours, "cat": cat, "team": team})
        await db.commit()
    yield clients, users, sessions_
    async with sessions_() as db:
        await db.execute(text(f"delete from {SF}.case where id like '500000000000000T%'"))
        await db.commit()


async def test_departments_recorded_estimated_unclassified(cases):
    c, _, _ = cases
    body = (await c["admin"].get("/sales/cases/insights", params={"search": "problem at the counter"})).json()
    by = {d["key"]: d["count"] for d in body["byDepartment"]}
    assert by == {"Field Service Engineering": 2, "Payments": 1, "Operations": 1, "Menu": 1, "Unclassified": 2}
    t = body["totals"]
    assert (t["cases"], t["open"], t["departmentRecorded"], t["departmentEstimated"], t["departmentUnclassified"]) == (7, 2, 2, 3, 2)
    assert t["medianHoursToClose"] == 6.0  # 2, 4, 6, 8, 10
    cats = {d["key"]: (d["count"], d["department"]) for d in body["byCategory"]}
    assert cats["Printer"] == (3, "Field Service Engineering") and cats[ci.NO_CATEGORY] == (1, "Unclassified")
    assert {w["key"] for w in body["subjectWords"]} >= {"printer", "counter"}


async def test_a_click_lists_exactly_what_was_counted(cases):
    c, _, _ = cases
    q = {"search": "problem at the counter"}
    body = (await c["admin"].get("/sales/cases/insights", params=q)).json()
    checks = [({"department": d["key"]}, d["count"]) for d in body["byDepartment"]]
    checks += [({"category": d["key"]}, d["count"]) for d in body["byCategory"]]
    checks += [({"source": d["key"]}, d["count"]) for d in body["bySource"]]
    checks += [({"department": x["department"], "category": x["category"]}, x["count"]) for x in body["matrix"]]
    checks += [({"priority": d["key"]}, d["count"]) for d in body["byPriority"]]
    assert len(checks) > 10
    for extra, want in checks:
        got = (await c["admin"].get("/sales/cases", params={**q, **extra, "state": "all", "limit": 1})).json()["meta"]["total"]
        assert got == want, (extra, got, want)
    listed = (await c["admin"].get("/sales/cases", params={**q, "state": "all", "department": "Payments"})).json()["data"]
    assert listed[0]["department"] == "Payments" and listed[0]["departmentSource"] == "recorded"


async def test_a_rep_sees_only_their_own_restaurants(cases):
    c, _, _ = cases
    q = {"search": "problem at the counter"}
    adam = (await c["adam"].get("/sales/cases/insights", params=q)).json()
    assert adam["totals"]["cases"] == 3  # Casa Mia only
    assert {r["id"] for r in adam["topRestaurants"]} == {CASA}
    listed = (await c["adam"].get("/sales/cases", params={**q, "state": "all"})).json()["meta"]["total"]
    assert listed == 3
    assert (await c["marketing"].get("/sales/cases/insights")).status_code == 403


async def test_filters_and_dates(cases):
    c, _, _ = cases
    q = {"search": "problem at the counter"}
    assert (await c["admin"].get("/sales/cases/insights", params={**q, "state": "open"})).json()["totals"]["cases"] == 2
    assert (await c["admin"].get("/sales/cases/insights", params={**q, "from": "2026-10-06"})).json()["totals"]["cases"] == 0
    assert (await c["admin"].get("/sales/cases/insights", params={**q, "to": "2026-10-05"})).json()["totals"]["cases"] == 7
    assert (await c["admin"].get("/sales/cases/insights", params={**q, "source": "nope"})).status_code == 400


async def test_sync_copies_the_care_fields(sessions):  # noqa: F811
    fake = seed(FakeSalesforce())
    fake.find("Case", "500000000000000C01").update(Issue_Category__c="Printer", Case_Assigned_To__c="Field Service Engineering",
                                                   Resolution_Type__c="Visit", Caller_Type__c="Merchant", Details__c="Paper jam")
    await run_sync(sessions, trigger="manual", client_factory=_factory(fake))
    async with sessions() as db:
        row = await db.get(m.SfCase, "500000000000000C01")
    assert (row.issue_category, row.assigned_team, row.resolution_type, row.details) == (
        "Printer", "Field Service Engineering", "Visit", "Paper jam")


async def test_sync_still_copies_cases_if_salesforce_refuses_the_new_fields(sessions):  # noqa: F811
    fake = seed(FakeSalesforce())
    fake.refused_fields = {"Issue_Category__c"}
    async with sessions() as db:
        await db.execute(text(f"update {SF}.sync_state set last_modstamp = null, last_id = null where object_name = 'Case'"))
        await db.commit()
    result = await run_sync(sessions, trigger="manual", client_factory=_factory(fake))
    case_result = result.objects["Case"]
    assert case_result.error is None and case_result.done and case_result.upserted >= 1
    assert "Issue_Category__c" in (case_result.note or "")


async def test_blank_values_and_queues_can_be_clicked_too(cases):
    """A blank priority, and cases sitting in two different queues: each gets its own row,
    and clicking it lists exactly those cases."""
    c, _, sessions_ = cases
    async with sessions_() as db:
        for cid, owner, prio in (("500000000000000T08", "00G000000000000QA1", None),
                                 ("500000000000000T09", "00G000000000000QB2", "")):
            await db.execute(text(
                f"insert into {SF}.case (id, case_number, subject, status, priority, origin, account_id, owner_id, "
                f"is_closed, sf_created_at) values (:id, :n, 'Kiosk problem at the counter', 'Open', :p, null, :a, :o, "
                f"false, timestamptz '2026-10-05 15:00+00')"),
                {"id": cid, "n": cid[-4:], "p": prio, "a": CASA, "o": owner})
        await db.commit()
    q = {"search": "problem at the counter"}
    body = (await c["admin"].get("/sales/cases/insights", params=q)).json()
    assert "byStatus" not in body and "byResolution" not in body
    prio = {g["key"]: g["count"] for g in body["byPriority"]}
    assert prio[ci.BLANK] == 2  # NULL and '' are one value
    handlers = {g["key"]: g["id"] for g in body["byHandler"]}
    assert handlers["Queue ·0QA1"] != handlers["Queue ·0QB2"]
    origin = {g["key"]: g["count"] for g in body["byOrigin"]}
    assert origin[ci.BLANK] == 2
    checks = [({"priority": g["key"]}, g["count"]) for g in body["byPriority"]]
    checks += [({"origin": g["key"]}, g["count"]) for g in body["byOrigin"]]
    checks += [({"handledBy": g["id"]}, g["count"]) for g in body["byHandler"]]
    for extra, want in checks:
        got = (await c["admin"].get("/sales/cases", params={**q, **extra, "state": "all", "limit": 1})).json()["meta"]["total"]
        assert got == want, (extra, got, want)
        ins = (await c["admin"].get("/sales/cases/insights", params={**q, **extra})).json()["totals"]["cases"]
        assert ins == want, (extra, ins, want)


async def _case_state(sessions):  # noqa: F811
    async with sessions() as db:
        return (await db.execute(text(
            f"select last_modstamp, optional_missing from {SF}.sync_state where object_name = 'Case'"))).one()


async def test_refused_fields_keep_stored_values_and_are_read_again_once_allowed(sessions):  # noqa: F811
    fake = seed(FakeSalesforce())
    case = fake.find("Case", "500000000000000C01")
    case.update(Issue_Category__c="Printer", Details__c="Paper jam")
    async with sessions() as db:
        await db.execute(text(f"update {SF}.sync_state set last_modstamp = null, last_id = null, optional_missing = false "
                              f"where object_name = 'Case'"))
        await db.commit()
    await run_sync(sessions, trigger="manual", client_factory=_factory(fake))

    # Salesforce stops letting the sync read the field; the case changes meanwhile.
    fake.refused_fields = {"Issue_Category__c"}
    case.update(Subject="Printer still jams", Issue_Category__c="Menu", SystemModstamp=stamp(13))
    result = await run_sync(sessions, trigger="manual", client_factory=_factory(fake))
    assert result.objects["Case"].note and result.objects["Case"].error is None
    async with sessions() as db:
        row = await db.get(m.SfCase, "500000000000000C01")
        assert (row.subject, row.issue_category, row.details) == ("Printer still jams", "Printer", "Paper jam")
    before, missing = await _case_state(sessions)
    assert missing is True

    # Allowed again, with nothing newly changed: the whole object is read again with the fields.
    fake.refused_fields = set()
    result = await run_sync(sessions, trigger="manual", client_factory=_factory(fake))
    assert result.objects["Case"].error is None and not result.objects["Case"].note
    async with sessions() as db:
        assert (await db.get(m.SfCase, "500000000000000C01")).issue_category == "Menu"
    after, missing = await _case_state(sessions)
    assert missing is False and after >= before  # the saved position never moves back
