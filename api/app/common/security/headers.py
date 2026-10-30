"""
Security response headers for every response the API sends.

Ported from Final-MVP's `vercel.json` header block (X-Content-Type-Options,
X-Frame-Options, Referrer-Policy, Content-Security-Policy) and applied here
as ASGI middleware so the API is protected no matter which host serves it
(Docker, Railway, Render, bare uvicorn) rather than only behind Vercel.

The API only ever returns JSON, file streams and the Swagger UI, so the CSP
is deliberately strict: nothing may frame it, nothing may load plugins, and
only Swagger's own assets (the `/api/docs` page) are allowed to run scripts.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

# Swagger UI at /api/docs loads its bundle from the jsdelivr CDN (FastAPI's
# default), so that one page needs a looser script/style policy.
_DOCS_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "img-src 'self' data: https://fastapi.tiangolo.com; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "object-src 'none'; "
    "base-uri 'self'"
)

# Everything else is data, not a document: nothing may run.
_API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

_DOCS_PATHS = ("/api/docs", "/api/openapi.json")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, hsts: bool = False) -> None:
        super().__init__(app)
        self.hsts = hsts

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        headers = response.headers

        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        headers.setdefault("X-XSS-Protection", "1; mode=block")
        headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault("Cross-Origin-Resource-Policy", "cross-origin")  # assets are embedded by the public sites

        path = request.url.path
        headers.setdefault("Content-Security-Policy", _DOCS_CSP if path.startswith(_DOCS_PATHS) else _API_CSP)

        # Tokens, user records and merchant data must never land in a shared
        # cache. File downloads set their own `private, no-store` already.
        if path.startswith("/api/") and "cache-control" not in headers:
            headers["Cache-Control"] = "no-store"

        # Only meaningful over HTTPS; switched on for production in main.py.
        if self.hsts:
            headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

        return response
