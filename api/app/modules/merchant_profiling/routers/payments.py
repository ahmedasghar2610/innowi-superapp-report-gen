"""Merchants → Payments (modules/merchant_profiling/payments_import.py).

    POST /merchant-payments/import?dryRun=true   preview the revenue report: sheets found, the month, each row's merchant
    POST /merchant-payments/import               write it; form fields `sheet`, `month` (YYYY-MM) and `choices`
                                                 (JSON {"row12": "<merchantId>" | "skip"}) as picked in the preview
    GET  /merchants/{merchantId}/payments        that merchant's months, latest first, with totals
    POST /merchants/{merchantId}/payments        add one month by hand (one per month — 409 if it's there)
    PATCH  /merchant-payments/{id}               change a month
    DELETE /merchant-payments/{id}               remove it
"""
from __future__ import annotations

import datetime as dt
import json
import re
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.db.session import get_db
from app.models.boundary import MerchantPayment
from app.models.profiling import Merchant
from app.modules.merchant_profiling import payments_import as pay

router = APIRouter(tags=["Merchants"])


def _month(v: Optional[str]) -> Optional[dt.date]:
    if not v:
        return None
    m = re.fullmatch(r"(20\d\d)-(\d\d)(?:-\d\d)?", v.strip())
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise HTTPException(status_code=400, detail="`month` must look like 2026-09.")
    return dt.date(int(m.group(1)), int(m.group(2)), 1)


@router.post("/merchant-payments/import", dependencies=[Depends(require_capability("subscription.write"))])
async def import_payments(
    file: UploadFile = File(...),
    dryRun: bool = Query(False),
    sheet: Optional[str] = Form(None),
    month: Optional[str] = Form(None),
    choices: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    data = await file.read()
    try:
        sheets = pay.read_report(data, file.filename or "")
        picked: dict[str, str] = {}
        if choices:
            try:
                picked = {str(k): str(v) for k, v in json.loads(choices).items()}
            except (ValueError, AttributeError):
                raise HTTPException(status_code=400, detail='`choices` must be JSON like {"row12": "<merchantId>"}.')
        if dryRun:
            return pay.public(await pay.plan(db, sheets, sheet, _month(month), picked))
        result = await pay.apply(db, sheets, sheet, _month(month), picked, file.filename, user.id)
    except pay.PaymentsImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    return pay.public(result)


@router.get("/merchants/{merchant_id}/payments", dependencies=[Depends(require_capability("profile.view"))])
async def merchant_payments(merchant_id: str, db: AsyncSession = Depends(get_db)):
    if not await db.get(Merchant, merchant_id):
        raise HTTPException(status_code=404, detail="Merchant not found")
    return await pay.merchant_payments(db, merchant_id)


# ------------------------------------------------------------- by hand ---

_write = Depends(require_capability("subscription.write"))


class PaymentInput(BaseModel):
    model_config = {"extra": "forbid"}
    month: Optional[str] = Field(default=None, description="YYYY-MM")
    status: Optional[str] = Field(default=None, max_length=60)
    packageType: Optional[str] = Field(default=None, max_length=60)
    contract: Optional[float] = Field(default=None, ge=0)
    charged: Optional[float] = Field(default=None, ge=0)
    variance: Optional[float] = None
    ordersRevenue: Optional[float] = Field(default=None, ge=0)
    commission: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = Field(default=None, max_length=4000)


_FIELDS = {"status": "status", "packageType": "package_type", "contract": "contract_amount", "charged": "charged_amount",
           "variance": "variance", "ordersRevenue": "orders_revenue", "commission": "commission_charge", "notes": "notes"}


def _apply(p: MerchantPayment, data: dict) -> None:
    for k, col in _FIELDS.items():
        if k in data:
            v = data[k]
            setattr(p, col, (v.strip() or None) if isinstance(v, str) else v)
    # Variance follows contract − charged unless it was typed in.
    if "variance" not in data and p.contract_amount is not None and p.charged_amount is not None:
        p.variance = round(float(p.contract_amount) - float(p.charged_amount), 2)


async def _taken(db: AsyncSession, merchant_id: str, month: dt.date, not_id: Optional[str] = None) -> bool:
    q = select(MerchantPayment.id).where(MerchantPayment.merchant_id == merchant_id, MerchantPayment.month == month)
    if not_id:
        q = q.where(MerchantPayment.id != not_id)
    return (await db.execute(q)).first() is not None


@router.post("/merchants/{merchant_id}/payments", status_code=201, dependencies=[_write])
async def add_payment(merchant_id: str, dto: PaymentInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    m = await db.get(Merchant, merchant_id)
    if not m:
        raise HTTPException(status_code=404, detail="Merchant not found")
    month = _month(dto.month)
    if not month:
        raise HTTPException(status_code=400, detail="Pick the month.")
    if await _taken(db, merchant_id, month):
        raise HTTPException(status_code=409, detail=f"{month:%B %Y} is already recorded for this merchant — edit that month instead.")
    p = MerchantPayment(merchant_id=merchant_id, month=month, account_name=m.restaurant_name, source_file="Added by hand", imported_by=user.id)
    _apply(p, dto.model_dump(exclude_unset=True, exclude={"month"}))
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return pay.payment_dto(p)


@router.patch("/merchant-payments/{payment_id}", dependencies=[_write])
async def update_payment(payment_id: str, dto: PaymentInput, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    p = await db.get(MerchantPayment, payment_id)
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    data = dto.model_dump(exclude_unset=True)
    if "month" in data:
        month = _month(data.pop("month"))
        if month and month != p.month:
            if await _taken(db, p.merchant_id, month, p.id):
                raise HTTPException(status_code=409, detail=f"{month:%B %Y} is already recorded for this merchant.")
            p.month = month
    _apply(p, data)
    p.imported_by = user.id
    await db.commit()
    await db.refresh(p)
    return pay.payment_dto(p)


@router.delete("/merchant-payments/{payment_id}", status_code=204, dependencies=[_write])
async def delete_payment(payment_id: str, db: AsyncSession = Depends(get_db)):
    p = await db.get(MerchantPayment, payment_id)
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    await db.delete(p)
    await db.commit()
    return Response(status_code=204)
