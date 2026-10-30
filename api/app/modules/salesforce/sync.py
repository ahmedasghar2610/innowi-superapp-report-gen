"""Copy Salesforce records into the `salesforce` schema.

One run, in order:
  1. Users              - changed since the last run (no deletions: users are deactivated, not deleted)
  2. Opportunity stages - the whole list every time (it is ~40 rows)
  3. Opportunities, Cases, Visits (Innowi_Task__c), Touchpoints - changed since the last run
  4. Accounts           - changed ones that have a deal/case/visit/touchpoint, then any account a
                          copied record points at that the copy is still missing
  5. Contacts           - changed ones on those accounts, plus every contact of any account whose
                          contacts haven't been fetched yet (account.contacts_fetched_at IS NULL)
  6. Deletions          - at most hourly: Salesforce's "deleted records" list for each object (it
                          keeps 30 days). The first check of an object, and any gap longer than
                          that, reconciles the copy against Salesforce's full id list instead.

"Changed since" uses SystemModstamp, Salesforce's own last-change timestamp. The
saved position is the (SystemModstamp, Id) of the last record copied and the next
query asks for records strictly after it, so progress is guaranteed even when
thousands of records share one timestamp; the position stays a couple of minutes
behind "now" (SETTLE) so late-committed changes aren't skipped. Upserts make
repeats harmless. Progress is saved after every page, so a run that hits its time
budget (serverless functions have a hard limit) is picked up by the next one.

Accounts and contacts are fetched through four "linked to" queries (one per
source object), each with its own saved position ("Account|Opportunity", ...),
so a long first copy also moves forward run by run.

A "full" run clears every saved position and deletion check, then runs like any
other: if it stops part-way, the following runs carry on from where it got to.

Only one run happens at a time (a Postgres advisory lock); a second request
while one is running is recorded as "skipped".
"""
from __future__ import annotations

import datetime as dt
import logging
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Awaitable, Callable, Iterable, Optional

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import salesforce as m
from app.modules.salesforce.client import (
    SalesforceClient,
    SalesforceConfig,
    SalesforceError,
    SalesforceNotConfigured,
    soql_datetime,
    soql_quote,
)

logger = logging.getLogger("salesforce.sync")

# pg_try_advisory_lock key: any constant unique to this job ("SFSYNC" in ASCII).
LOCK_KEY = 0x5346_5359_4E43
# Salesforce keeps deleted-record ids for 30 days; stay safely inside that.
DELETED_WINDOW = dt.timedelta(days=29)
# The saved position never moves closer than this to "now": records committed a
# moment late with a slightly earlier SystemModstamp are still picked up, at the
# cost of re-reading the last couple of minutes of changes on the next run.
SETTLE = dt.timedelta(minutes=2)
# Deleted-record checks cost one API call per object, so they run at most hourly.
DELETED_CHECK_EVERY = dt.timedelta(hours=1)
# A run still "running" after this long died without finishing (e.g. the function timed out).
STALE_RUN_AFTER = dt.timedelta(minutes=20)
UPSERT_BATCH = 500
ID_BATCH = 200

# Saved-position rows for the linked queries are named "<Object>|<Source>"; the
# Sync screen hides them (they are internal bookkeeping).
SOURCE_STATE_SEP = "|"

# The four places a restaurant can be referenced from - the accounts worth copying.
ACCOUNT_SOURCES = (
    ("Opportunity", "AccountId"),
    ("Case", "AccountId"),
    ("Innowi_Task__c", "Account__c"),
    ("Touchpoint_History__c", "Account__c"),
)


# ------------------------------------------------------------ parsing ----
def parse_datetime(value: Optional[str]) -> Optional[dt.datetime]:
    """Salesforce datetimes look like 2026-10-10T03:28:25.000+0000."""
    if not value:
        return None
    value = value.replace("Z", "+00:00")
    if len(value) >= 5 and value[-5] in "+-" and value[-3] != ":":
        value = value[:-2] + ":" + value[-2:]
    return dt.datetime.fromisoformat(value)


def parse_date(value: Optional[str]) -> Optional[dt.date]:
    return dt.date.fromisoformat(value[:10]) if value else None


def parse_time(value: Optional[str]) -> Optional[str]:
    """Salesforce Time fields look like 14:30:00.000Z; keep HH:MM."""
    return value[:5] if value else None


def parse_decimal(value: Any) -> Optional[Decimal]:
    return None if value is None else Decimal(str(value))


def _nested(record: dict, *path: str) -> Any:
    for key in path:
        if not isinstance(record, dict):
            return None
        record = record.get(key)  # type: ignore[assignment]
    return record


# --------------------------------------------------------------- specs ----
@dataclass(frozen=True)
class ObjectSpec:
    """One Salesforce object the sync copies."""

    name: str                       # Salesforce API name, also the sync_state key
    model: type                     # target table
    fields: str                     # SOQL select list
    to_row: Callable[[dict], dict]  # Salesforce record -> table row
    where: str = ""                 # extra SOQL filter, without "WHERE"
    track_deletes: bool = True
    # Custom fields the sync's Salesforce login might not be allowed to read. If Salesforce
    # refuses them (INVALID_FIELD), the object is copied without them rather than not at all.
    optional_fields: str = ""
    optional_columns: tuple[str, ...] = ()  # the table columns those fields fill (left alone without them)


def _user_row(r: dict) -> dict:
    return {
        "id": r["Id"], "name": r.get("Name") or r["Id"], "email": r.get("Email"), "username": r.get("Username"),
        "is_active": bool(r.get("IsActive")), "profile_name": _nested(r, "Profile", "Name"),
        "role_name": _nested(r, "UserRole", "Name"), "user_type": r.get("UserType"),
        "last_login_at": parse_datetime(r.get("LastLoginDate")),
        "sf_system_modstamp": parse_datetime(r.get("SystemModstamp")),
    }


def _opportunity_row(r: dict) -> dict:
    return {
        "id": r["Id"], "name": r.get("Name") or "(no name)", "account_id": r.get("AccountId"),
        "owner_id": r.get("OwnerId"), "stage_name": r.get("StageName") or "",
        "amount": parse_decimal(r.get("Amount")), "close_date": parse_date(r.get("CloseDate")),
        "probability": parse_decimal(r.get("Probability")), "is_closed": bool(r.get("IsClosed")),
        "is_won": bool(r.get("IsWon")), "record_type_id": r.get("RecordTypeId"),
        "record_type_name": _nested(r, "RecordType", "Name"), "type": r.get("Type"),
        "lead_source": r.get("LeadSource"), "last_activity_date": parse_date(r.get("LastActivityDate")),
        "sf_created_at": parse_datetime(r.get("CreatedDate")),
        "sf_last_modified_at": parse_datetime(r.get("LastModifiedDate")),
        "sf_system_modstamp": parse_datetime(r.get("SystemModstamp")),
    }


def _case_row(r: dict) -> dict:
    return {
        "id": r["Id"], "case_number": r.get("CaseNumber"), "subject": r.get("Subject"), "status": r.get("Status"),
        "origin": r.get("Origin"), "priority": r.get("Priority"), "account_id": r.get("AccountId"),
        "contact_id": r.get("ContactId"), "owner_id": r.get("OwnerId"), "is_closed": bool(r.get("IsClosed")),
        "sf_created_at": parse_datetime(r.get("CreatedDate")), "sf_closed_at": parse_datetime(r.get("ClosedDate")),
        "sf_system_modstamp": parse_datetime(r.get("SystemModstamp")),
        # Care team's own fields: what the issue is about, which team it went to, how it was fixed.
        "issue_category": r.get("Issue_Category__c"), "assigned_team": r.get("Case_Assigned_To__c"),
        "resolution_type": r.get("Resolution_Type__c"), "caller_type": r.get("Caller_Type__c"),
        "details": r.get("Details__c"),
    }


def _visit_row(r: dict) -> dict:
    return {
        "id": r["Id"], "name": r.get("Name"), "account_id": r.get("Account__c"),
        "account_name": r.get("Account_Name__c"), "owner_id": r.get("OwnerId"),
        "visit_type": r.get("Visit_Type__c"), "status": r.get("Status__c"), "sales_agent": r.get("Sales_Agent__c"),
        "address": r.get("Address__c"), "due_date_start": parse_date(r.get("Due_Date_Start__c")),
        "due_date_end": parse_date(r.get("Due_Date_End__c")), "appointment_time": parse_time(r.get("Appointment_Time__c")),
        "completed_date": parse_date(r.get("Completed_Date__c")), "sf_created_at": parse_datetime(r.get("CreatedDate")),
        "sf_system_modstamp": parse_datetime(r.get("SystemModstamp")),
    }


def _touchpoint_row(r: dict) -> dict:
    return {
        "id": r["Id"], "name": r.get("Name"), "account_id": r.get("Account__c"), "owner_id": r.get("OwnerId"),
        "health_status": r.get("Health_Status__c"), "latest_status": r.get("Latest_Status__c"),
        "latest_touchpoint_date": parse_date(r.get("Latest_Touchpoint_Date__c")),
        "sf_system_modstamp": parse_datetime(r.get("SystemModstamp")),
    }


def _account_row(r: dict) -> dict:
    return {
        "id": r["Id"], "name": r.get("Name") or "(no name)", "type": r.get("Type"), "phone": r.get("Phone"),
        "website": r.get("Website"), "billing_street": r.get("BillingStreet"), "billing_city": r.get("BillingCity"),
        "billing_state": r.get("BillingState"), "billing_postal_code": r.get("BillingPostalCode"),
        "owner_id": r.get("OwnerId"), "sf_created_at": parse_datetime(r.get("CreatedDate")),
        "sf_last_modified_at": parse_datetime(r.get("LastModifiedDate")),
        "sf_system_modstamp": parse_datetime(r.get("SystemModstamp")),
    }


def _contact_row(r: dict) -> dict:
    name = r.get("Name") or " ".join(p for p in (r.get("FirstName"), r.get("LastName")) if p) or "(no name)"
    return {
        "id": r["Id"], "account_id": r.get("AccountId"), "name": name, "title": r.get("Title"),
        "email": r.get("Email"), "phone": r.get("Phone"), "mobile_phone": r.get("MobilePhone"),
        "owner_id": r.get("OwnerId"), "sf_system_modstamp": parse_datetime(r.get("SystemModstamp")),
    }


USERS = ObjectSpec(
    "User", m.SfUser,
    "Id, Name, Email, Username, IsActive, Profile.Name, UserRole.Name, UserType, LastLoginDate, SystemModstamp",
    _user_row, where="UserType IN ('Standard', 'PowerPartner')", track_deletes=False,
)
OPPORTUNITIES = ObjectSpec(
    "Opportunity", m.SfOpportunity,
    "Id, Name, AccountId, OwnerId, StageName, Amount, CloseDate, Probability, IsClosed, IsWon, RecordTypeId, "
    "RecordType.Name, Type, LeadSource, LastActivityDate, CreatedDate, LastModifiedDate, SystemModstamp",
    _opportunity_row,
)
CASES = ObjectSpec(
    "Case", m.SfCase,
    "Id, CaseNumber, Subject, Status, Origin, Priority, AccountId, ContactId, OwnerId, IsClosed, CreatedDate, "
    "ClosedDate, SystemModstamp",
    _case_row,
    optional_fields="Issue_Category__c, Case_Assigned_To__c, Resolution_Type__c, Caller_Type__c, Details__c",
    optional_columns=("issue_category", "assigned_team", "resolution_type", "caller_type", "details"),
)
VISITS = ObjectSpec(
    "Innowi_Task__c", m.SfVisit,
    "Id, Name, Account__c, Account_Name__c, OwnerId, Visit_Type__c, Status__c, Sales_Agent__c, Address__c, "
    "Due_Date_Start__c, Due_Date_End__c, Appointment_Time__c, Completed_Date__c, CreatedDate, SystemModstamp",
    _visit_row,
)
TOUCHPOINTS = ObjectSpec(
    "Touchpoint_History__c", m.SfTouchpoint,
    "Id, Name, Account__c, OwnerId, Health_Status__c, Latest_Status__c, Latest_Touchpoint_Date__c, SystemModstamp",
    _touchpoint_row,
)
ACCOUNTS = ObjectSpec(
    "Account", m.SfAccount,
    "Id, Name, Type, Phone, Website, BillingStreet, BillingCity, BillingState, BillingPostalCode, OwnerId, "
    "CreatedDate, LastModifiedDate, SystemModstamp",
    _account_row,
)
CONTACTS = ObjectSpec(
    "Contact", m.SfContact,
    "Id, AccountId, Name, FirstName, LastName, Title, Email, Phone, MobilePhone, OwnerId, SystemModstamp",
    _contact_row,
)
CHILD_OBJECTS = (OPPORTUNITIES, CASES, VISITS, TOUCHPOINTS)
ALL_OBJECTS = (USERS, *CHILD_OBJECTS, ACCOUNTS, CONTACTS)
STAGES_STATE = "OpportunityStage"


# ------------------------------------------------------------- results ----
@dataclass
class ObjectResult:
    upserted: int = 0
    deleted: int = 0
    done: bool = False
    error: Optional[str] = None
    note: Optional[str] = None  # worked, with a caveat (e.g. optional fields left out)


@dataclass
class SyncResult:
    run_id: Optional[str]
    status: str
    api_calls: int = 0
    upserted: int = 0
    deleted: int = 0
    objects: dict[str, ObjectResult] = field(default_factory=dict)
    error: Optional[str] = None

    def as_details(self) -> dict:
        return {name: {"upserted": r.upserted, "deleted": r.deleted, "done": r.done, "error": r.error,
                       **({"note": r.note} if r.note else {})}
                for name, r in self.objects.items()}


class _OutOfTime(Exception):
    """The run's time budget is used up; the next run continues from the saved cursor."""


ClientFactory = Callable[[], SalesforceClient]


def default_client_factory() -> SalesforceClient:
    return SalesforceClient(SalesforceConfig.from_settings())


# -------------------------------------------------------------- runner ----
class SalesforceSync:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        client: SalesforceClient,
        *,
        full: bool = False,
        time_budget_s: Optional[float] = None,
        now: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.timezone.utc),
    ) -> None:
        self.sessions = session_factory
        self.client = client
        self.full = full
        self.budget = time_budget_s if time_budget_s is not None else get_settings().SALESFORCE_SYNC_TIME_BUDGET_S
        self.now = now
        self._started = time.monotonic()
        self._position_cap = self.now() - SETTLE
        self.result = SyncResult(run_id=None, status="running")

    # --- helpers ----------------------------------------------------------
    def _check_time(self) -> None:
        if time.monotonic() - self._started > self.budget:
            raise _OutOfTime()

    def _obj(self, name: str) -> ObjectResult:
        return self.result.objects.setdefault(name, ObjectResult())

    async def _state(self, db: AsyncSession, name: str) -> m.SfSyncState:
        state = await db.get(m.SfSyncState, name)
        if state is None:
            state = m.SfSyncState(object_name=name, record_count=0)
            db.add(state)
            await db.flush()
        return state

    async def _upsert(self, db: AsyncSession, model: type, rows: list[dict], key: str = "id") -> int:
        if not rows:
            return 0
        # Last write wins when a page repeats an id (it can across overlapping queries).
        unique = list({row[key]: row for row in rows}.values())
        for start in range(0, len(unique), UPSERT_BATCH):
            chunk = unique[start:start + UPSERT_BATCH]
            stmt = pg_insert(model).values(chunk)
            columns = {c: stmt.excluded[c] for c in chunk[0] if c != key}
            columns["synced_at"] = func.now()
            await db.execute(stmt.on_conflict_do_update(index_elements=[key], set_=columns))
        return len(unique)

    def _soql(self, spec: ObjectSpec, state: m.SfSyncState, extra: str = "", *, optional: bool = True) -> str:
        """Records after the saved position, in (SystemModstamp, Id) order."""
        conditions = [c for c in (spec.where, extra) if c]
        if state.last_modstamp is not None:
            stamp = soql_datetime(state.last_modstamp)
            if state.last_id:
                conditions.append(f"(SystemModstamp > {stamp} OR "
                                  f"(SystemModstamp = {stamp} AND Id > {soql_quote(state.last_id)}))")
            else:
                conditions.append(f"SystemModstamp >= {stamp}")
        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        fields = f"{spec.fields}, {spec.optional_fields}" if optional and spec.optional_fields else spec.fields
        return f"SELECT {fields} FROM {spec.name}{where} ORDER BY SystemModstamp ASC, Id ASC"

    def _advance(self, state: m.SfSyncState, rows: list[dict]) -> None:
        """Move the saved position to the last record of a page (rows arrive in position order)."""
        last = next((r for r in reversed(rows) if r.get("sf_system_modstamp")), None)
        if last is None:
            return
        stamp, rid = last["sf_system_modstamp"], last["id"]
        if stamp > self._position_cap:
            # Too recent to trust as final; next run re-reads from the cap (inclusive).
            stamp, rid = self._position_cap, None
        current = (state.last_modstamp, state.last_id or "") if state.last_modstamp else None
        if current is None or (stamp, rid or "") > current:
            state.last_modstamp, state.last_id = stamp, rid

    async def _pages_with_fallback(self, spec: ObjectSpec, soql: str, plain: str):
        """Yields (page, with_optional): query_pages(soql), or query_pages(plain) when Salesforce
        won't let the sync read an optional field. Only the first page can fail that way (the
        query is checked up front)."""
        pages = self.client.query_pages(soql)
        try:
            first = await pages.__anext__()
        except StopAsyncIteration:
            return
        except SalesforceError as exc:
            if not spec.optional_fields or exc.code != "INVALID_FIELD":
                raise
            logger.warning("%s: optional fields refused (%s); copying without them", spec.name, exc)
            self._obj(spec.name).note = f"copied without {spec.optional_fields} (Salesforce refused them)"
            async with self.sessions() as db:
                (await self._state(db, spec.name)).optional_missing = True
                await db.commit()
            async for page in self.client.query_pages(plain):
                yield page, False
            return
        yield first, True
        async for page in pages:
            yield page, True

    # --- steps --------------------------------------------------------------
    async def _sync_incremental(self, spec: ObjectSpec) -> None:
        """Upsert records changed since the saved cursor, saving progress after every page."""
        result = self._obj(spec.name)
        async with self.sessions() as db:
            state = await self._state(db, spec.name)
            plain = self._soql(spec, state, optional=False)
            reread = bool(spec.optional_fields and state.optional_missing)
            if reread:
                # Rows copied while the optional fields were refused lack them: read the whole
                # object again with them. Only the query starts over; the saved position doesn't
                # move back, and the flag clears only once that re-read has gone all the way through.
                saved = (state.last_modstamp, state.last_id)
                state.last_modstamp, state.last_id = None, None
                soql = self._soql(spec, state)
                state.last_modstamp, state.last_id = saved
            else:
                soql = self._soql(spec, state)
            await db.commit()
        complete_with_optional = True
        async for page, with_optional in self._pages_with_fallback(spec, soql, plain):
            rows = [spec.to_row(r) for r in page]
            if not with_optional:
                complete_with_optional = False
                if spec.optional_columns:
                    # Without the fields, leave the stored values alone instead of writing NULLs.
                    rows = [{k: v for k, v in row.items() if k not in spec.optional_columns} for row in rows]
            async with self.sessions() as db:
                result.upserted += await self._upsert(db, spec.model, rows)
                self._advance(await self._state(db, spec.name), rows)
                await db.commit()
            self._check_time()
        if reread and complete_with_optional:
            async with self.sessions() as db:
                (await self._state(db, spec.name)).optional_missing = False
                await db.commit()

    async def _sync_stages(self) -> None:
        result = self._obj(STAGES_STATE)
        rows = [
            {"label": r["MasterLabel"], "sort_order": r.get("SortOrder"), "is_active": bool(r.get("IsActive")),
             "is_closed": bool(r.get("IsClosed")), "is_won": bool(r.get("IsWon")),
             "default_probability": parse_decimal(r.get("DefaultProbability"))}
            for r in await self.client.query_all(
                "SELECT MasterLabel, SortOrder, IsActive, IsClosed, IsWon, DefaultProbability FROM OpportunityStage"
            )
        ]
        async with self.sessions() as db:
            result.upserted = await self._upsert(db, m.SfOpportunityStage, rows, key="label")
            labels = [r["label"] for r in rows]
            if labels:
                gone = await db.execute(delete(m.SfOpportunityStage).where(m.SfOpportunityStage.label.not_in(labels)))
                result.deleted = gone.rowcount or 0
            await db.commit()

    async def _sync_linked(self, spec: ObjectSpec, id_field: str) -> None:
        """Accounts (id_field="Id") or contacts (id_field="AccountId") linked to a deal/case/visit/touchpoint.

        Each source query keeps its own position, saved after every page, so a
        run that runs out of time resumes inside the query it stopped in.
        """
        result = self._obj(spec.name)
        for source, source_field in ACCOUNT_SOURCES:
            state_name = f"{spec.name}{SOURCE_STATE_SEP}{source}"
            async with self.sessions() as db:
                soql = self._soql(spec, await self._state(db, state_name),
                                  f"{id_field} IN (SELECT {source_field} FROM {source})")
                await db.commit()
            async for page in self.client.query_pages(soql):
                rows = [spec.to_row(r) for r in page]
                async with self.sessions() as db:
                    result.upserted += await self._upsert(db, spec.model, rows)
                    self._advance(await self._state(db, state_name), rows)
                    # The object's own row is only shown on the Sync screen ("changes up to").
                    shown = await self._state(db, spec.name)
                    stamps = [r["sf_system_modstamp"] for r in rows if r.get("sf_system_modstamp")]
                    if stamps and (shown.last_modstamp is None or max(stamps) > shown.last_modstamp):
                        shown.last_modstamp = max(stamps)
                    await db.commit()
                self._check_time()

    async def _missing_account_ids(self) -> list[str]:
        """Accounts a copied deal/case/visit/touchpoint points at that the copy doesn't have yet."""
        async with self.sessions() as db:
            missing: set[str] = set()
            for model in (m.SfOpportunity, m.SfCase, m.SfVisit, m.SfTouchpoint):
                stmt = (
                    select(model.account_id).distinct()
                    .where(model.account_id.is_not(None))
                    .where(~select(m.SfAccount.id).where(m.SfAccount.id == model.account_id).exists())
                )
                missing.update(v for v in (await db.execute(stmt)).scalars() if v)
            return sorted(missing)

    async def _backfill_accounts(self) -> None:
        """Copy missing accounts by id (their contacts follow in the contacts step)."""
        result = self._obj(ACCOUNTS.name)
        missing = await self._missing_account_ids()
        for start in range(0, len(missing), ID_BATCH):
            ids = missing[start:start + ID_BATCH]
            soql = f"SELECT {ACCOUNTS.fields} FROM Account WHERE Id IN ({', '.join(soql_quote(i) for i in ids)})"
            rows = [ACCOUNTS.to_row(r) for r in await self.client.query_all(soql)]
            async with self.sessions() as db:
                result.upserted += await self._upsert(db, m.SfAccount, rows)
                await db.commit()
            self._check_time()

    async def _contacts_for_unfetched_accounts(self) -> None:
        """Every contact of accounts whose contacts were never fetched (new to the copy; their contacts may be old).

        The account is marked in the same commit as its contacts, so an
        interrupted run simply leaves the rest for the next one.
        """
        result = self._obj(CONTACTS.name)
        while True:
            async with self.sessions() as db:
                ids = list((await db.execute(
                    select(m.SfAccount.id).where(m.SfAccount.contacts_fetched_at.is_(None))
                    .order_by(m.SfAccount.id).limit(ID_BATCH)
                )).scalars())
            if not ids:
                return
            soql = f"SELECT {CONTACTS.fields} FROM Contact WHERE AccountId IN ({', '.join(soql_quote(i) for i in ids)})"
            rows = [CONTACTS.to_row(r) for r in await self.client.query_all(soql)]
            async with self.sessions() as db:
                result.upserted += await self._upsert(db, m.SfContact, rows)
                await db.execute(update(m.SfAccount).where(m.SfAccount.id.in_(ids)).values(contacts_fetched_at=self.now()))
                await db.commit()
            self._check_time()

    async def _sync_deletions(self, spec: ObjectSpec) -> None:
        result = self._obj(spec.name)
        now = self.now()
        async with self.sessions() as db:
            state = await self._state(db, spec.name)
            checked = state.deleted_checked_at
            await db.commit()
        if checked is not None and now - checked < DELETED_CHECK_EVERY:
            return
        if checked is None or now - checked >= DELETED_WINDOW:
            # First check (a new or fully re-copied object - the copy may have been
            # built over several runs) or a gap the deleted list no longer covers:
            # compare against Salesforce's full id list.
            ids_to_delete = await self._ids_missing_from_salesforce(spec)
        else:
            # Salesforce wants a window of at least a minute.
            start = min(checked - dt.timedelta(minutes=1), now - dt.timedelta(minutes=2))
            ids_to_delete = await self.client.deleted_ids(spec.name, start, now)
        if ids_to_delete:
            async with self.sessions() as db:
                gone = await db.execute(delete(spec.model).where(spec.model.id.in_(ids_to_delete)))
                result.deleted += gone.rowcount or 0
                await db.commit()
        async with self.sessions() as db:
            state = await self._state(db, spec.name)
            state.deleted_checked_at = now
            await db.commit()

    async def _ids_missing_from_salesforce(self, spec: ObjectSpec) -> list[str]:
        """Full reconcile, used when the 30-day deleted list no longer covers the gap."""
        if spec is ACCOUNTS or spec is CONTACTS:
            id_field = "Id" if spec is ACCOUNTS else "AccountId"
            live: set[str] = set()
            for source, source_field in ACCOUNT_SOURCES:
                rows = await self.client.query_all(
                    f"SELECT Id FROM {spec.name} WHERE {id_field} IN (SELECT {source_field} FROM {source})")
                live.update(r["Id"] for r in rows)
        else:
            where = f" WHERE {spec.where}" if spec.where else ""
            live = {r["Id"] for r in await self.client.query_all(f"SELECT Id FROM {spec.name}{where}")}
        async with self.sessions() as db:
            local = set((await db.execute(select(spec.model.id))).scalars())
        return sorted(local - live)

    async def _finish_object(self, name: str, model: type) -> None:
        result = self._obj(name)
        result.done = result.error is None
        async with self.sessions() as db:
            state = await self._state(db, name)
            state.record_count = (await db.execute(select(func.count()).select_from(model))).scalar_one()
            if result.error:
                state.last_error = result.error
            else:
                state.last_error = None
                state.last_success_at = self.now()
            await db.commit()

    async def _step(self, name: str, model: type, work: Callable[[], Awaitable[None]]) -> None:
        """Run one object's work; a Salesforce error marks that object and lets the others go on."""
        try:
            await work()
        except _OutOfTime:
            raise
        except SalesforceError as exc:
            logger.warning("Salesforce sync of %s failed: %s", name, exc)
            self._obj(name).error = str(exc)[:1000]
        await self._finish_object(name, model)

    # --- the run ------------------------------------------------------------
    async def _reset_positions(self) -> None:
        """Full re-copy: forget every saved position and deletion check (the copied rows stay)."""
        async with self.sessions() as db:
            await db.execute(update(m.SfSyncState).values(last_modstamp=None, last_id=None, deleted_checked_at=None))
            await db.commit()

    async def run(self) -> SyncResult:
        await self.client.authenticate()
        if self.full:
            await self._reset_positions()

        async def child(spec: ObjectSpec) -> None:
            await self._sync_incremental(spec)
            if spec.track_deletes:
                await self._sync_deletions(spec)

        async def accounts() -> None:
            await self._sync_linked(ACCOUNTS, "Id")
            await self._backfill_accounts()
            await self._sync_deletions(ACCOUNTS)

        async def contacts() -> None:
            await self._sync_linked(CONTACTS, "AccountId")
            await self._contacts_for_unfetched_accounts()
            await self._sync_deletions(CONTACTS)

        await self._step(USERS.name, m.SfUser, lambda: self._sync_incremental(USERS))
        await self._step(STAGES_STATE, m.SfOpportunityStage, self._sync_stages)
        for spec in CHILD_OBJECTS:
            await self._step(spec.name, spec.model, lambda spec=spec: child(spec))
        await self._step(ACCOUNTS.name, m.SfAccount, accounts)
        await self._step(CONTACTS.name, m.SfContact, contacts)
        return self.result


async def run_sync(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    trigger: str,
    started_by: Optional[str] = None,
    full: bool = False,
    client_factory: ClientFactory = default_client_factory,
    time_budget_s: Optional[float] = None,
    now: Optional[Callable[[], dt.datetime]] = None,
) -> SyncResult:
    """Run one sync, recorded as a SyncRun row. Never raises for Salesforce problems.

    `now` is for tests (a fixed clock); production uses the real UTC time.
    """
    async with session_factory() as db:
        # A run that died mid-way (function killed at its time limit) stays
        # "running" forever otherwise; close it out so the history is honest.
        cutoff = dt.datetime.now(dt.timezone.utc) - STALE_RUN_AFTER
        await db.execute(
            update(m.SfSyncRun).where(m.SfSyncRun.status == "running", m.SfSyncRun.started_at < cutoff)
            .values(status="error", error="Stopped without finishing (likely hit the server time limit).",
                    finished_at=func.now())
        )
        await db.commit()

    async with session_factory() as lock_db:
        locked = (await lock_db.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_KEY})).scalar_one()
        try:
            async with session_factory() as db:
                run = m.SfSyncRun(trigger=trigger, started_by=started_by, status="running",
                                api_calls=0, upserted=0, deleted=0)
                db.add(run)
                await db.commit()
                run_id = run.id
            if not locked:
                return await _close_run(session_factory, run_id, SyncResult(
                    run_id=run_id, status="skipped", error="Another sync is already running."))
            try:
                client = client_factory()
            except SalesforceNotConfigured as exc:
                return await _close_run(session_factory, run_id, SyncResult(run_id=run_id, status="skipped", error=str(exc)))

            sync = SalesforceSync(session_factory, client, full=full, time_budget_s=time_budget_s,
                                  **({"now": now} if now is not None else {}))
            sync.result.run_id = run_id
            try:
                await sync.run()
                failed = [n for n, r in sync.result.objects.items() if r.error]
                sync.result.status = "error" if failed else "success"
                if failed:
                    sync.result.error = "Failed: " + ", ".join(failed)
            except _OutOfTime:
                sync.result.status = "partial"
                sync.result.error = "Time budget used up; the next run continues where this one stopped."
            except SalesforceError as exc:
                sync.result.status = "error"
                sync.result.error = str(exc)[:1000]
            except Exception as exc:
                sync.result.status = "error"
                sync.result.error = f"Unexpected error: {exc}"[:1000]
                await _close_run(session_factory, run_id, _totals(sync.result, client))
                await client.close()
                raise
            await client.close()
            return await _close_run(session_factory, run_id, _totals(sync.result, client))
        finally:
            if locked:
                await lock_db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
                await lock_db.commit()


def _totals(result: SyncResult, client: SalesforceClient) -> SyncResult:
    result.api_calls = client.api_calls
    result.upserted = sum(r.upserted for r in result.objects.values())
    result.deleted = sum(r.deleted for r in result.objects.values())
    return result


async def _close_run(session_factory: async_sessionmaker[AsyncSession], run_id: str, result: SyncResult) -> SyncResult:
    async with session_factory() as db:
        run = await db.get(m.SfSyncRun, run_id)
        if run is not None:
            run.status = result.status
            run.finished_at = dt.datetime.now(dt.timezone.utc)
            run.api_calls = result.api_calls
            run.upserted = result.upserted
            run.deleted = result.deleted
            run.details = result.as_details() or None
            run.error = result.error
            await db.commit()
    return result


def iter_chunks(items: list, size: int) -> Iterable[list]:
    for start in range(0, len(items), size):
        yield items[start:start + size]
