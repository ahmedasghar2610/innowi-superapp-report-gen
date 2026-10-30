"""
Port of prisma/import-xlsx.ts. Imports Merchant_Profile_System.xlsx -> Postgres.
Idempotent: re-running replaces a merchant's child rows. Merchants are matched
on "Merchant ID" (the workbook's own key, stored as merchant_code); a row
without one falls back to an exact Restaurant Name (DBA) match. Catalog
(Package/Service/Entitlement) must be seeded first (`python -m scripts.seed`).

Usage:
    python -m scripts.import_xlsx /path/to/Merchant_Profile_System.xlsx
    (or set XLSX_PATH; defaults to ./Merchant_Profile_System.xlsx)
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import openpyxl
from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.auth import User  # noqa: F401 ensure models package initialized
from app.models.boundary import DeliveryItem, Opportunity, Promotion
from app.models.boundary import Baseline, ScorecardEntry
from app.models.catalog import Entitlement, Service
from app.models.enums import (
    AccessCriticality,
    AccessFlag,
    AccessStatus,
    AccountHealth,
    ContactRole,
    DeliveryStatus,
    KeywordType,
    OpportunityStatus,
    PackageStatus,
    PreferredChannel,
    Priority,
    PromotionStatus,
    Responsiveness,
    YesNo,
)
from app.models.profiling import (
    AccessItem,
    AccountManager,
    BrandProfile,
    CateringProfile,
    Competitor,
    Contact,
    Keyword,
    Location,
    Merchant,
    Subscription,
)

BAD_RE = re.compile(r"^(confirm|on-?going|none|n/a|not advertised.*|null)?$", re.IGNORECASE)


def s(v: Any) -> Optional[str]:
    if v is None:
        return None
    text = str(v).strip()
    if text == "" or BAD_RE.match(text):
        return None
    return text


def num(v: Any) -> Optional[float]:
    text = s(v)
    if text is None:
        return None
    cleaned = re.sub(r"[^0-9.\-]", "", text)
    try:
        n = float(cleaned)
        return n
    except ValueError:
        return None


def as_int(v: Any) -> Optional[int]:
    n = num(v)
    return int(n) if n is not None else None


def as_bool(v: Any) -> Optional[bool]:
    text = s(v)
    if text is None:
        return None
    if re.match(r"^yes", text, re.IGNORECASE):
        return True
    if re.match(r"^no", text, re.IGNORECASE):
        return False
    return None


def yes_no(v: Any) -> Optional[YesNo]:
    text = s(v)
    if text is None:
        return None
    if re.match(r"^yes", text, re.IGNORECASE):
        return YesNo.YES
    if re.match(r"^no\b", text, re.IGNORECASE):
        return YesNo.NO
    if re.match(r"^partial", text, re.IGNORECASE):
        return YesNo.PARTIAL
    if re.match(r"^unknown", text, re.IGNORECASE):
        return YesNo.UNKNOWN
    return None


def as_date(v: Any) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v
    text = s(v)
    if text is None:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def split_list(v: Any) -> list[str]:
    text = s(v) or ""
    return [x.strip() for x in re.split(r"[;\n]", text) if x.strip()]


def map_enum(mapping: dict[str, Any], v: Any, fallback=None):
    text = s(v)
    if text is None:
        return fallback
    if text in mapping:
        return mapping[text]
    for key, val in mapping.items():
        if key.lower() == text.lower():
            return val
    return fallback


HEALTH = {"Green": AccountHealth.GREEN, "Yellow": AccountHealth.YELLOW, "Red": AccountHealth.RED}
PKG_STATUS = {
    "Onboarding": PackageStatus.ONBOARDING, "Active": PackageStatus.ACTIVE, "Paused": PackageStatus.PAUSED,
    "At Risk": PackageStatus.AT_RISK, "Churned": PackageStatus.CHURNED,
}
CRIT = {
    "Critical": AccessCriticality.CRITICAL, "Critical - Compliance": AccessCriticality.CRITICAL_COMPLIANCE,
    "High": AccessCriticality.HIGH, "Medium": AccessCriticality.MEDIUM, "Low": AccessCriticality.LOW,
}
ACC_STATUS = {
    "Not Requested": AccessStatus.NOT_REQUESTED, "Requested": AccessStatus.REQUESTED, "Received": AccessStatus.RECEIVED,
    "Verified": AccessStatus.VERIFIED, "Failed": AccessStatus.FAILED, "N/A": AccessStatus.NA,
}
ACC_FLAG = {"BLOCKER": AccessFlag.BLOCKER, "Open": AccessFlag.OPEN, "-": AccessFlag.NONE}
PROMO = {
    "Active": PromotionStatus.ACTIVE, "Scheduled": PromotionStatus.SCHEDULED, "Ended": PromotionStatus.ENDED,
    "Expired": PromotionStatus.EXPIRED, "No Promotion": PromotionStatus.NO_PROMOTION, "Draft": PromotionStatus.DRAFT,
}
OPP = {
    "Active": OpportunityStatus.ACTIVE, "Not Active": OpportunityStatus.NOT_ACTIVE,
    "Recommended": OpportunityStatus.RECOMMENDED, "Not Set Up": OpportunityStatus.NOT_SET_UP,
    "Declined": OpportunityStatus.DECLINED,
}
PRIO = {"High": Priority.HIGH, "Medium": Priority.MEDIUM, "Low": Priority.LOW}
DELIV = {
    "Not Started": DeliveryStatus.NOT_STARTED, "In Progress": DeliveryStatus.IN_PROGRESS,
    "Delivered": DeliveryStatus.DELIVERED, "Live": DeliveryStatus.LIVE, "Paused": DeliveryStatus.PAUSED,
    "Blocked": DeliveryStatus.BLOCKED, "Not Included": DeliveryStatus.NOT_INCLUDED,
}


def responsiveness_of(v: Any) -> Optional[Responsiveness]:
    text = (s(v) or "").lower()
    if "very slow" in text:
        return Responsiveness.VERY_SLOW
    if re.search(r"\bslow\b", text):
        return Responsiveness.SLOW
    if re.search(r"\bnormal\b", text):
        return Responsiveness.NORMAL
    if re.search(r"\bfast\b", text):
        return Responsiveness.FAST
    return None


def channel_of(v: Any) -> Optional[PreferredChannel]:
    text = (s(v) or "").lower()
    if "whatsapp" in text:
        return PreferredChannel.WHATSAPP
    if "email" in text:
        return PreferredChannel.EMAIL
    if "sms" in text:
        return PreferredChannel.SMS
    if "phone" in text:
        return PreferredChannel.PHONE
    return None


def is_real_merchant(name: Optional[str]) -> bool:
    if not name:
        return False
    if re.match(r"^example", name, re.IGNORECASE):
        return False
    if re.search(r"bella napoli", name, re.IGNORECASE):
        return False
    return True


def sheet_rows(wb, name: str) -> list[dict]:
    if name not in wb.sheetnames:
        return []
    ws = wb[name]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(h) if h is not None else "" for h in rows[0]]
    out = []
    for row in rows[1:]:
        out.append({headers[i]: row[i] if i < len(row) else None for i in range(len(headers))})
    return out


def index_by(rows: list[dict], key: str) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in rows:
        k = s(r.get(key))
        if not k:
            continue
        out.setdefault(k, []).append(r)
    return out


async def main() -> None:
    file_path = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("XLSX_PATH", "Merchant_Profile_System.xlsx")
    print(f"Reading {file_path}")
    wb = openpyxl.load_workbook(file_path, data_only=True)

    merchants_rows = sheet_rows(wb, "Merchants")
    access = index_by(sheet_rows(wb, "Access"), "Merchant")
    baselines = index_by(sheet_rows(wb, "Baselines"), "Merchant")
    promotions = index_by(sheet_rows(wb, "Promotions"), "Merchant")
    scorecard = index_by(sheet_rows(wb, "Scorecard"), "Merchant")
    opportunities = index_by(sheet_rows(wb, "Opportunities"), "Merchant")
    delivery = index_by(sheet_rows(wb, "Delivery"), "Merchant")

    async with SessionLocal() as db:
        services = (await db.execute(select(Service))).scalars().all()
        service_by_name = {svc.name: svc for svc in services}
        if not services:
            print("WARNING: Catalog empty — run `python -m scripts.seed` first (Delivery rows will be skipped).")

        imported = 0
        for row in merchants_rows:
            name = s(row.get("Restaurant Name (DBA)"))
            if not is_real_merchant(name):
                continue

            am_name = s(row.get("Account Manager"))
            am = None
            if am_name:
                email = f"{am_name.lower()}@innowi.local"
                result = await db.execute(select(AccountManager).where(AccountManager.email == email))
                am = result.scalar_one_or_none()
                if am:
                    am.name = am_name
                else:
                    am = AccountManager(name=am_name, email=email)
                    db.add(am)
                    await db.flush()

            merchant_code = s(row.get("Merchant ID"))
            merchant = None
            if merchant_code:
                result = await db.execute(select(Merchant).where(Merchant.merchant_code == merchant_code))
                merchant = result.scalar_one_or_none()
            else:
                result = await db.execute(select(Merchant).where(Merchant.restaurant_name == name))
                merchant = result.scalars().first()
            if not merchant:
                merchant = Merchant(restaurant_name=name, merchant_code=merchant_code, source="MERCHANT_IMPORT",
                                    source_detail=os.path.basename(str(file_path))[:300] or None)
                db.add(merchant)
                await db.flush()
            m_id = merchant.id

            merchant.restaurant_name = name
            if merchant_code is not None:
                merchant.merchant_code = merchant_code
            merchant.legal_name = s(row.get("Legal Name"))
            merchant.cuisine_category = s(row.get("Cuisine / Category"))
            merchant.website_url = s(row.get("Website URL"))
            merchant.website_platform = s(row.get("Website Platform"))
            merchant.online_ordering = s(row.get("Online Ordering"))
            merchant.pos_system = s(row.get("POS System"))
            merchant.customer_list_source = s(row.get("Customer List Source"))
            merchant.business_goals = s(row.get("Business Goals"))
            merchant.target_audience = s(row.get("Target Audience"))
            merchant.slow_dayparts = s(row.get("Slow Days / Dayparts"))
            merchant.seasonal_peaks = s(row.get("Seasonal Peaks"))
            merchant.alcohol_license = yes_no(row.get("Alcohol License?"))
            merchant.dietary_certs = s(row.get("Dietary Certifications"))
            merchant.location_count = as_int(row.get("# of Locations"))
            merchant.report_frequency = s(row.get("Report Frequency"))
            merchant.report_recipients = s(row.get("Report Recipients"))
            merchant.account_health = map_enum(HEALTH, row.get("Account Health"))
            merchant.next_action = s(row.get("Next Action"))
            merchant.open_blockers = s(row.get("Open Blockers"))
            merchant.notes = s(row.get("Notes"))
            merchant.onboarding_date = as_date(row.get("Onboarding Date"))
            merchant.go_live_date = as_date(row.get("Go-Live Date"))
            merchant.account_manager_id = am.id if am else None
            await db.flush()

            # Replace children for idempotency.
            for model in (Contact, Location, Keyword, Competitor, AccessItem, Baseline, Promotion, ScorecardEntry, Opportunity, DeliveryItem):
                await db.execute(delete(model).where(model.merchant_id == m_id))
            await db.flush()

            # Subscription (1:1 upsert)
            sub = await db.get(Subscription, m_id) if False else (await db.execute(select(Subscription).where(Subscription.merchant_id == m_id))).scalar_one_or_none()
            package_code = s(row.get("Package")) or "$199"
            status = map_enum(PKG_STATUS, row.get("Package Status"), PackageStatus.ONBOARDING)
            if sub:
                sub.package_code = package_code
                sub.status = status
                sub.start_date = as_date(row.get("Start Date"))
                sub.renewal_date = as_date(row.get("Renewal Date"))
                sub.mrr = num(row.get("MRR"))
            else:
                db.add(Subscription(
                    merchant_id=m_id, package_code=package_code, status=status,
                    start_date=as_date(row.get("Start Date")), renewal_date=as_date(row.get("Renewal Date")),
                    mrr=num(row.get("MRR")),
                ))

            # Brand profile (1:1 upsert)
            brand = await db.get(BrandProfile, m_id)
            if not brand:
                brand = BrandProfile(merchant_id=m_id)
                db.add(brand)
            brand.logo_vector = yes_no(row.get("Logo (vector)?"))
            brand.brand_colors = s(row.get("Brand Colors"))
            brand.brand_fonts = s(row.get("Brand Fonts"))
            brand.photo_library_status = s(row.get("Photo Library Status"))
            brand.menu_format = s(row.get("Menu Format"))
            brand.signature_dishes = s(row.get("Signature Dishes"))
            brand.tone_of_voice = s(row.get("Tone of Voice"))
            brand.do_not_say = s(row.get("Do-Not-Say List"))
            brand.content_restrictions = s(row.get("Content Restrictions"))

            # Catering profile (1:1 upsert)
            catering = await db.get(CateringProfile, m_id)
            if not catering:
                catering = CateringProfile(merchant_id=m_id)
                db.add(catering)
            catering.offered = yes_no(row.get("Catering Offered?"))
            catering.contact = s(row.get("Catering Contact"))
            catering.lead_flow = s(row.get("Catering Lead Flow"))
            catering.min_order = s(row.get("Catering Min Order"))
            catering.notes = s(row.get("Catering Notes"))

            await db.flush()

            # Contacts
            contact_defs = [
                {"role": ContactRole.OWNER, "name": s(row.get("Owner Name")), "email": s(row.get("Owner Email")), "phone": s(row.get("Owner Phone"))},
                {"role": ContactRole.MARKETING, "name": s(row.get("Marketing Contact"))},
                {"role": ContactRole.CONTENT_APPROVER, "name": s(row.get("Content Approver"))},
                {"role": ContactRole.BILLING, "name": s(row.get("Billing Contact"))},
                {"role": ContactRole.CATERING, "name": s(row.get("Catering Contact"))},
            ]
            for c in contact_defs:
                if not (c.get("name") or c.get("email") or c.get("phone")):
                    continue
                db.add(Contact(
                    merchant_id=m_id, role=c["role"], name=c.get("name"), email=c.get("email"), phone=c.get("phone"),
                    preferred_channel=channel_of(row.get("Preferred Channel")) if c["role"] == ContactRole.OWNER else None,
                    language=s(row.get("Language")) if c["role"] == ContactRole.OWNER else None,
                    responsiveness=responsiveness_of(row.get("Approval Responsiveness")) if c["role"] == ContactRole.OWNER else None,
                ))

            # Primary location
            nap_cols = ["Address", "City", "State", "ZIP", "Hours"]
            nap_status = "CONFLICT" if any("CONFLICT" in (s(row.get(c)) or "").upper() for c in nap_cols) else None
            db.add(Location(
                merchant_id=m_id, address=s(row.get("Address")), city=s(row.get("City")), state=s(row.get("State")),
                zip=s(row.get("ZIP")), hours=s(row.get("Hours")), is_primary=True, nap_status=nap_status,
            ))

            # Keywords
            for col, ktype in [("Primary Keywords", KeywordType.PRIMARY), ("Secondary Keywords", KeywordType.SECONDARY), ("Location Keywords", KeywordType.LOCATION)]:
                for term in split_list(row.get(col)):
                    db.add(Keyword(merchant_id=m_id, term=term, type=ktype))

            # Competitors
            for i in (1, 2, 3):
                cname = s(row.get(f"Competitor {i}"))
                if cname:
                    db.add(Competitor(merchant_id=m_id, name=cname, rank=i))

            # Connections
            for a in access.get(name, []):
                item = s(a.get("Access Item"))
                if not item:
                    continue
                db.add(AccessItem(
                    merchant_id=m_id, access_item=item,
                    criticality=map_enum(CRIT, a.get("Criticality"), AccessCriticality.MEDIUM),
                    status=map_enum(ACC_STATUS, a.get("Status"), AccessStatus.NOT_REQUESTED),
                    date_requested=as_date(a.get("Date Requested")), date_received=as_date(a.get("Date Received")),
                    verified=as_bool(a.get("Verified?")) or False, verified_date=as_date(a.get("Verified Date")),
                    expiry=as_date(a.get("Expiry / Renewal")), owner=s(a.get("Owner")),
                    flag=map_enum(ACC_FLAG, a.get("Flag"), AccessFlag.OPEN), notes=s(a.get("Why It Matters / Notes")),
                ))

            # Baselines
            for b in baselines.get(name, []):
                metric = s(b.get("Metric"))
                if not metric:
                    continue
                db.add(Baseline(
                    merchant_id=m_id, category=s(b.get("Category")) or "Unknown", metric=metric, unit=s(b.get("Unit")),
                    baseline_date=as_date(b.get("Baseline Date")), baseline_value=s(b.get("Baseline Value")),
                    current_date_=as_date(b.get("Current Date")), current_value=s(b.get("Current Value")),
                    source=s(b.get("Source")), notes=s(b.get("Notes")),
                ))

            # Promotions
            for p in promotions.get(name, []):
                pname = s(p.get("Promo Name"))
                if not pname:
                    continue
                db.add(Promotion(
                    merchant_id=m_id, promo_name=pname, offer_type=s(p.get("Offer Type")), offer_value=s(p.get("Offer Value")),
                    promo_code=s(p.get("Promo Code")), channels=s(p.get("Channels")), start_date=as_date(p.get("Start Date")),
                    end_date=as_date(p.get("End Date")), status=map_enum(PROMO, p.get("Status"), PromotionStatus.NO_PROMOTION),
                    redemptions=s(p.get("Redemptions")), redemption_method=s(p.get("Redemption Method")),
                    approval_owner=s(p.get("Approval Owner")), staff_briefed=yes_no(p.get("Staff Briefed?")),
                    blackout_dates=s(p.get("Blackout Dates")), notes=s(p.get("Notes")),
                ))

            # Scorecard
            for sc in scorecard.get(name, []):
                kpi = s(sc.get("KPI"))
                if not kpi:
                    continue
                db.add(ScorecardEntry(
                    merchant_id=m_id, month=s(sc.get("Month")) or "", area=s(sc.get("Area")) or "", kpi=kpi,
                    target=num(sc.get("Target")), actual=num(sc.get("Actual")), status=s(sc.get("Status")),
                    commentary=s(sc.get("Commentary")),
                ))

            # Opportunities
            for o in opportunities.get(name, []):
                opp = s(o.get("Opportunity"))
                if not opp:
                    continue
                db.add(Opportunity(
                    merchant_id=m_id, opportunity=opp, current_status=map_enum(OPP, o.get("Current Status"), OpportunityStatus.RECOMMENDED),
                    priority=map_enum(PRIO, o.get("Priority")), est_monthly_value=num(o.get("Est. $ / Month")),
                    rationale=s(o.get("Rationale")), owner=s(o.get("Owner")), next_step=s(o.get("Next Step")),
                    target_date=as_date(o.get("Target Date")),
                ))

            # Delivery
            for d in delivery.get(name, []):
                svc_name = s(d.get("Service"))
                svc = service_by_name.get(svc_name) if svc_name else None
                if not svc:
                    continue
                ent_result = await db.execute(
                    select(Entitlement).where(Entitlement.service_id == svc.id, Entitlement.package_code == (s(d.get("Package")) or "$199"))
                )
                ent = ent_result.scalar_one_or_none()
                db.add(DeliveryItem(
                    merchant_id=m_id, service_id=svc.id, entitlement_id=ent.id if ent else None,
                    status=map_enum(DELIV, d.get("Status"), DeliveryStatus.NOT_STARTED), assigned_to=s(d.get("Assigned To")),
                    last_delivered=as_date(d.get("Last Delivered")), next_due=as_date(d.get("Next Due")),
                    flag=s(d.get("Flag")), notes=s(d.get("Notes")),
                ))

            await db.commit()
            imported += 1
            print(f"  imported: {name}")

        print(f"\nImported {imported} merchant(s).")


if __name__ == "__main__":
    asyncio.run(main())
