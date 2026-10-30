# marketing/ — BOUNDARY module (not yet built)

Owns `marketing.promotion` (campaign/offer log). Note the split: the **offer
definition** is Profiling data; the **running campaign instance** is owned by
Email & SMS / Google Ads.

No router or service yet — the SQLAlchemy model (`app.models.boundary.Promotion`)
exists so the table is created, but there is no API surface.
