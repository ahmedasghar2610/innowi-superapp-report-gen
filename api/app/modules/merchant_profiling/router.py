"""Combines every merchant-profiling sub-router into one APIRouter."""
from __future__ import annotations

from fastapi import APIRouter

from app.modules.merchant_profiling.routers import (
    brand_assets,
    documents,
    fields,
    menu,
    menu_bulk,
    merchant_import,
    merchants,
    payments,
    profiles_and_refdata,
    simple_children,
)

router = APIRouter()
router.include_router(merchant_import.router)  # before merchants: /merchants/import
router.include_router(merchants.router)
router.include_router(fields.router)
router.include_router(simple_children.router)
router.include_router(documents.router)
router.include_router(brand_assets.router)
router.include_router(profiles_and_refdata.router)
router.include_router(menu.router)
router.include_router(menu_bulk.router)
router.include_router(payments.router)
