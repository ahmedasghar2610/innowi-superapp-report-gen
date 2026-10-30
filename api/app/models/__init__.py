"""Import every model module so Base.metadata is fully populated (used by
Alembic autogenerate and by create_all in tests)."""
from app.models import auth, audit, catalog, profiling, boundary, website, salesforce, quotes, assistant, roadmap, requests, ops, gbp, ads, menu, seo, deals, report_gen  # noqa: F401
