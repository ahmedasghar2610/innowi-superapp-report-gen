"""A tiny in-memory Salesforce for the sync tests.

It answers the two REST calls the client makes (query + deleted) and the OAuth
token request, through httpx.MockTransport - so the real SalesforceClient code
runs end to end. It understands just the SOQL the sync writes:

  SELECT <fields> FROM <Object> [WHERE <conditions>] [ORDER BY SystemModstamp ASC, Id ASC]

with conditions joined by AND:
  * SystemModstamp >= 2026-10-11T00:00:00Z
  * (SystemModstamp > 2026-10-11T00:00:00Z OR (SystemModstamp = 2026-10-11T00:00:00Z AND Id > '006...'))
  * Id IN ('a', 'b')            /  AccountId IN ('a', 'b')
  * Id IN (SELECT AccountId FROM Opportunity)  /  AccountId IN (SELECT Account__c FROM Innowi_Task__c)
  * UserType IN ('Standard', 'PowerPartner')
Nested fields (Profile.Name, RecordType.Name) are stored nested, as Salesforce returns them.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Any, Optional
from urllib.parse import parse_qs, unquote, urlsplit

import httpx

PAGE_SIZE = 2  # small, so paging is exercised


def stamp(day: int, hour: int = 0) -> str:
    return f"2026-10-{day:02d}T{hour:02d}:00:00.000+0000"


class FakeSalesforce:
    def __init__(self) -> None:
        self.records: dict[str, list[dict[str, Any]]] = {}
        self.deleted: dict[str, list[str]] = {}
        self.requests: list[str] = []
        self.fail_objects: set[str] = set()
        # Fields the "integration user" may not read: a query naming one gets INVALID_FIELD.
        self.refused_fields: set[str] = set()
        self.token_requests = 0
        self._cursors: dict[str, list[dict]] = {}

    # ---------------------------------------------------------- data ----
    def add(self, obj: str, **record: Any) -> dict:
        self.records.setdefault(obj, []).append(record)
        return record

    def find(self, obj: str, record_id: str) -> dict:
        return next(r for r in self.records[obj] if r["Id"] == record_id)

    def delete(self, obj: str, record_id: str) -> None:
        self.records[obj] = [r for r in self.records[obj] if r["Id"] != record_id]
        self.deleted.setdefault(obj, []).append(record_id)

    # ---------------------------------------------------------- http ----
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        url = urlsplit(str(request.url))
        if url.path.endswith("/services/oauth2/token"):
            self.token_requests += 1
            form = parse_qs(request.content.decode())
            if form.get("client_secret") != ["secret"]:
                return httpx.Response(400, json={"error": "invalid_client", "error_description": "bad secret"})
            return httpx.Response(200, json={"access_token": "tok", "instance_url": "https://fake.my.salesforce.com"})
        self.requests.append(str(request.url))
        if "/query/" in url.path and url.path.rsplit("/", 1)[-1].startswith("cursor-"):
            return self._next_page(url.path.rsplit("/", 1)[-1])
        if url.path.endswith("/query"):
            soql = unquote(parse_qs(url.query)["q"][0])
            return self._query(soql)
        match = re.search(r"/sobjects/([^/]+)/deleted/", url.path)
        if match:
            obj = match.group(1)
            if obj in self.fail_objects:
                return httpx.Response(400, json=[{"errorCode": "INVALID_TYPE", "message": f"{obj} broken"}])
            return httpx.Response(200, json={"deletedRecords": [{"id": i} for i in self.deleted.get(obj, [])]})
        return httpx.Response(404, json=[{"errorCode": "NOT_FOUND", "message": url.path}])

    def _page(self, rows: list[dict], key: str) -> httpx.Response:
        head, rest = rows[:PAGE_SIZE], rows[PAGE_SIZE:]
        body: dict[str, Any] = {"totalSize": len(rows), "done": not rest, "records": head}
        if rest:
            self._cursors[key] = rest
            body["nextRecordsUrl"] = f"/services/data/v62.0/query/{key}"
        return httpx.Response(200, json=body)

    def _next_page(self, key: str) -> httpx.Response:
        rows = self._cursors.pop(key)
        return self._page(rows, f"cursor-{len(self.requests)}")

    def _query(self, soql: str) -> httpx.Response:
        match = re.match(r"SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY .+)?$", soql, re.DOTALL)
        assert match, soql
        fields = [f.strip() for f in match.group(1).split(",")]
        obj, where = match.group(2), match.group(3)
        if obj in self.fail_objects:
            return httpx.Response(400, json=[{"errorCode": "INVALID_FIELD", "message": f"{obj} broken"}])
        refused = [f for f in fields if f in self.refused_fields]
        if refused:
            return httpx.Response(400, json=[{"errorCode": "INVALID_FIELD", "message": f"No such column '{refused[0]}'"}])
        rows = list(self.records.get(obj, []))
        for condition in _split_and(where or ""):
            rows = [r for r in rows if self._matches(r, condition)]
        rows.sort(key=lambda r: (_parse(r.get("SystemModstamp")), r.get("Id") or ""))
        projected = [{f.split(".")[0]: r.get(f.split(".")[0]) for f in fields} for r in rows]
        return self._page(projected, f"cursor-{len(self.requests)}")

    def _matches(self, record: dict, condition: str) -> bool:
        condition = condition.strip()
        m = re.match(r"\(SystemModstamp > (\S+) OR \(SystemModstamp = (\S+) AND Id > '([^']+)'\)\)$", condition)
        if m:
            after = dt.datetime.fromisoformat(m.group(1).replace("Z", "+00:00"))
            stamp_ = _parse(record.get("SystemModstamp"))
            return stamp_ > after or (stamp_ == after and (record.get("Id") or "") > m.group(3))
        m = re.match(r"SystemModstamp >= (\S+)$", condition)
        if m:
            since = dt.datetime.fromisoformat(m.group(1).replace("Z", "+00:00"))
            return _parse(record.get("SystemModstamp")) >= since
        m = re.match(r"(\w+) IN \(SELECT (\w+) FROM (\w+)\)$", condition)
        if m:
            field, source_field, source = m.groups()
            linked = {r.get(source_field) for r in self.records.get(source, [])}
            return record.get(field) in linked
        m = re.match(r"(\w+) IN \((.+)\)$", condition)
        if m:
            field, values = m.groups()
            allowed = {v.strip().strip("'") for v in values.split(",")}
            return record.get(field) in allowed
        raise AssertionError(f"fake SOQL can't read: {condition}")


def _split_and(where: str) -> list[str]:
    """Split on top-level AND only (not the one inside the position condition's parentheses)."""
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(where):
        depth += ch == "("
        depth -= ch == ")"
        if depth == 0 and where.startswith(" AND ", i):
            parts.append(where[start:i])
            start = i + len(" AND ")
    parts.append(where[start:])
    return [p.strip() for p in parts if p.strip()]


def _parse(value: Optional[str]) -> dt.datetime:
    value = (value or "2000-01-01T00:00:00.000+0000").replace("+0000", "+00:00")
    return dt.datetime.fromisoformat(value)


def seed(fake: FakeSalesforce) -> FakeSalesforce:
    """A small org shaped like innowi33: two reps, a field engineer, a support agent."""
    fake.add("User", Id="005000000000000ADM", Name="Shayan Toor", Email="shayantoor@innowi.com", Username="s@x",
             IsActive=True, Profile={"Name": "System Administrator"}, UserRole=None, UserType="Standard",
             LastLoginDate=stamp(11), SystemModstamp=stamp(1))
    fake.add("User", Id="005000000000000AAA", Name="Adam Smith", Email="adam.smith@innowi.com", Username="a@x",
             IsActive=True, Profile={"Name": "Innowi Partner Community User"},
             UserRole={"Name": "Innowi Partner Account Partner User"}, UserType="PowerPartner",
             LastLoginDate=stamp(9), SystemModstamp=stamp(1))
    fake.add("User", Id="005000000000000BBB", Name="Freddie Williams", Email="freddie.williams@innowi.com",
             Username="f@x", IsActive=True, Profile={"Name": "Innowi Partner Community User"}, UserRole=None,
             UserType="PowerPartner", LastLoginDate=stamp(10), SystemModstamp=stamp(1))
    fake.add("User", Id="005000000000000FSE", Name="Saad Ahmed", Email="saad.ahmed@innowi.com", Username="sa@x",
             IsActive=True, Profile={"Name": "Innowi Partner Community User"}, UserRole=None,
             UserType="PowerPartner", LastLoginDate=stamp(10), SystemModstamp=stamp(1))
    fake.add("User", Id="005000000000000SUP", Name="Manal Kakar", Email="manal@innowi.com", Username="m@x",
             IsActive=True, Profile={"Name": "Standard User Custom"}, UserRole=None, UserType="Standard",
             LastLoginDate=stamp(11), SystemModstamp=stamp(1))
    fake.add("User", Id="005000000000000GST", Name="Site Guest", Email=None, Username="g@x", IsActive=True,
             Profile={"Name": "Guest"}, UserRole=None, UserType="Guest", LastLoginDate=None, SystemModstamp=stamp(1))

    for label, order, active, closed, won in [
        ("Prospecting", 1, True, False, False), ("Appointment Set", 3, True, False, False),
        ("Order Form Completed", 7, True, False, False), ("60/90 days follow up", 9, True, True, False),
        ("DNC", 10, True, True, False), ("Closed - Won", 13, True, True, True),
        ("Live", None, False, True, True), ("Menu Created", None, False, False, False),
        ("Incubation", None, False, False, False),
    ]:
        fake.add("OpportunityStage", MasterLabel=label, SortOrder=order, IsActive=active, IsClosed=closed,
                 IsWon=won, DefaultProbability=10)

    accounts = [
        ("001000000000000A01", "Tolin's Tacos", "005000000000000BBB"),
        ("001000000000000A02", "Casa Mia", "005000000000000AAA"),
        ("001000000000000A03", "Kantipur Cafe", "005000000000000AAA"),
        ("001000000000000A04", "Husky Boy Burgers", "005000000000000ADM"),
        ("001000000000000A05", "Cold Import Diner", "005000000000000ADM"),  # nothing links to it
    ]
    for account_id, name, owner in accounts:
        fake.add("Account", Id=account_id, Name=name, Type=None, Phone="555", Website=None, BillingStreet=None,
                 BillingCity="Los Angeles", BillingState="CA", BillingPostalCode=None, OwnerId=owner,
                 CreatedDate=stamp(1), LastModifiedDate=stamp(1), SystemModstamp=stamp(1))
        fake.add("Contact", Id="003" + account_id[3:], AccountId=account_id, Name=f"Owner of {name}",
                 FirstName=None, LastName="Owner", Title="Owner", Email=None, Phone="555", MobilePhone=None,
                 OwnerId=owner, SystemModstamp=stamp(1))

    def opp(i: int, account: str, owner: str, stage: str, closed=False, won=False, modified=stamp(5)):
        fake.add("Opportunity", Id=f"006000000000000O{i:02d}", Name=f"Deal {i}", AccountId=account, OwnerId=owner,
                 StageName=stage, Amount=100 * i, CloseDate="2026-10-30", Probability=10, IsClosed=closed,
                 IsWon=won, RecordTypeId=None, RecordType=None, Type=None, LeadSource="Advertisement",
                 LastActivityDate=None, CreatedDate=stamp(2), LastModifiedDate=modified, SystemModstamp=modified)

    opp(1, "001000000000000A01", "005000000000000BBB", "Order Form Completed")
    opp(2, "001000000000000A02", "005000000000000AAA", "Appointment Set")
    opp(3, "001000000000000A02", "005000000000000AAA", "Live", closed=True, won=True)
    opp(4, "001000000000000A03", "005000000000000AAA", "Menu Created")
    opp(5, "001000000000000A03", "005000000000000AAA", "Submitted to Elavon")  # stage not in the stage list
    fake.add("Case", Id="500000000000000C01", CaseNumber="00005643", Subject="Printer down", Status="Open",
             Origin="WhatsApp", Priority="Medium", AccountId="001000000000000A02", ContactId=None,
             OwnerId="005000000000000SUP", IsClosed=False, CreatedDate=stamp(10), ClosedDate=None,
             SystemModstamp=stamp(10))
    fake.add("Innowi_Task__c", Id="a0O00000000000V001", Name="IT-0004008", Account__c="001000000000000A04",
             Account_Name__c="Husky Boy Burgers", OwnerId="005000000000000FSE", Visit_Type__c="Wellness/Remotely",
             Status__c="Pending", Sales_Agent__c=None, Address__c="802 PCH, Laguna Beach",
             Due_Date_Start__c="2026-10-11", Due_Date_End__c="2026-10-21", Appointment_Time__c="14:30:00.000Z",
             Completed_Date__c=None, CreatedDate=stamp(11), SystemModstamp=stamp(11))
    fake.add("Touchpoint_History__c", Id="a0F00000000000T001", Name="TP-0000657", Account__c="001000000000000A02",
             OwnerId="005000000000000FSE", Health_Status__c="Red", Latest_Status__c="Not answering",
             Latest_Touchpoint_Date__c="2026-10-05", SystemModstamp=stamp(8))
    return fake
