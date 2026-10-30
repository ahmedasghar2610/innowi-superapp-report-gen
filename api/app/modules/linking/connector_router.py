"""The merchant connector — settings, and each merchant's links to SEO / Google Ads / GBP.

    GET    /settings/connector                                   connector settings (admins)
    PUT    /settings/connector                                   save them
    POST   /merchants/connect                                    link sure matches for some / all merchants
    GET    /merchants/{merchantId}/links                   linked records + suggestions per module
    GET    /merchants/{merchantId}/links/search            unlinked records to pick by hand
    POST   /merchants/{merchantId}/links                   link one record {module, entityId}
    DELETE /merchants/{merchantId}/links/{module}/{entityId}  unlink it

Nothing here calls Google.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.profiling import Merchant
from app.modules.linking import connector
from app.modules.settings.router import _audit

settings_router = APIRouter(prefix="/settings/connector", tags=["Settings"], dependencies=[Depends(require_capability("settings.manage"))])
merchant_router = APIRouter(tags=["Merchants"])

Module = Literal["seo", "ads", "gbp"]


class ModulesInput(BaseModel):
    model_config = {"extra": "forbid"}
    seo: Optional[bool] = None
    ads: Optional[bool] = None
    gbp: Optional[bool] = None
    website: Optional[bool] = None


class SettingsInput(BaseModel):
    model_config = {"extra": "forbid"}
    modules: Optional[ModulesInput] = None
    autoLinkSure: Optional[bool] = None
    runAfterCreate: Optional[bool] = None
    offerCreateMerchants: Optional[bool] = None
    ignoreDomains: Optional[list[str]] = None
    ignoreAdsNames: Optional[list[str]] = None
    extraStopWords: Optional[list[str]] = None


@settings_router.get("")
async def get_settings(db: AsyncSession = Depends(get_db)):
    return {**await connector.get_settings(db), "defaults": connector.DEFAULTS}


@settings_router.put("")
async def put_settings(dto: SettingsInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    before = await connector.get_settings(db)
    patch = dto.model_dump(exclude_none=True)
    merged = {**before, **patch, "modules": {**before["modules"], **(patch.get("modules") or {})}}
    after = await connector.save_settings(db, merged)
    await _audit(db, request, user, "ConnectorSettings", before, after)
    await db.commit()
    return {**after, "defaults": connector.DEFAULTS}


class ConnectInput(BaseModel):
    model_config = {"extra": "forbid"}
    merchantIds: Optional[list[str]] = Field(default=None, description="omitted = every merchant")


@merchant_router.post("/merchants/connect", dependencies=[Depends(require_capability("profile.edit"))])
async def connect(dto: ConnectInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    out = await connector.connect(db, dto.merchantIds, user.id)
    if out.get("id"):
        await _audit(db, request, user, "MerchantConnect", {}, {"run": out["id"], **out["summary"]})
        await db.commit()
    return out


async def _merchant(db: AsyncSession, merchant_id: str) -> Merchant:
    m = await db.get(Merchant, merchant_id)
    if not m:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return m


@merchant_router.get("/merchants/{merchant_id}/links", dependencies=[Depends(require_capability("profile.view"))])
async def connections(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant(db, merchant_id)
    return await connector.connections(db, merchant_id)


@merchant_router.get("/merchants/{merchant_id}/links/search", dependencies=[Depends(require_capability("profile.view"))])
async def search(merchant_id: str, module: Module, q: str = "", db: AsyncSession = Depends(get_db)):
    await _merchant(db, merchant_id)
    return {"data": await connector.search(db, module, q)}


class LinkInput(BaseModel):
    model_config = {"extra": "forbid"}
    module: Module
    entityId: str = Field(min_length=1, max_length=40)


async def _after_link(db: AsyncSession, module: str, entity_id: str) -> None:
    """SEO scores pick up the new Local / Paid link; a failure here never undoes the link."""
    if module != "seo":
        return
    from app.config import get_settings as app_settings
    from app.models.seo import SeoSite
    from app.modules.seo import data as seo_data

    try:
        s = await db.get(SeoSite, entity_id)
        if s:
            await seo_data.recompute(db, s, psi_configured=bool(app_settings().PAGESPEED_API_KEY))
            await db.commit()
    except Exception:  # noqa: BLE001
        await db.rollback()


@merchant_router.post("/merchants/{merchant_id}/links", dependencies=[Depends(require_capability("profile.edit"))])
async def link(merchant_id: str, dto: LinkInput, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant(db, merchant_id)
    try:
        rec = await connector.link(db, merchant_id, dto.module, dto.entityId)
    except connector.LinkError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))
    await _audit(db, request, user, "MerchantLink", {}, {"merchantId": merchant_id, "module": dto.module, "entityId": dto.entityId})
    await db.commit()
    await _after_link(db, dto.module, dto.entityId)
    return rec


@merchant_router.delete("/merchants/{merchant_id}/links/{module}/{entity_id}", status_code=204,
                        dependencies=[Depends(require_capability("profile.edit"))])
async def unlink(merchant_id: str, module: Module, entity_id: str, request: Request, db: AsyncSession = Depends(get_db),
                 user: AuthenticatedUser = Depends(get_current_user)):
    try:
        await connector.unlink(db, merchant_id, module, entity_id)
    except connector.LinkError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))
    await _audit(db, request, user, "MerchantUnlink", {"merchantId": merchant_id, "module": module, "entityId": entity_id}, {})
    await db.commit()
    await _after_link(db, module, entity_id)
