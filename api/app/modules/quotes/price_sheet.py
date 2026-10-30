"""Innowi's official restaurant price sheet ("Restaurant Platform Pricing", 3 pages,
received 2026-10-18), as the starting price list for the quote builder.

This only seeds the price list: scripts/seed_quotes.py inserts the SKUs that are
missing and never overwrites a row, so prices edited in the app stay as edited.
A copy of the sheet, transcribed, lives in the project docs (innowi-pricing.md).

All prices are per location, USD.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Optional, TypedDict

# The software price of the first station at a location. Every further station
# (POS terminal or handheld) is billed at that device's own monthly price.
FIRST_STATION_SKU = "SW-POS-FIRST"
LEASE_MONTHS = 36


class SheetItem(TypedDict, total=False):
    sku: str
    name: str
    description: Optional[str]
    note: Optional[str]
    section: str
    kind: str
    unit_label: Optional[str]
    monthly_price: Optional[Decimal]
    purchase_price: Optional[Decimal]
    lease_price: Optional[Decimal]
    is_station: bool
    selectable: bool
    max_qty: int
    bundled_in_sku: Optional[str]


def _d(v: Optional[str]) -> Optional[Decimal]:
    return Decimal(v) if v is not None else None


def _device(sku, name, description, purchase, lease, monthly, *, station=False, note=None) -> SheetItem:
    return SheetItem(sku=sku, name=name, description=description, note=note, section="devices", kind="DEVICE",
                     purchase_price=_d(purchase), lease_price=_d(lease), monthly_price=_d(monthly),
                     is_station=station, max_qty=20)


def _hw(sku, name, description, purchase, lease=None, *, section="hardware", max_qty=20) -> SheetItem:
    return SheetItem(sku=sku, name=name, description=description, section=section, kind="HARDWARE",
                     purchase_price=_d(purchase), lease_price=_d(lease), max_qty=max_qty)


def _sw(sku, name, monthly, *, description=None, note=None, unit_label=None, section="software", max_qty=1,
        bundled_in=None) -> SheetItem:
    return SheetItem(sku=sku, name=name, description=description, note=note, section=section, kind="SOFTWARE",
                     monthly_price=_d(monthly), unit_label=unit_label, max_qty=max_qty, bundled_in_sku=bundled_in)


def _svc(sku, name, price, *, description=None, note=None) -> SheetItem:
    return SheetItem(sku=sku, name=name, description=description, note=note, section="services", kind="SERVICE",
                     purchase_price=_d(price), max_qty=1)


SECTIONS: list[dict[str, str]] = [
    {"key": "devices", "title": "Stations and devices", "blurb": "Hardware plus the monthly POS software for each device."},
    {"key": "hardware", "title": "Printers and accessories", "blurb": "Card readers come from your payment processor."},
    {"key": "networking", "title": "Networking", "blurb": "Routers, switches and access points."},
    {"key": "software", "title": "Software add-ons", "blurb": "Monthly, per location."},
    {"key": "marketing", "title": "Marketing package", "blurb": "Optional. Everything else works without it."},
    {"key": "services", "title": "One-time setup services", "blurb": "Paid once at the start."},
]

PRICE_SHEET: list[SheetItem] = [
    # ── Stations and devices: hardware (buy or 36-month lease) + monthly software ──
    _device("DEV-POS", "POS station", "Dual-sided POS terminal (Landi)",
            "873", "33.95", "24.95", station=True,
            note="First station $99/mo, each additional station $24.95/mo"),
    _device("DEV-HANDHELD", "Handheld POS", "iMin handheld (mPOS)",
            "428", "16.95", "24.95", station=True, note="$99/mo when it's the only station"),
    _device("DEV-KIOSK", "Self-serve kiosk, 24\"", "With long stand and arm",
            "774", "29.95", "49.95"),
    _device("DEV-KDS-15", "Kitchen display, 15.4\"", "ELC tablet with arm", "558", "21.95", "19.95"),
    _device("DEV-KDS-24", "Kitchen display, 24\"", "ELC tablet with arm", "666", "25.95", "19.95"),
    # Pricing rule, not offered on its own: the first station's software price.
    SheetItem(sku=FIRST_STATION_SKU, name="POS software (Gold), first station", section="devices", kind="SOFTWARE",
              monthly_price=Decimal("99.00"), selectable=False, max_qty=1,
              description="Applied automatically to the first POS station or handheld"),
    # ── Printers and accessories ──
    _hw("HW-CASH-DRAWER", "Cash drawer, 16\"", "Volcora", "73", "1.95"),
    _hw("HW-KITCHEN-PRINTER", "Kitchen printer", "Star Micronics MCP30", "399", "14.95"),
    _hw("HW-RECEIPT-PRINTER", "Receipt printer", "Epson TM-30II thermal printer", "355", "13.95"),
    _hw("HW-INSTALL-KIT", "Installation kit", "Ethernet cables, arms, VESA mounts, etc.", "135", "4.95"),
    # ── Networking ──
    _hw("NET-PC64HC16", "Cellular WiFi 6 router, HaLow, CAT 16", "Pronto PC64HC16", "499", "18.95", section="networking"),
    _hw("NET-PC63HC4", "Cellular WiFi 6 router, HaLow, CAT 4", "Pronto PC63HC4", "399", "14.95", section="networking"),
    _hw("NET-PC64C16", "Cellular WiFi 6 router, CAT 16", "Pronto PC64C16", "435", "16.95", section="networking"),
    _hw("NET-PC64C4", "Cellular WiFi 6 router, CAT 4", "Pronto PC64C4", "399", "14.95", section="networking"),
    _hw("NET-PC63C4", "Cellular WiFi 6 router, CAT 4 (PC63C4)", "Pronto PC63C4", "349", "12.95", section="networking"),
    _hw("NET-PC64C0", "WiFi 6 router", "Pronto PC64C0", "329", "12.95", section="networking"),
    _hw("NET-OMADA", "Router + 5-port switch", "Omada Pro router with integrated WiFi", "239", "8.95", section="networking"),
    _hw("NET-SW8", "Cloud-managed PoE switch, 8-port", "Pronto SCB-08P", "275", "9.95", section="networking"),
    _hw("NET-SW16", "Cloud-managed PoE switch, 16-port", "Pronto SCB-16P", "399", "14.95", section="networking"),
    _hw("NET-SW24", "Cloud-managed PoE switch, 24-port", "Pronto SCB-24P", "545", "20.95", section="networking"),
    _hw("NET-AP-IN", "WiFi 6 access point, indoor", "Pronto PC26", "349", "12.95", section="networking"),
    _hw("NET-AP-OUT", "WiFi 6 access point, outdoor", "Pronto PC27", "399", "14.95", section="networking"),
    _hw("NET-CAT6-6", "Cat6 patch cable, 6 ft", None, "3", None, section="networking", max_qty=100),
    _hw("NET-CAT6-10", "Cat6 patch cable, 10 ft", None, "3", None, section="networking", max_qty=100),
    # ── Software add-ons (monthly) ──
    # Included in the marketing package: can't be added on top of it.
    _sw("SW-EMAIL-SMS", "Email and SMS campaigns", "49.95", note="500 SMS included; $0.02 per additional segment",
        bundled_in="MKT-PACKAGE"),
    _sw("SW-PHONE-LINK", "Phone link ordering", "14.95"),
    _sw("SW-ORDERHUB", "OrderHub", "49.95", description="Third-party delivery orders in one place",
        note="You provide access to your delivery apps"),
    _sw("SW-ESIM", "eSIM data", "12.00", unit_label="GB", max_qty=50, note="Per GB of monthly data"),
    # ── Marketing package (optional add-on) ──
    _sw("MKT-PACKAGE", "Marketing package", "249.00", section="marketing",
        description="SEO, Google Business Profile, Google Ads management, email campaigns, loyalty, "
                    "gift cards, review management, print menu and ad design, TV digital menu design",
        note="+5% per online pickup and delivery order, paid by the merchant. Google ad spend is paid by the merchant."),
    # ── One-time services ──
    _svc("SVC-DEPLOY", "Deployment and installation", "750", description="Deploy, train, and onboard"),
    _svc("SVC-MENU", "Menu engineering", "250", description="POS, kiosk, and online menus"),
    _svc("SVC-WEBSITE", "Website design", "1000", description="Restaurant-owned website",
         note="Plus $50/year for domain renewal and hosting"),
]

GOLD_INCLUDED: list[str] = ["Online ordering", "Loyalty & rewards", "QR code ordering", "Gift cards", "Table management"]

TERMS: list[str] = [
    "Initial term is 3 years.",
    "Shipping, sales tax, warranty, and insurance are added to the hardware cost.",
    "Hardware lease is over 36 months.",
    "Annual $50 charge for domain renewal and website hosting (website design).",
    "Merchant pays for optional Google Ad spend; we suggest a minimum of $100. Requires the marketing package.",
    "500 SMS included in SMS campaigns; additional SMS segments are $0.02 each.",
    "Tips on online delivery orders are paid to the driver.",
    "Merchant is responsible for all chargebacks.",
    "Merchant provides access to third-party delivery apps for OrderHub.",
    "Merchant provides access to the website domain and Google Business Profile for marketing.",
    "Payment processing and card readers are provided by the payment processor.",
]
