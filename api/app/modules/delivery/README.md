# delivery/ — BOUNDARY module (not yet built)

Owns `delivery.delivery_item` (one row per Merchant × Service; expectations inherit
from `catalog.entitlement`). Seeded during Merchant onboarding but **owned by
Delivery/Ops**, not Merchant Profiling.

No router or service yet — the SQLAlchemy model (`app.models.boundary.DeliveryItem`)
exists so the table is created and other modules can seed it, but there is no API
surface. When this module is built its persistence and use-cases move here, and
its router gets included into `app.main`.
