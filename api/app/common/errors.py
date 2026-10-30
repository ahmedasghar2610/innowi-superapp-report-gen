"""
Global exception handlers. Mirrors all-exceptions.filter.ts + error-response.dto.ts.
Also maps SQLAlchemy/asyncpg integrity errors to the same HTTP semantics the
Prisma repositories used: P2002 (unique) -> 409, P2025 (not found) -> 404,
P2003 (FK violation) -> 400.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, NoResultFound

logger = logging.getLogger("Exceptions")


class NotFoundError(Exception):
    """Raised by services when a row is missing. Mirrors Prisma P2025 / NotFoundException."""

    def __init__(self, message: str = "Record not found") -> None:
        self.message = message


class ConflictError(Exception):
    """Raised by services on a uniqueness violation detected pre-write. Mirrors Prisma P2002."""

    def __init__(self, message: str = "A record with these values already exists") -> None:
        self.message = message


def _error_body(status_code: int, error: str, message, path: str) -> dict:
    return {
        "statusCode": status_code,
        "error": error,
        "message": message,
        "path": path,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        message = detail if isinstance(detail, (str, list)) else str(detail)
        error = _http_status_phrase(exc.status_code)
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_body(exc.status_code, error, message, str(request.url.path)),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        messages = [f"{'.'.join(str(p) for p in e['loc'][1:])}: {e['msg']}" for e in exc.errors()]
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=_error_body(status.HTTP_400_BAD_REQUEST, "Bad Request", messages, str(request.url.path)),
        )

    @app.exception_handler(NotFoundError)
    async def not_found_handler(request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content=_error_body(status.HTTP_404_NOT_FOUND, "Not Found", exc.message, str(request.url.path)),
        )

    @app.exception_handler(ConflictError)
    async def conflict_handler(request: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=_error_body(status.HTTP_409_CONFLICT, "Conflict", exc.message, str(request.url.path)),
        )

    @app.exception_handler(NoResultFound)
    async def no_result_handler(request: Request, exc: NoResultFound) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content=_error_body(status.HTTP_404_NOT_FOUND, "Not Found", "Record not found", str(request.url.path)),
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
        # asyncpg surfaces the Postgres SQLSTATE via orig.sqlstate. 23505 =
        # unique_violation (P2002), 23503 = foreign_key_violation (P2003),
        # 23502 = not_null_violation. Anything else is an unmapped 500,
        # logged server-side just like the Prisma safety-net default case.
        sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None)
        if sqlstate == "23505":
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content=_error_body(
                    status.HTTP_409_CONFLICT, "Conflict", "A record with these values already exists", str(request.url.path)
                ),
            )
        if sqlstate == "23503":
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content=_error_body(
                    status.HTTP_400_BAD_REQUEST, "Bad Request", "Referenced record does not exist", str(request.url.path)
                ),
            )
        logger.error("Unmapped database integrity error %s: %s", sqlstate, exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_error_body(
                status.HTTP_500_INTERNAL_SERVER_ERROR, "Internal Server Error", "Internal server error", str(request.url.path)
            ),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.error("Unhandled exception", exc_info=exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_error_body(
                status.HTTP_500_INTERNAL_SERVER_ERROR, "Internal Server Error", "Internal server error", str(request.url.path)
            ),
        )


def _http_status_phrase(code: int) -> str:
    return {
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        409: "Conflict",
        413: "Payload Too Large",
        422: "Unprocessable Entity",
    }.get(code, "Error")
