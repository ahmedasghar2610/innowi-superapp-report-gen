"""Port of package.controller.ts + service.controller.ts + entitlement.controller.ts.
Read-only reference data, seeded via scripts/seed.py."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.deps import require_capability
from app.db.session import get_db
from app.models.catalog import Entitlement, Package, Service
from app.models.enums import OwnerTeam, ServiceCategory
from app.schemas.catalog import (
    EntitlementResponseDto,
    EntitlementsResponseDto,
    PackageDetailResponseDto,
    PackageResponseDto,
    PackagesResponseDto,
    ServiceResponseDto,
    ServicesResponseDto,
)

router = APIRouter(dependencies=[Depends(require_capability("profile.view"))])


@router.get("/packages", response_model=PackagesResponseDto, tags=["Catalog — Packages"])
async def list_packages(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Package))).scalars().all()
    return PackagesResponseDto(data=[PackageResponseDto.from_entity(p) for p in rows])


@router.get("/packages/{code}", response_model=PackageResponseDto, tags=["Catalog — Packages"])
async def get_package(code: str, db: AsyncSession = Depends(get_db)):
    pkg = await db.get(Package, code)
    if not pkg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f'Package "{code}" not found')
    return PackageResponseDto.from_entity(pkg)


@router.get("/packages/{code}/entitlements", response_model=PackageDetailResponseDto, tags=["Catalog — Packages"])
async def get_package_entitlements(code: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Package).where(Package.code == code).options(selectinload(Package.entitlements).selectinload(Entitlement.service))
    )
    pkg = result.scalar_one_or_none()
    if not pkg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f'Package "{code}" not found')
    base = PackageResponseDto.from_entity(pkg)
    return PackageDetailResponseDto(
        code=base.code,
        name=base.name,
        price=base.price,
        entitlements=[EntitlementResponseDto.from_entity(e) for e in pkg.entitlements],
    )


@router.get("/services", response_model=ServicesResponseDto, tags=["Catalog — Services"])
async def list_services(
    category: Optional[ServiceCategory] = None,
    ownerTeam: Optional[OwnerTeam] = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Service)
    if category:
        stmt = stmt.where(Service.category == category)
    if ownerTeam:
        stmt = stmt.where(Service.owner_team == ownerTeam)
    rows = (await db.execute(stmt)).scalars().all()
    return ServicesResponseDto(data=[ServiceResponseDto.model_validate(s) for s in rows])


@router.get("/services/{id}", response_model=ServiceResponseDto, tags=["Catalog — Services"])
async def get_service(id: str, db: AsyncSession = Depends(get_db)):
    service = await db.get(Service, id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Service {id} not found")
    return ServiceResponseDto.model_validate(service)


@router.get("/entitlements", response_model=EntitlementsResponseDto, tags=["Catalog — Entitlements"])
async def list_entitlements(
    packageCode: Optional[str] = None,
    serviceId: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Entitlement).options(selectinload(Entitlement.service))
    if packageCode:
        stmt = stmt.where(Entitlement.package_code == packageCode)
    if serviceId:
        stmt = stmt.where(Entitlement.service_id == serviceId)
    rows = (await db.execute(stmt)).scalars().all()
    return EntitlementsResponseDto(data=[EntitlementResponseDto.from_entity(e) for e in rows])
