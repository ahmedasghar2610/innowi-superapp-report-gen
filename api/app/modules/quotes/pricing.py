"""The quote builder's pricing engine. Pure functions, no database.

Inputs: the price list rows a link may offer (already resolved to that link's
special pricing), what the restaurant picked, and buy-or-lease for hardware.
Output: priced lines and totals, the same for the live preview, the stored
proposal and the PDF.

Rules (from the price sheet):

* A device = its hardware (bought outright, or leased per month) + its monthly
  software, one of each per unit.
* Stations (POS terminal, handheld): the first station at the location is billed
  the first-station price ($99/mo on the sheet); every other station is billed
  its own monthly price ($24.95/mo). So a handheld is $99/mo only when it is the
  only station.
* Hardware without a lease price is always bought, even on a lease plan.
* Money is rounded to cents per unit price, then multiplied by the quantity.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Optional

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
HUNDRED = Decimal("100")

BUY = "BUY"
LEASE = "LEASE"
HARDWARE_PLANS = (BUY, LEASE)

ONE_TIME = "ONE_TIME"
MONTHLY = "MONTHLY"


def money(v: Decimal | int | float | str) -> Decimal:
    return Decimal(str(v)).quantize(CENT, rounding=ROUND_HALF_UP)


def apply_percent_off(price: Optional[Decimal], percent: Optional[Decimal]) -> Optional[Decimal]:
    if price is None:
        return None
    if not percent:
        return money(price)
    return money(Decimal(price) * (HUNDRED - Decimal(percent)) / HUNDRED)


@dataclass(frozen=True)
class Override:
    """Special pricing for one item on one link. A set price wins over percent_off."""

    percent_off: Optional[Decimal] = None
    monthly_price: Optional[Decimal] = None
    purchase_price: Optional[Decimal] = None
    lease_price: Optional[Decimal] = None
    hidden: bool = False

    @property
    def has_pricing(self) -> bool:
        return any(v is not None for v in (self.percent_off, self.monthly_price, self.purchase_price, self.lease_price))


@dataclass(frozen=True)
class OfferItem:
    """One price-list row as offered on one link: list prices and the client's prices."""

    id: str
    sku: str
    name: str
    section: str
    kind: str
    description: Optional[str]
    note: Optional[str]
    unit_label: Optional[str]
    is_station: bool
    selectable: bool
    max_qty: int
    sort_order: int
    bundled_in_sku: Optional[str]
    list_monthly: Optional[Decimal]
    list_purchase: Optional[Decimal]
    list_lease: Optional[Decimal]
    monthly: Optional[Decimal]
    purchase: Optional[Decimal]
    lease: Optional[Decimal]

    @property
    def discounted(self) -> bool:
        pairs = ((self.list_monthly, self.monthly), (self.list_purchase, self.purchase), (self.list_lease, self.lease))
        return any(lst is not None and cur is not None and cur < lst for lst, cur in pairs)


def resolve_item(row, override: Optional[Override], link_discount: Decimal | None) -> OfferItem:
    """List prices + this link's special pricing -> the prices this client gets.

    Per price field: a price set on the override wins; otherwise the override's
    percent_off; otherwise the link-wide discount; otherwise the list price.
    """
    discount = link_discount or ZERO

    def pick(list_price: Optional[Decimal], set_price: Optional[Decimal]) -> Optional[Decimal]:
        if list_price is None:
            return None
        if set_price is not None:
            return money(set_price)
        if override is not None and override.percent_off is not None:
            return apply_percent_off(list_price, override.percent_off)
        return apply_percent_off(list_price, discount)

    o = override or Override()
    lm = money(row.monthly_price) if row.monthly_price is not None else None
    lp = money(row.purchase_price) if row.purchase_price is not None else None
    ll = money(row.lease_price) if row.lease_price is not None else None
    return OfferItem(
        id=row.id, sku=row.sku, name=row.name, section=row.section, kind=row.kind, description=row.description,
        note=row.note, unit_label=row.unit_label, is_station=bool(row.is_station), selectable=bool(row.selectable),
        max_qty=int(row.max_qty), sort_order=int(row.sort_order),
        bundled_in_sku=getattr(row, "bundled_in_sku", None),
        list_monthly=lm, list_purchase=lp, list_lease=ll,
        monthly=pick(lm, o.monthly_price), purchase=pick(lp, o.purchase_price), lease=pick(ll, o.lease_price),
    )


@dataclass
class Line:
    sku: str
    name: str
    section: str
    category: str  # hardware | lease | software | service
    billing: str  # ONE_TIME | MONTHLY
    qty: int
    unit_list: Decimal
    unit_price: Decimal
    detail: Optional[str] = None
    unit_label: Optional[str] = None

    @property
    def total(self) -> Decimal:
        return money(self.unit_price * self.qty)

    @property
    def list_total(self) -> Decimal:
        return money(self.unit_list * self.qty)

    def as_dict(self) -> dict:
        return {
            "sku": self.sku, "name": self.name, "section": self.section, "category": self.category,
            "billing": self.billing, "qty": self.qty, "unitList": str(self.unit_list),
            "unitPrice": str(self.unit_price), "total": str(self.total), "listTotal": str(self.list_total),
            "detail": self.detail, "unitLabel": self.unit_label,
        }


@dataclass
class Quote:
    lines: list[Line] = field(default_factory=list)

    def _sum(self, pred, attr: str = "total") -> Decimal:
        return money(sum((getattr(line, attr) for line in self.lines if pred(line)), ZERO))

    @property
    def one_time_total(self) -> Decimal:
        return self._sum(lambda line: line.billing == ONE_TIME)

    @property
    def monthly_software_total(self) -> Decimal:
        return self._sum(lambda line: line.billing == MONTHLY and line.category == "software")

    @property
    def monthly_lease_total(self) -> Decimal:
        return self._sum(lambda line: line.billing == MONTHLY and line.category == "lease")

    @property
    def monthly_total(self) -> Decimal:
        return money(self.monthly_software_total + self.monthly_lease_total)

    @property
    def list_one_time_total(self) -> Decimal:
        return self._sum(lambda line: line.billing == ONE_TIME, "list_total")

    @property
    def list_monthly_total(self) -> Decimal:
        return self._sum(lambda line: line.billing == MONTHLY, "list_total")

    def totals(self) -> dict:
        return {
            "oneTime": str(self.one_time_total),
            "monthlySoftware": str(self.monthly_software_total),
            "monthlyLease": str(self.monthly_lease_total),
            "monthly": str(self.monthly_total),
            "listOneTime": str(self.list_one_time_total),
            "listMonthly": str(self.list_monthly_total),
            "savingsOneTime": str(money(self.list_one_time_total - self.one_time_total)),
            "savingsMonthly": str(money(self.list_monthly_total - self.monthly_total)),
        }


class PricingError(ValueError):
    pass


def apply_bundles(
    offer: dict[str, OfferItem], selections: Iterable[tuple[str, int]]
) -> tuple[list[tuple[str, int]], list[str]]:
    """Drop selections already included in a selected bundle.

    An item whose ``bundled_in_sku`` names another selected item (e.g. email/SMS
    campaigns inside the marketing package) is removed rather than billed twice.
    Returns (kept selections, names of what was dropped). Unknown item ids pass
    through untouched - price_quote rejects them with its own message.
    """
    picked_skus = {offer[i].sku for i, q in selections if q > 0 and i in offer}
    kept: list[tuple[str, int]] = []
    dropped: list[str] = []
    for item_id, qty in selections:
        item = offer.get(item_id)
        if qty > 0 and item is not None and item.bundled_in_sku and item.bundled_in_sku in picked_skus:
            dropped.append(item.name)
            continue
        kept.append((item_id, qty))
    return kept, dropped


def _hardware_line(item: OfferItem, qty: int, plan: str) -> Line:
    if plan == LEASE and item.lease is not None:
        return Line(item.sku, item.name, item.section, "lease", MONTHLY, qty, item.list_lease or item.lease,
                    item.lease, detail=item.description, unit_label="lease / mo")
    if item.purchase is None:
        raise PricingError(f"{item.name} has no purchase price")
    return Line(item.sku, item.name, item.section, "hardware", ONE_TIME, qty, item.list_purchase or item.purchase,
                item.purchase, detail=item.description)


def price_quote(
    offer: dict[str, OfferItem],
    selections: Iterable[tuple[str, int]],
    plan: str,
    first_station: Optional[OfferItem],
) -> Quote:
    """Price what was picked. `offer` maps item id -> OfferItem (only what this link offers)."""
    if plan not in HARDWARE_PLANS:
        raise PricingError("hardware plan must be BUY or LEASE")

    picked: dict[str, int] = {}
    for item_id, qty in selections:
        if not isinstance(qty, int) or qty < 0:
            raise PricingError("quantities must be whole numbers, 0 or more")
        if qty == 0:
            continue
        item = offer.get(item_id)
        if item is None or not item.selectable:
            raise PricingError("one of the items isn't available on this quote")
        total = picked.get(item_id, 0) + qty
        if total > item.max_qty:
            raise PricingError(f"{item.name}: at most {item.max_qty}")
        picked[item_id] = total

    items = sorted((offer[i] for i in picked), key=lambda it: (it.sort_order, it.name))
    quote = Quote()
    stations_billed = 0
    for item in items:
        qty = picked[item.id]
        if item.kind in ("DEVICE", "HARDWARE"):
            quote.lines.append(_hardware_line(item, qty, plan))
        if item.kind == "DEVICE":
            if item.monthly is None:
                raise PricingError(f"{item.name} has no monthly software price")
            n = qty
            first_here = (
                item.is_station and stations_billed == 0
                and first_station is not None and first_station.monthly is not None
            )
            if first_here:
                quote.lines.append(Line(first_station.sku, first_station.name, item.section, "software", MONTHLY, 1,
                                        first_station.list_monthly or first_station.monthly, first_station.monthly,
                                        detail=f"For your first station ({item.name})", unit_label="/ mo"))
                n -= 1
            if n > 0:
                detail = "Additional stations" if item.is_station and (first_here or stations_billed > 0) else None
                quote.lines.append(Line(f"{item.sku}-SW", f"{item.name} software", item.section, "software", MONTHLY,
                                        n, item.list_monthly or item.monthly, item.monthly, detail=detail,
                                        unit_label="/ mo"))
            if item.is_station:
                stations_billed += qty
        elif item.kind == "SOFTWARE":
            if item.monthly is None:
                raise PricingError(f"{item.name} has no monthly price")
            quote.lines.append(Line(item.sku, item.name, item.section, "software", MONTHLY, qty,
                                    item.list_monthly or item.monthly, item.monthly, detail=item.note,
                                    unit_label=f"/ {item.unit_label} / mo" if item.unit_label else "/ mo"))
        elif item.kind == "SERVICE":
            if item.purchase is None:
                raise PricingError(f"{item.name} has no price")
            quote.lines.append(Line(item.sku, item.name, item.section, "service", ONE_TIME, qty,
                                    item.list_purchase or item.purchase, item.purchase, detail=item.description))
    if not quote.lines:
        raise PricingError("pick at least one item")
    return quote
