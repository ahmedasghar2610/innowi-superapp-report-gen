"""
Port of prisma/seed.ts. Seeds reference/catalog data only (Packages, the
14-service catalog, and the Entitlement matrix). Idempotent — safe to re-run.

Run: python -m scripts.seed
"""
from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.catalog import Entitlement, Package, Service
from app.models.enums import DeliveryFrequency as F
from app.models.enums import OwnerTeam, ServiceCategory

PACKAGES = [
    {"code": "$199", "name": "Growth", "price": 199},
    {"code": "$299", "name": "Growth Plus", "price": 299},
]

SERVICES = [
    dict(name="SMS/Email", category=ServiceCategory.CUSTOMER_MARKETING, owner_team=OwnerTeam.MARKETING,
         t199=dict(included=True, qty=2, freq=F.MONTHLY), t299=dict(included=True, qty=4, freq=F.WEEKLY),
         dod="Campaign built, approved, sent; delivery + open/click logged"),
    dict(name="Customer List", category=ServiceCategory.CUSTOMER_MARKETING, owner_team=OwnerTeam.MARKETING,
         t199=dict(included=True, qty=1, freq=F.MONTHLY), t299=dict(included=True, qty=1, freq=F.MONTHLY),
         dod="List pulled from POS, cleaned, de-duped, consent flags applied"),
    dict(name="SEO", category=ServiceCategory.SEARCH, owner_team=OwnerTeam.SEO,
         t199=dict(included=True, qty=1, freq=F.MONTHLY), t299=dict(included=True, qty=1, freq=F.MONTHLY),
         dod="On-page fixes + citations + rank report delivered"),
    dict(name="Blogs", category=ServiceCategory.SEARCH, owner_team=OwnerTeam.SEO,
         t199=dict(included=True, qty=1, freq=F.MONTHLY), t299=dict(included=True, qty=2, freq=F.TWO_X_MONTHLY),
         dod="Published, indexed, internally linked, target keyword assigned"),
    dict(name="Review Management", category=ServiceCategory.REPUTATION, owner_team=OwnerTeam.MARKETING,
         t199=dict(included=True, qty=0, freq=F.ONGOING), t299=dict(included=True, qty=0, freq=F.ONGOING),
         dod="All new reviews responded to within 48h"),
    dict(name="Google Review Badge", category=ServiceCategory.REPUTATION, owner_team=OwnerTeam.DESIGN,
         t199=dict(included=True, qty=1, freq=F.ONE_TIME), t299=dict(included=True, qty=1, freq=F.ONE_TIME),
         dod="Badge designed, delivered, installed on site/in store"),
    dict(name="Conversion Cards", category=ServiceCategory.CONVERSION, owner_team=OwnerTeam.DESIGN,
         t199=dict(included=True, qty=1, freq=F.QUARTERLY), t299=dict(included=True, qty=1, freq=F.QUARTERLY),
         dod="Cards designed, approved, printed/shipped"),
    dict(name="Rewards", category=ServiceCategory.RETENTION, owner_team=OwnerTeam.MARKETING,
         t199=dict(included=False, qty=0, freq=F.NOT_INCLUDED), t299=dict(included=True, qty=0, freq=F.ONGOING),
         dod="Program live, offer configured, staff briefed"),
    dict(name="Rewards Flyer", category=ServiceCategory.RETENTION, owner_team=OwnerTeam.DESIGN,
         t199=dict(included=False, qty=0, freq=F.NOT_INCLUDED), t299=dict(included=True, qty=1, freq=F.ONE_TIME),
         dod="Flyer designed, approved, printed, distribution confirmed"),
    dict(name="G5T5", category=ServiceCategory.REVIEW, owner_team=OwnerTeam.REVIEW,
         t199=dict(included=True, qty=1, freq=F.MONTHLY), t299=dict(included=True, qty=1, freq=F.MONTHLY),
         dod="ACTION: define this service and its Definition of Done"),
    dict(name="GMB", category=ServiceCategory.SEARCH, owner_team=OwnerTeam.SEO,
         t199=dict(included=True, qty=2, freq=F.TWO_X_MONTHLY), t299=dict(included=True, qty=4, freq=F.WEEKLY),
         dod="Posts published, Q&A answered, photos added, info verified"),
    dict(name="Social Media", category=ServiceCategory.SOCIAL, owner_team=OwnerTeam.MARKETING,
         t199=dict(included=True, qty=4, freq=F.WEEKLY), t299=dict(included=True, qty=12, freq=F.THREE_X_WEEKLY),
         dod="Posts scheduled + published across agreed channels"),
    dict(name="Design Work", category=ServiceCategory.CREATIVE, owner_team=OwnerTeam.DESIGN,
         t199=dict(included=True, qty=1, freq=F.AS_NEEDED), t299=dict(included=True, qty=3, freq=F.AS_NEEDED),
         dod="Asset delivered in agreed formats, 1 revision round included"),
    dict(name="Reporting", category=ServiceCategory.REPORTING, owner_team=OwnerTeam.MARKETING,
         t199=dict(included=True, qty=1, freq=F.MONTHLY), t299=dict(included=True, qty=1, freq=F.MONTHLY),
         dod="Report sent to all named recipients by the 5th"),
]


async def main() -> None:
    async with SessionLocal() as db:
        for p in PACKAGES:
            existing = await db.get(Package, p["code"])
            if existing:
                existing.name = p["name"]
                existing.price = p["price"]
            else:
                db.add(Package(code=p["code"], name=p["name"], price=p["price"]))
        await db.commit()

        for s in SERVICES:
            result = await db.execute(select(Service).where(Service.name == s["name"]))
            service = result.scalar_one_or_none()
            if service:
                service.category = s["category"]
                service.owner_team = s["owner_team"]
            else:
                service = Service(name=s["name"], category=s["category"], owner_team=s["owner_team"])
                db.add(service)
            await db.flush()

            for code, tier in (("$199", s["t199"]), ("$299", s["t299"])):
                result = await db.execute(
                    select(Entitlement).where(Entitlement.service_id == service.id, Entitlement.package_code == code)
                )
                ent = result.scalar_one_or_none()
                if ent:
                    ent.included = tier["included"]
                    ent.qty_per_period = tier["qty"]
                    ent.frequency = tier["freq"]
                    ent.definition_of_done = s["dod"]
                    ent.owner_team = s["owner_team"]
                else:
                    db.add(
                        Entitlement(
                            service_id=service.id, package_code=code, included=tier["included"],
                            qty_per_period=tier["qty"], frequency=tier["freq"], definition_of_done=s["dod"],
                            owner_team=s["owner_team"],
                        )
                    )
        await db.commit()

    print(f"Seeded {len(PACKAGES)} packages, {len(SERVICES)} services, {len(SERVICES) * 2} entitlements.")


if __name__ == "__main__":
    asyncio.run(main())
