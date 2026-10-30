# payments/ — BOUNDARY module (not yet built)

Owns `payments.opportunity` (upsell / MRR-uplift tracker). Seeded here but
**owned by Payments (Revenue & Billing)**.

No router or service yet — the SQLAlchemy model (`app.models.boundary.Opportunity`)
exists so the table is created, but there is no API surface.
