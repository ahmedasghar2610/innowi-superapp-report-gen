"""Port of document.controller.ts including multipart upload/download (Step 10)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import asc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common.case import to_snake_dict
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.storage.local_disk import get_storage
from app.common.storage.port import PutFileInput
from app.common.storage.upload_helpers import read_upload_within_limit, stream_file_response
from app.db.session import get_db
from app.models.enums import DocumentCategory
from app.models.profiling import Document, Location, Merchant
from app.modules.merchant_profiling.completeness_service import refresh_completion_cache
from app.modules.merchant_profiling.mappers import document_to_dto
from app.schemas.merchant_profiling import (
    CreateDocumentDto,
    DocumentResponseDto,
    DocumentsResponseDto,
    UpdateDocumentDto,
)

router = APIRouter(tags=["Documents"], dependencies=[Depends(require_capability("profile.view"))])
_edit = Depends(require_capability("profile.edit"))


async def _merchant_or_404(db: AsyncSession, merchant_id: str) -> Merchant:
    m = await db.get(Merchant, merchant_id)
    if not m:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return m


async def _validate_location(db: AsyncSession, merchant_id: str, location_id: str | None) -> None:
    if location_id is None:
        return
    loc = await db.get(Location, location_id)
    if not loc or loc.merchant_id != merchant_id:
        raise HTTPException(status_code=400, detail="locationId belongs to another merchant or does not exist")


async def _document_raw(id: str, db: AsyncSession):
    d = await db.get(Document, id)
    return document_to_dto(d, get_storage()).model_dump(mode="json") if d else None


@router.get("/merchants/{merchant_id}/documents", response_model=DocumentsResponseDto)
async def list_documents(merchant_id: str, db: AsyncSession = Depends(get_db)):
    await _merchant_or_404(db, merchant_id)
    rows = (
        await db.execute(select(Document).where(Document.merchant_id == merchant_id).order_by(Document.created_at.desc()))
    ).scalars().all()
    storage = get_storage()
    return {"data": [document_to_dto(d, storage) for d in rows]}


@router.post("/merchants/{merchant_id}/documents", response_model=DocumentResponseDto, status_code=201, dependencies=[_edit])
@audited(entity_type="Document", merchant_id_param="merchant_id")
async def create_document(merchant_id: str, dto: CreateDocumentDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await _merchant_or_404(db, merchant_id)
    await _validate_location(db, merchant_id, dto.locationId)
    document = Document(merchant_id=merchant_id, **to_snake_dict(dto.model_dump(exclude_unset=True)))
    db.add(document)
    await db.commit()
    await refresh_completion_cache(db, merchant_id)
    return document_to_dto(document, get_storage())


@router.patch("/documents/{id}", response_model=DocumentResponseDto, dependencies=[_edit])
@audited(entity_type="Document", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_document_raw)
async def update_document(id: str, dto: UpdateDocumentDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    document = await db.get(Document, id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    data = dto.model_dump(exclude_unset=True)
    if "locationId" in data:
        await _validate_location(db, document.merchant_id, data["locationId"])
    for k, v in to_snake_dict(data).items():
        setattr(document, k, v)
    await db.commit()
    await refresh_completion_cache(db, document.merchant_id)
    return document_to_dto(document, get_storage())


@router.delete("/documents/{id}", status_code=204, dependencies=[_edit])
@audited(entity_type="Document", id_param="id", resolve_merchant_id=lambda e: e.get("merchantId") if e else None, read=_document_raw)
async def delete_document(id: str, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    document = await db.get(Document, id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    merchant_id = document.merchant_id
    storage = get_storage()
    if storage.is_managed(document.storage_url):
        await storage.delete(document.storage_url)
    await db.delete(document)
    await db.commit()
    await refresh_completion_cache(db, merchant_id)
    return Response(status_code=204)


@router.post("/merchants/{merchant_id}/documents/upload", response_model=DocumentResponseDto, status_code=201, dependencies=[_edit])
@audited(entity_type="Document", merchant_id_param="merchant_id")
async def upload_document(
    merchant_id: str,
    request: Request,
    file: UploadFile = File(...),
    category: DocumentCategory = Form(...),
    locationId: str | None = Form(None),
    version: int | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    await _merchant_or_404(db, merchant_id)
    await _validate_location(db, merchant_id, locationId)
    data = await read_upload_within_limit(file)
    storage = get_storage()
    stored = await storage.put(PutFileInput(buffer=data, original_name=file.filename or "file", mime_type=file.content_type, scope=merchant_id))
    document = Document(
        merchant_id=merchant_id, location_id=locationId, category=category, file_name=file.filename or "file",
        storage_url=stored.key, mime_type=file.content_type, size_bytes=stored.size_bytes,
        version=version or 1, uploaded_by=user.email,
    )
    db.add(document)
    await db.commit()
    await refresh_completion_cache(db, merchant_id)
    return document_to_dto(document, storage)


@router.get("/documents/{id}/download")
async def download_document(id: str, db: AsyncSession = Depends(get_db)):
    document = await db.get(Document, id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    storage = get_storage()
    if not storage.is_managed(document.storage_url):
        raise HTTPException(status_code=404, detail="This document is a recorded reference, not a stored file")
    stream = await storage.open(document.storage_url)
    if not stream:
        raise HTTPException(status_code=404, detail="File not found")
    return stream_file_response(stream, document.file_name, document.mime_type)
