# performance/ — BOUNDARY module (not yet built)

Owns `performance.baseline` (frozen day-zero snapshots) and
`performance.scorecard_entry` (monthly KPI target vs actual). Seeded here but
**owned by Performance/Reporting**.

No router or service yet — the SQLAlchemy models (`app.models.boundary.Baseline`,
`app.models.boundary.ScorecardEntry`) exist so the tables are created, but there
is no API surface.
