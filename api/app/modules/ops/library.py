"""Ops CRM — Library pages and the credentials vault.

Library: a small team wiki. Pages sit in a section (Company, Processes &
SOPs, Templates, Merchants), may have one parent, and merchant pages belong
to a merchant. Bodies are Markdown. Every save that changes the title or body
keeps the previous text in library_page_version.

Vault: logins the team holds for merchants (or for Innowi). Secrets are
Fernet-encrypted at rest and only returned by POST /ops/credentials/{id}/reveal,
which requires a reason and writes an access-log row.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.security.crypto import (
    CredentialDecryptError,
    CredentialKeyMissing,
    decrypt_secret,
    encrypt_secret,
)
from app.config import get_settings
from app.db.session import get_db
from app.modules.ops.ticket_more import linked_tickets_for_page
from app.models.auth import User
from app.models.enums import CredentialAction, LibrarySection
from app.models.ops import Credential, CredentialAccessLog, LibraryPage, LibraryPageVersion, utcnow
from app.models.profiling import Merchant
from app.modules.ops.router import _person_ref, _users
from app.schemas.library import (
    CreateCredentialDto,
    CreateLibraryPageDto,
    CredentialDto,
    CredentialLogDto,
    CredentialLogEntryDto,
    CredentialsDto,
    LibraryPageDto,
    LibraryPageSummaryDto,
    LibraryTreeDto,
    LibraryVersionDto,
    LibraryVersionsDto,
    RevealCredentialDto,
    RevealedCredentialDto,
    UpdateCredentialDto,
    UpdateLibraryPageDto,
)
from app.schemas.ops import MerchantRefDto

router = APIRouter(prefix="/ops", tags=["Ops CRM — Library"])
_view = Depends(require_capability("library.view"))
_edit = Depends(require_capability("library.edit"))
_cred_view = Depends(require_capability("credentials.view"))
_cred_manage = Depends(require_capability("credentials.manage"))


def _bad(msg: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)


async def _merchant_names(db: AsyncSession, ids) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict((await db.execute(select(Merchant.id, Merchant.restaurant_name).where(Merchant.id.in_(ids)))).all())


def _merchant_ref(mid: Optional[str], names: dict[str, str]) -> Optional[MerchantRefDto]:
    return MerchantRefDto(id=mid, name=names.get(mid, "—")) if mid else None


# ================================================================= pages ====
async def _page_or_404(db: AsyncSession, page_id: str) -> LibraryPage:
    page = await db.get(LibraryPage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


async def _validate_placement(
    db: AsyncSession, *, section: LibrarySection, parent_id: Optional[str], merchant_id: Optional[str], self_id: Optional[str] = None
) -> None:
    if section == LibrarySection.MERCHANT:
        if not merchant_id:
            raise _bad("A merchant page needs a merchant")
        if not await db.get(Merchant, merchant_id):
            raise _bad("Merchant not found")
    elif merchant_id:
        raise _bad("Only pages in the Merchants section belong to a merchant")
    if parent_id:
        if parent_id == self_id:
            raise _bad("A page can't be its own parent")
        parent = await db.get(LibraryPage, parent_id)
        if not parent:
            raise _bad("Parent page not found")
        if parent.parent_id is not None:
            raise _bad("Pages can only be nested one level deep")
        if parent.section != section:
            raise _bad("A sub-page must be in the same section as its parent")
        if self_id:
            has_children = (
                await db.execute(select(func.count()).select_from(LibraryPage).where(LibraryPage.parent_id == self_id))
            ).scalar_one()
            if has_children:
                raise _bad("This page has sub-pages, so it can't become a sub-page itself")


def _summary(p: LibraryPage, names: dict[str, str]) -> LibraryPageSummaryDto:
    return LibraryPageSummaryDto(
        id=p.id,
        title=p.title,
        section=p.section,
        parentId=p.parent_id,
        merchant=_merchant_ref(p.merchant_id, names),
        version=p.version,
        position=p.position,
        updatedAt=p.updated_at,
    )


async def _page_dto(db: AsyncSession, p: LibraryPage, user: AuthenticatedUser) -> LibraryPageDto:
    names = await _merchant_names(db, [p.merchant_id])
    users = await _users(db, [p.owner_id, p.updated_by_id])
    children = (
        await db.execute(select(func.count()).select_from(LibraryPage).where(LibraryPage.parent_id == p.id))
    ).scalar_one()
    return LibraryPageDto(
        **_summary(p, names).model_dump(),
        body=p.body,
        owner=_person_ref(users.get(p.owner_id)) if p.owner_id else None,
        updatedBy=_person_ref(users.get(p.updated_by_id)) if p.updated_by_id else None,
        createdAt=p.created_at,
        childCount=children,
        canDelete=user.can("library.delete") and children == 0,
        linkedTickets=await linked_tickets_for_page(db, p.id),
    )


@router.get("/library", response_model=LibraryTreeDto, dependencies=[_view])
async def library_tree(merchantId: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """Every page (no bodies), for the tree. `merchantId` narrows to one merchant's pages."""
    stmt = select(LibraryPage).order_by(LibraryPage.section, LibraryPage.position, LibraryPage.title)
    if merchantId:
        stmt = stmt.where(LibraryPage.merchant_id == merchantId)
    pages = list((await db.execute(stmt)).scalars().all())
    names = await _merchant_names(db, [p.merchant_id for p in pages])
    return {"data": [_summary(p, names) for p in pages]}


@router.post("/library", response_model=LibraryPageDto, status_code=201, dependencies=[_edit])
async def create_page(
    dto: CreateLibraryPageDto, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)
):
    await _validate_placement(db, section=dto.section, parent_id=dto.parentId, merchant_id=dto.merchantId)
    max_pos = (
        await db.execute(select(func.max(LibraryPage.position)).where(LibraryPage.section == dto.section))
    ).scalar() or 0
    now = utcnow()
    page = LibraryPage(
        title=dto.title,
        section=dto.section,
        parent_id=dto.parentId,
        merchant_id=dto.merchantId,
        body=dto.body,
        position=max_pos + 1,
        owner_id=user.id,
        updated_by_id=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(page)
    await db.commit()
    return await _page_dto(db, page, user)


@router.get("/library/{page_id}", response_model=LibraryPageDto, dependencies=[_view])
async def get_page(page_id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    return await _page_dto(db, await _page_or_404(db, page_id), user)


@router.patch("/library/{page_id}", response_model=LibraryPageDto, dependencies=[_edit])
async def update_page(
    page_id: str,
    dto: UpdateLibraryPageDto,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    page = await _page_or_404(db, page_id)
    changes = dto.model_dump(exclude_unset=True)
    base = changes.pop("baseVersion", None)
    if base is not None and base != page.version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Someone saved this page while you were editing (now version {page.version}). "
            "Copy your changes, reload, and apply them again.",
        )
    for f in ("title", "section", "body"):
        if f in changes and changes[f] is None:
            raise _bad(f"{f} cannot be empty")

    if {"section", "parentId", "merchantId"} & changes.keys():
        section = changes.get("section", page.section)
        parent_id = changes["parentId"] if "parentId" in changes else page.parent_id
        merchant_id = changes["merchantId"] if "merchantId" in changes else page.merchant_id
        if section != LibrarySection.MERCHANT and "merchantId" not in changes:
            merchant_id = None
        await _validate_placement(db, section=section, parent_id=parent_id, merchant_id=merchant_id, self_id=page.id)
        page.section, page.parent_id, page.merchant_id = section, parent_id, merchant_id

    if "ownerId" in changes and changes["ownerId"]:
        if not await db.get(User, changes["ownerId"]):
            raise _bad("Owner not found")
        page.owner_id = changes["ownerId"]

    new_title = changes.get("title", page.title)
    new_body = changes.get("body", page.body)
    if new_title != page.title or new_body != page.body:
        db.add(
            LibraryPageVersion(
                page_id=page.id, version=page.version, title=page.title, body=page.body, edited_by_id=page.updated_by_id
            )
        )
        page.title, page.body = new_title, new_body
        page.version += 1
    page.updated_by_id = user.id
    page.updated_at = utcnow()
    await db.commit()
    return await _page_dto(db, page, user)


@router.delete("/library/{page_id}", status_code=204, dependencies=[Depends(require_capability("library.delete"))])
async def delete_page(page_id: str, db: AsyncSession = Depends(get_db)):
    page = await _page_or_404(db, page_id)
    children = (
        await db.execute(select(func.count()).select_from(LibraryPage).where(LibraryPage.parent_id == page.id))
    ).scalar_one()
    if children:
        raise _bad("Delete or move this page's sub-pages first")
    await db.delete(page)
    await db.commit()
    return Response(status_code=204)


@router.get("/library/{page_id}/versions", response_model=LibraryVersionsDto, dependencies=[_view])
async def page_versions(page_id: str, db: AsyncSession = Depends(get_db)):
    """Earlier versions, newest first (the current text is on the page itself)."""
    await _page_or_404(db, page_id)
    rows = (
        await db.execute(
            select(LibraryPageVersion).where(LibraryPageVersion.page_id == page_id).order_by(LibraryPageVersion.version.desc())
        )
    ).scalars().all()
    users = await _users(db, [r.edited_by_id for r in rows])
    return {
        "data": [
            LibraryVersionDto(
                version=r.version,
                title=r.title,
                body=r.body,
                editedBy=_person_ref(users.get(r.edited_by_id)) if r.edited_by_id else None,
                createdAt=r.created_at,
            )
            for r in rows
        ]
    }


# =========================================================== credentials ====
def _vault_configured() -> bool:
    return bool(get_settings().CREDENTIAL_ENCRYPTION_KEY)


def _vault_unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="The credentials vault isn't set up yet: CREDENTIAL_ENCRYPTION_KEY is missing on the API server.",
    )


def _encrypt(secret: str) -> str:
    try:
        return encrypt_secret(secret)
    except CredentialKeyMissing:
        raise _vault_unavailable()


def _cred_dto(c: Credential, names: dict[str, str]) -> CredentialDto:
    return CredentialDto(
        id=c.id,
        label=c.label,
        username=c.username,
        url=c.url,
        notes=c.notes,
        merchant=_merchant_ref(c.merchant_id, names),
        updatedAt=c.updated_at,
    )


def _log(db: AsyncSession, c: Credential, user: AuthenticatedUser, action: CredentialAction, request: Request, reason=None):
    db.add(
        CredentialAccessLog(
            credential_id=c.id,
            credential_label=c.label,
            merchant_id=c.merchant_id,
            user_id=user.id,
            user_email=user.email,
            action=action,
            reason=reason,
            ip=request.client.host if request.client else None,
        )
    )


async def _cred_or_404(db: AsyncSession, cred_id: str) -> Credential:
    c = await db.get(Credential, cred_id)
    if not c:
        raise HTTPException(status_code=404, detail="Credential not found")
    return c


@router.get("/credentials", response_model=CredentialsDto, dependencies=[_cred_view])
async def list_credentials(
    merchantId: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Which logins exist (never the secrets). `merchantId=none` = Innowi's own logins."""
    stmt = select(Credential).order_by(Credential.label)
    if merchantId == "none":
        stmt = stmt.where(Credential.merchant_id.is_(None))
    elif merchantId:
        stmt = stmt.where(Credential.merchant_id == merchantId)
    rows = list((await db.execute(stmt)).scalars().all())
    names = await _merchant_names(db, [c.merchant_id for c in rows])
    return {
        "data": [_cred_dto(c, names) for c in rows],
        "canReveal": user.can("credentials.reveal"),
        "canManage": user.can("credentials.manage"),
        "configured": _vault_configured(),
    }


@router.post("/credentials", response_model=CredentialDto, status_code=201, dependencies=[_cred_manage])
async def create_credential(
    dto: CreateCredentialDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    if dto.merchantId and not await db.get(Merchant, dto.merchantId):
        raise _bad("Merchant not found")
    now = utcnow()
    c = Credential(
        label=dto.label,
        username=dto.username,
        url=dto.url,
        notes=dto.notes,
        merchant_id=dto.merchantId,
        secret_encrypted=_encrypt(dto.secret),
        created_by_id=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(c)
    await db.flush()
    _log(db, c, user, CredentialAction.CREATED, request)
    await db.commit()
    return _cred_dto(c, await _merchant_names(db, [c.merchant_id]))


@router.patch("/credentials/{cred_id}", response_model=CredentialDto, dependencies=[_cred_manage])
async def update_credential(
    cred_id: str,
    dto: UpdateCredentialDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    c = await _cred_or_404(db, cred_id)
    changes = dto.model_dump(exclude_unset=True)
    if "label" in changes and not changes["label"]:
        raise _bad("label cannot be empty")
    for f in ("label", "username", "url", "notes"):
        if f in changes:
            setattr(c, f, changes[f])
    if changes.get("secret"):
        c.secret_encrypted = _encrypt(changes["secret"])
    c.updated_at = utcnow()
    _log(db, c, user, CredentialAction.UPDATED, request, reason="secret changed" if changes.get("secret") else None)
    await db.commit()
    return _cred_dto(c, await _merchant_names(db, [c.merchant_id]))


@router.delete("/credentials/{cred_id}", status_code=204, dependencies=[_cred_manage])
async def delete_credential(
    cred_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    c = await _cred_or_404(db, cred_id)
    _log(db, c, user, CredentialAction.DELETED, request)
    await db.flush()
    await db.delete(c)
    await db.commit()
    return Response(status_code=204)


@router.post(
    "/credentials/{cred_id}/reveal",
    response_model=RevealedCredentialDto,
    dependencies=[Depends(require_capability("credentials.reveal"))],
)
async def reveal_credential(
    cred_id: str,
    dto: RevealCredentialDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Returns the secret once, and records who saw it, when, and why."""
    c = await _cred_or_404(db, cred_id)
    try:
        secret = decrypt_secret(c.secret_encrypted)
    except CredentialKeyMissing:
        raise _vault_unavailable()
    except CredentialDecryptError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="This secret was saved with a different encryption key and can't be read. Re-enter it.",
        )
    _log(db, c, user, CredentialAction.REVEALED, request, reason=dto.reason)
    await db.commit()
    return {"id": c.id, "secret": secret}


@router.get("/credentials/log", response_model=CredentialLogDto, dependencies=[_cred_manage])
async def credential_log(
    credentialId: Optional[str] = None,
    merchantId: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Who created, changed, revealed or deleted credentials — newest first (last 200)."""
    stmt = select(CredentialAccessLog).order_by(CredentialAccessLog.created_at.desc()).limit(200)
    if credentialId:
        stmt = stmt.where(CredentialAccessLog.credential_id == credentialId)
    if merchantId:
        stmt = stmt.where(CredentialAccessLog.merchant_id == merchantId)
    rows = (await db.execute(stmt)).scalars().all()
    users = await _users(db, [r.user_id for r in rows])
    return {
        "data": [
            CredentialLogEntryDto(
                id=r.id,
                action=r.action,
                credentialLabel=r.credential_label,
                user=_person_ref(users.get(r.user_id)) if r.user_id else None,
                userEmail=r.user_email,
                reason=r.reason,
                createdAt=r.created_at,
            )
            for r in rows
        ]
    }
