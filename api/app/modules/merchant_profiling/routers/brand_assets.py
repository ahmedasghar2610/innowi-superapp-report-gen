"""Port of brand-asset.controller.ts (Step 10)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.storage.local_disk import get_storage
from app.common.storage.port import PutFileInput
from app.common.storage.upload_helpers import read_upload_within_limit, stream_file_response
from app.db.session import get_db
from app.models.profiling import BrandAsset, Merchant
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache
from app.modules.merchant_profiling.mappers import brand_asset_to_dto
from app.schemas.merchant_profiling import BrandAssetResponseDto, BrandAssetsResponseDto, UpdateBrandAssetDto

ASSET_TYPES = {"LOGO", "MENU", "IMAGE", "VIDEO", "BRAND_GUIDELINES", "OTHER"}
ASSET_STATUSES = {"ACTIVE", "ARCHIVED"}

router = APIRouter(tags=["Brand Assets"], dependencies=[Depends(require_capability("profile.view"))])
_edit = Depends(require_capability("profile.edit"))


async def _merchant_or_404(db: AsyncSession, merchant_id: str) -> Merchant:
    m = await db.get(Merchant, merchant_id)
    if not m:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return m


async def _asset_raw(id: str, db: AsyncSession):
    a = await db.get(BrandAsset, id)
    return brand_asset_to_dto(a, get_storage()).model_dump(mode="json") if a else None


@router.get("/merchants/{merchant_id}/brand-assets", response_model=BrandAssetsResponseDto)
async def list_brand_assets(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    rows = (await db.execute(select(BrandAsset).where(BrandAsset.merchant_id == merchant_id).order_by(BrandAsset.created_at.desc()))).scalars().all()
    storage = get_storage()
    return {"data": [brand_asset_to_dto(a, storage) for a in rows]}


@router.post("/merchants/{merchant_id}/brand-assets/upload", response_model=BrandAssetResponseDto, status_code=201, dependencies=[_edit])
@audited(entity_type="BrandAsset", merchant_id_param="merchant_id")
async def upload_brand_asset(
    merchant_id: str,
    request: Request,
    file: UploadFile = File(...),
    type: str = Form(...),
    name: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    await _merchant_or_404(db, merchant_id)
    if type not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of: {', '.join(sorted(ASSET_TYPES))}")
    data = await read_upload_within_limit(file)
    storage = get_storage()
    stored = await storage.put(PutFileInput(buffer=data, original_name=file.filename or "file", mime_type=file.content_type, scope=merchant_id))
    asset = BrandAsset(
        merchant_id=merchant_id, type=type, name=name, url=stored.key, status="ACTIVE",
        mime_type=file.content_type, size_bytes=stored.size_bytes, uploaded_by=user.email,
    )
    db.add(asset)
    await db.commit()
    await refresh_completion_cache(db, merchant_id)
    return brand_asset_to_dto(asset, storage)


@router.patch("/brand-assets/{id}", response_model=BrandAssetResponseDto, dependencies=[_edit])
@audited(entity_type="BrandAsset", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_asset_raw)
async def update_brand_asset(id: str, dto: UpdateBrandAssetDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    asset = await db.get(BrandAsset, id)
    if not asset:
        raise HTTPException(status_code=404, detail="Brand asset not found")
    data = dto.model_dump(exclude_unset=True)
    if "type" in data and data["type"] not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of: {', '.join(sorted(ASSET_TYPES))}")
    if "status" in data and data["status"] not in ASSET_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(sorted(ASSET_STATUSES))}")
    for k, v in data.items():
        setattr(asset, k, v)
    await db.commit()
    await refresh_completion_cache(db, asset.merchant_id)
    return brand_asset_to_dto(asset, get_storage())


@router.delete("/brand-assets/{id}", status_code=204, dependencies=[_edit])
@audited(entity_type="BrandAsset", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_asset_raw)
async def delete_brand_asset(id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    asset = await db.get(BrandAsset, id)
    if not asset:
        raise HTTPException(status_code=404, detail="Brand asset not found")
    merchant_id = asset.merchant_id
    storage = get_storage()
    if storage.is_managed(asset.url):
        await storage.delete(asset.url)
    await db.delete(asset)
    await db.commit()
    await refresh_completion_cache(db, merchant_id)
    return Response(status_code=204)


@router.get("/brand-assets/{id}/download")
async def download_brand_asset(id: str, db: AsyncSession = Depends(get_db)):
    asset = await db.get(BrandAsset, id)
    if not asset:
        raise HTTPException(status_code=404, detail="Brand asset not found")
    storage = get_storage()
    if not storage.is_managed(asset.url):
        raise HTTPException(status_code=404, detail="This asset is a recorded reference, not a stored file")
    stream = await storage.open(asset.url)
    if not stream:
        raise HTTPException(status_code=404, detail="File not found")
    return stream_file_response(stream, asset.name or asset.id, asset.mime_type)
