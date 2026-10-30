"""The Salesforce sync against a real Postgres and a fake Salesforce (tests/salesforce_fake.py).

These need the database the app is configured for, migrated to head. They are
skipped when it can't be reached, so the pure unit tests still run anywhere.
"""
from __future__ import annotations

import datetime as dt

import httpx
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.db.schemas import qualified
from app.db.session import engine_kwargs
from app.models import salesforce as m
from app.modules.salesforce import sync as sync_module
from app.modules.salesforce.client import (
    SalesforceClient,
    SalesforceConfig,
    SalesforceNotConfigured,
)
from app.modules.salesforce.sync import LOCK_KEY, run_sync
from tests.salesforce_fake import FakeSalesforce, seed, stamp

TABLES = ("user_link", "sync_run", "sync_state", "touchpoint", "visit", "case", "opportunity",
          "opportunity_stage", "contact", "account", "sf_user")


@pytest.fixture()
async def sessions():
    settings = get_settings()
    engine = create_async_engine(settings.database_url_async, **{**engine_kwargs(), "poolclass": NullPool})
    try:
        async with engine.connect() as conn:
            exists = (await conn.execute(text(
                "select to_regclass(:t)"), {"t": f"{qualified('salesforce')}.sync_run"})).scalar()
    except Exception as exc:
        await engine.dispose()
        pytest.skip(f"database not reachable: {exc}")
    if not exists:
        await engine.dispose()
        pytest.skip("salesforce schema not migrated")
    async with engine.begin() as conn:
        tables = ", ".join(f'{qualified("salesforce")}."{t}"' for t in TABLES)
        await conn.execute(text(f"TRUNCATE {tables}"))
    yield async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    await engine.dispose()


def _factory(fake: FakeSalesforce, secret: str = "secret"):
    config = SalesforceConfig(login_url="https://fake.my.salesforce.com", client_id="id", client_secret=secret)
    return lambda: SalesforceClient(config, http=httpx.AsyncClient(transport=fake.transport()))


async def _count(sessions, model) -> int:
    async with sessions() as db:
        return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def test_first_run_copies_linked_records_only(sessions):
    fake = seed(FakeSalesforce())
    result = await run_sync(sessions, trigger="manual", client_factory=_factory(fake))

    assert result.status == "success", result
    assert await _count(sessions, m.SfOpportunity) == 5
    assert await _count(sessions, m.SfCase) == 1
    assert await _count(sessions, m.SfVisit) == 1
    assert await _count(sessions, m.SfTouchpoint) == 1
    # Guest user filtered out by UserType; everyone else copied.
    assert await _count(sessions, m.SfUser) == 5
    assert await _count(sessions, m.SfOpportunityStage) == 9
    async with sessions() as db:
        account_ids = set((await db.execute(select(m.SfAccount.id))).scalars())
        contact_accounts = set((await db.execute(select(m.SfContact.account_id))).scalars())
        visit = await db.get(m.SfVisit, "a0O00000000000V001")
        run = await db.get(m.SfSyncRun, result.run_id)
    # Accounts A01-A04 are linked to a deal/case/visit/touchpoint; the cold import A05 is not.
    assert account_ids == {"001000000000000A01", "001000000000000A02", "001000000000000A03", "001000000000000A04"}
    assert contact_accounts == account_ids
    assert visit.appointment_time == "14:30" and visit.due_date_start == dt.date(2026, 10, 11)
    assert run.status == "success" and run.api_calls == result.api_calls > 0 and run.finished_at is not None
    assert run.upserted == result.upserted


async def test_second_run_updates_changed_records_without_duplicates(sessions):
    fake = seed(FakeSalesforce())
    later = lambda: dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc)
    await run_sync(sessions, trigger="schedule", client_factory=_factory(fake), now=later)

    deal = fake.find("Opportunity", "006000000000000O02")
    deal.update(StageName="Order Form Completed", SystemModstamp=stamp(12), LastModifiedDate=stamp(12))
    fake.requests.clear()
    result = await run_sync(sessions, trigger="schedule", client_factory=_factory(fake), now=later)

    assert result.status == "success"
    assert await _count(sessions, m.SfOpportunity) == 5
    async with sessions() as db:
        assert (await db.get(m.SfOpportunity, "006000000000000O02")).stage_name == "Order Form Completed"
        state = await db.get(m.SfSyncState, "Opportunity")
    assert state.last_modstamp == dt.datetime(2026, 10, 12, tzinfo=dt.timezone.utc)
    assert state.last_id == "006000000000000O02"
    # The second query asked only for records changed since the saved cursor.
    opp_queries = [u for u in fake.requests if "FROM%20Opportunity%20WHERE" in u and "SystemModstamp" in u
                   and "SELECT%20Id%2C%20Name" in u]
    assert opp_queries, fake.requests


async def test_position_stays_behind_now(sessions):
    """A change stamped in the last couple of minutes is re-read next run, not trusted as final."""
    fake = seed(FakeSalesforce())
    clock = lambda: dt.datetime(2026, 10, 12, 0, 1, tzinfo=dt.timezone.utc)
    fake.find("Opportunity", "006000000000000O02").update(SystemModstamp=stamp(12))
    await run_sync(sessions, trigger="schedule", client_factory=_factory(fake), now=clock)
    async with sessions() as db:
        state = await db.get(m.SfSyncState, "Opportunity")
    assert state.last_modstamp == clock() - sync_module.SETTLE and state.last_id is None


async def test_deleted_records_are_removed(sessions, monkeypatch):
    fake = seed(FakeSalesforce())
    await run_sync(sessions, trigger="schedule", client_factory=_factory(fake))
    fake.delete("Opportunity", "006000000000000O04")

    # Deletions are checked at most hourly: pretend the last check was 2 hours ago.
    async with sessions() as db:
        state = await db.get(m.SfSyncState, "Opportunity")
        state.deleted_checked_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=2)
        await db.commit()
    result = await run_sync(sessions, trigger="schedule", client_factory=_factory(fake))

    assert result.status == "success"
    assert result.objects["Opportunity"].deleted == 1
    async with sessions() as db:
        assert await db.get(m.SfOpportunity, "006000000000000O04") is None


async def test_old_account_newly_linked_is_backfilled_with_contacts(sessions):
    fake = seed(FakeSalesforce())
    await run_sync(sessions, trigger="schedule", client_factory=_factory(fake))
    # A new case on the cold account: the account itself hasn't changed in Salesforce.
    fake.add("Case", Id="500000000000000C02", CaseNumber="00005700", Subject="New lead call", Status="New",
             Origin="Phone", Priority="Medium", AccountId="001000000000000A05", ContactId=None,
             OwnerId="005000000000000SUP", IsClosed=False, CreatedDate=stamp(12), ClosedDate=None,
             SystemModstamp=stamp(12))
    result = await run_sync(sessions, trigger="schedule", client_factory=_factory(fake))

    assert result.status == "success"
    async with sessions() as db:
        assert await db.get(m.SfAccount, "001000000000000A05") is not None
        assert await db.get(m.SfContact, "003000000000000A05") is not None


async def test_not_configured_is_recorded_as_skipped(sessions):
    def not_configured():
        raise SalesforceNotConfigured("Salesforce is not connected yet")

    result = await run_sync(sessions, trigger="schedule", client_factory=not_configured)
    assert result.status == "skipped" and "not connected" in result.error
    async with sessions() as db:
        run = await db.get(m.SfSyncRun, result.run_id)
    assert run.status == "skipped" and run.finished_at is not None


async def test_bad_credentials_fail_the_run_without_raising(sessions):
    fake = seed(FakeSalesforce())
    result = await run_sync(sessions, trigger="manual", client_factory=_factory(fake, secret="wrong"))
    assert result.status == "error" and "bad secret" in result.error
    assert await _count(sessions, m.SfOpportunity) == 0


async def test_one_broken_object_does_not_stop_the_others(sessions):
    fake = seed(FakeSalesforce())
    fake.fail_objects.add("Touchpoint_History__c")
    result = await run_sync(sessions, trigger="manual", client_factory=_factory(fake))

    assert result.status == "error"
    assert result.objects["Touchpoint_History__c"].error
    assert await _count(sessions, m.SfOpportunity) == 5
    async with sessions() as db:
        state = await db.get(m.SfSyncState, "Touchpoint_History__c")
    assert state.last_error and state.last_success_at is None


async def test_time_budget_stops_and_next_run_continues(sessions):
    fake = seed(FakeSalesforce())
    first = await run_sync(sessions, trigger="schedule", client_factory=_factory(fake), time_budget_s=0)
    assert first.status == "partial"
    assert await _count(sessions, m.SfOpportunity) < 5 or await _count(sessions, m.SfAccount) == 0

    second = await run_sync(sessions, trigger="schedule", client_factory=_factory(fake))
    assert second.status == "success"
    assert await _count(sessions, m.SfOpportunity) == 5
    assert await _count(sessions, m.SfAccount) == 4


async def test_overlapping_run_is_skipped(sessions):
    fake = seed(FakeSalesforce())
    async with sessions() as holder:
        assert (await holder.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY})).scalar_one()
        try:
            result = await run_sync(sessions, trigger="schedule", client_factory=_factory(fake))
        finally:
            await holder.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
            await holder.commit()
    assert result.status == "skipped" and "already running" in result.error
    assert await _count(sessions, m.SfOpportunity) == 0


async def test_stale_running_rows_are_closed(sessions):
    async with sessions() as db:
        db.add(m.SfSyncRun(id="cstalerun0000000000000000", trigger="schedule", status="running", api_calls=0,
                         upserted=0, deleted=0,
                         started_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)))
        await db.commit()
    fake = seed(FakeSalesforce())
    await run_sync(sessions, trigger="schedule", client_factory=_factory(fake))
    async with sessions() as db:
        stale = await db.get(m.SfSyncRun, "cstalerun0000000000000000")
    assert stale.status == "error" and "time limit" in stale.error


def test_parsers():
    assert sync_module.parse_datetime("2026-10-10T03:28:25.000+0000") == dt.datetime(
        2026, 10, 10, 3, 28, 25, tzinfo=dt.timezone.utc)
    assert sync_module.parse_datetime(None) is None
    assert sync_module.parse_date("2026-09-25") == dt.date(2026, 9, 25)
    assert sync_module.parse_time("09:05:00.000Z") == "09:05"


async def _snapshot(sessions) -> dict[str, set[str]]:
    async with sessions() as db:
        return {model.__name__: set((await db.execute(select(model.id))).scalars())
                for model in (m.SfUser, m.SfOpportunity, m.SfCase, m.SfVisit, m.SfTouchpoint, m.SfAccount, m.SfContact)}


CHECKS_PER_RUN = 16  # ~ one page of real work per run once the empty steps are counted


async def _run_until_done(sessions, fake, monkeypatch, *, full: bool = False, max_runs: int = 80) -> list[str]:
    """Run again and again, each run cut off after CHECKS_PER_RUN time checks, until one finishes.

    A zero time budget can't be used: an up-to-date step still checks the clock
    once, so every run would stop at the first step. Counting checks instead
    stops runs at varying points in the middle of the copy.
    """
    def limited_check(self):
        self._checks = getattr(self, "_checks", 0) + 1
        if self._checks > CHECKS_PER_RUN:
            raise sync_module._OutOfTime()

    monkeypatch.setattr(sync_module.SalesforceSync, "_check_time", limited_check)
    statuses: list[str] = []
    for i in range(max_runs):
        # A clock after every fake timestamp, so nothing is "too recent to trust".
        result = await run_sync(sessions, trigger="schedule", client_factory=_factory(fake),
                                full=full and i == 0, now=lambda: dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc))
        statuses.append(result.status)
        if result.status != "partial":
            return statuses
    raise AssertionError(f"never finished: {statuses[-5:]}")


async def test_runs_cut_off_mid_copy_end_with_the_same_copy(sessions, monkeypatch):
    # Reference: one uninterrupted run.
    await run_sync(sessions, trigger="schedule", client_factory=_factory(seed(FakeSalesforce())))
    expected = await _snapshot(sessions)
    tables = ", ".join(f'{qualified("salesforce")}."{t}"' for t in TABLES)
    async with sessions() as db:
        await db.execute(text(f"TRUNCATE {tables}"))
        await db.commit()

    statuses = await _run_until_done(sessions, seed(FakeSalesforce()), monkeypatch)
    assert statuses[0] == "partial" and statuses[-1] == "success"
    assert await _snapshot(sessions) == expected


async def test_contacts_of_a_backfilled_account_arrive_even_when_runs_are_cut_off(sessions, monkeypatch):
    fake = seed(FakeSalesforce())
    await run_sync(sessions, trigger="schedule", client_factory=_factory(fake))
    # A brand-new deal on an old, never-copied restaurant with an old contact.
    fake.add("Account", Id="001000000000000A09", Name="Old Pho Place", Type=None, Phone=None, Website=None,
             BillingStreet=None, BillingCity=None, BillingState=None, BillingPostalCode=None,
             OwnerId="005000000000000AAA", CreatedDate=stamp(1), LastModifiedDate="2025-01-01T00:00:00.000+0000",
             SystemModstamp="2025-01-01T00:00:00.000+0000")
    fake.add("Contact", Id="003000000000000A09", AccountId="001000000000000A09", Name="Pho Owner", FirstName=None,
             LastName="Owner", Title=None, Email=None, Phone=None, MobilePhone=None, OwnerId="005000000000000AAA",
             SystemModstamp="2025-01-01T00:00:00.000+0000")
    fake.add("Opportunity", Id="006000000000000O09", Name="Pho POS", AccountId="001000000000000A09",
             OwnerId="005000000000000AAA", StageName="Prospecting", Amount=100, CloseDate="2026-11-30",
             Probability=10, IsClosed=False, IsWon=False, RecordTypeId=None, RecordType=None, Type=None,
             LeadSource=None, LastActivityDate=None, CreatedDate=stamp(12), LastModifiedDate=stamp(12),
             SystemModstamp=stamp(12))

    await _run_until_done(sessions, fake, monkeypatch)
    async with sessions() as db:
        account = await db.get(m.SfAccount, "001000000000000A09")
        assert account is not None and account.contacts_fetched_at is not None
        assert await db.get(m.SfContact, "003000000000000A09") is not None


async def test_full_recopy_removes_records_salesforce_no_longer_has(sessions, monkeypatch):
    fake = seed(FakeSalesforce())
    await run_sync(sessions, trigger="schedule", client_factory=_factory(fake))
    # Deleted in Salesforce long ago, outside anything the deleted-list would still report.
    fake.records["Opportunity"] = [r for r in fake.records["Opportunity"] if r["Id"] != "006000000000000O05"]

    statuses = await _run_until_done(sessions, fake, monkeypatch, full=True)
    assert statuses[-1] == "success"
    async with sessions() as db:
        assert await db.get(m.SfOpportunity, "006000000000000O05") is None
        assert await db.get(m.SfOpportunity, "006000000000000O01") is not None
        states = (await db.execute(select(m.SfSyncState))).scalars().all()
    # Per-source positions exist and every tracked object had its deletion check.
    assert any("|" in s.object_name for s in states)
    assert all(s.deleted_checked_at is not None for s in states
               if s.object_name in {"Opportunity", "Case", "Account", "Contact"})
