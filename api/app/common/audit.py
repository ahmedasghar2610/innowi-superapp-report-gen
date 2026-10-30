"""
Port of the @Audit() decorator + global AuditInterceptor (audit.interceptor.ts).
FastAPI has no per-handler interceptor pipeline, so this is reproduced as a
route decorator (`@audited(...)`) that wraps the endpoint function: it loads
the before-snapshot (for UPDATE/DELETE), calls the handler, then writes one
AuditLog row on success or failure — exactly the fields audit.interceptor.ts
captures. Opt-in per route, same as the original: an unwrapped handler is
never audited.

Usage mirrors the Nest decorator:

    @router.patch("/contacts/{id}")
    @audited(
        entity_type="Contact",
        id_param="id",
        resolve_merchant_id=lambda entity: entity.get("merchantId") if entity else None,
        read=lambda id, db: contact_service.find_one_raw(db, id),
    )
    async def update(id: str, ...): ...

Audit writes never block or fail the underlying request: persistence happens
in a try/except that only logs on failure.
"""
from __future__ import annotations

import functools
import inspect
import json
import logging
import types
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.enums import AuditAction, AuditOutcome

logger = logging.getLogger("AuditInterceptor")

METHOD_TO_ACTION = {
    "POST": AuditAction.CREATE,
    "PUT": AuditAction.UPDATE,
    "PATCH": AuditAction.UPDATE,
    "DELETE": AuditAction.DELETE,
}


@dataclass
class AuditOptions:
    entity_type: str
    id_param: Optional[str] = None
    id_from_params: Optional[list[str]] = None
    merchant_id_param: Optional[str] = None
    resolve_merchant_id: Optional[Callable[[Optional[dict]], Optional[str]]] = None
    # async def read(id: str, db: AsyncSession) -> dict | None
    read: Optional[Callable[[str, AsyncSession], Awaitable[Optional[dict]]]] = None


def _to_plain(value: Any) -> Optional[dict]:
    if value is None:
        return None
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    if not isinstance(value, dict):
        return None
    return json.loads(json.dumps(value, default=str))


def _diff_keys(before: Optional[dict], after: Optional[dict]) -> list[str]:
    if not before or not after:
        return []
    keys = set(before.keys()) | set(after.keys())
    return [k for k in keys if json.dumps(before.get(k), default=str) != json.dumps(after.get(k), default=str)]


async def _write_log(db: AsyncSession, **kwargs) -> None:
    try:
        log = AuditLog(**kwargs)
        db.add(log)
        await db.commit()
    except Exception as e:  # pragma: no cover - defensive, mirrors interceptor's swallow-on-failure
        logger.error("Failed to write audit log for %s: %s", kwargs.get("entity_type"), e)
        try:
            await db.rollback()
        except Exception:
            pass


def audited(
    entity_type: str,
    id_param: Optional[str] = None,
    id_from_params: Optional[list[str]] = None,
    merchant_id_param: Optional[str] = None,
    resolve_merchant_id: Optional[Callable[[Optional[dict]], Optional[str]]] = None,
    read: Optional[Callable[[str, AsyncSession], Awaitable[Optional[dict]]]] = None,
):
    """
    Decorator for a FastAPI route handler. The wrapped handler MUST accept
    `request: Request` and `db: AsyncSession` among its parameters (by name),
    and — if the current user is required for the audit row — `user` (an
    AuthenticatedUser) among its parameters. Path params are read off
    `request.path_params`.
    """

    def decorator(fn: Callable[..., Awaitable[Any]]):
        async def wrapper(*args, **kwargs):
            request: Optional[Request] = kwargs.get("request")
            db: Optional[AsyncSession] = kwargs.get("db")
            user = kwargs.get("user")

            if request is None or db is None:
                # Misconfigured route — never block the business call over it.
                return await fn(*args, **kwargs)

            method = request.method
            action = METHOD_TO_ACTION.get(method)
            path_params = request.path_params

            id_from_param = path_params.get(id_param) if id_param else None
            if id_from_params:
                parts = [path_params.get(p) for p in id_from_params]
                read_id = ":".join(parts) if all(parts) else None
                entity_id_from_param = parts[-1] if parts else None
            else:
                read_id = id_from_param
                entity_id_from_param = id_from_param

            merchant_id_from_param = path_params.get(merchant_id_param) if merchant_id_param else None

            before: Optional[dict] = None
            if action is not None and action != AuditAction.CREATE and read and read_id:
                try:
                    before = await read(read_id, db)
                except Exception as e:
                    logger.warning("Audit before-read failed for %s:%s: %s", entity_type, read_id, e)
                    before = None

            try:
                result = await fn(*args, **kwargs)
            except Exception as exc:
                status_code = getattr(exc, "status_code", 500)
                error_message = getattr(exc, "detail", None) or str(exc)
                # The handler may have left partial writes pending on this
                # session. _write_log() commits, which would otherwise persist
                # them alongside the FAILURE row. Discard them first.
                try:
                    await db.rollback()
                except Exception:
                    pass
                if action is not None:
                    await _write_log(
                        db,
                        actor_id=getattr(user, "id", None),
                        actor_email=getattr(user, "email", None),
                        actor_role=getattr(user, "role", None),
                        action=action,
                        entity_type=entity_type,
                        entity_id=entity_id_from_param,
                        merchant_id=merchant_id_from_param
                        or (resolve_merchant_id(before) if resolve_merchant_id else None),
                        before=before,
                        after=None,
                        changed_fields=[],
                        method=method,
                        path=str(request.url.path),
                        outcome=AuditOutcome.FAILURE,
                        status_code=status_code,
                        error_message=str(error_message),
                        ip=request.client.host if request.client else None,
                        user_agent=request.headers.get("user-agent"),
                    )
                raise

            if action is not None:
                success_status = getattr(result, "status_code", None)
                if not isinstance(success_status, int):
                    success_status = 201 if action == AuditAction.CREATE else 200
                after = _to_plain(result) if action != AuditAction.DELETE else None
                entity_id = entity_id_from_param or (after.get("id") if after else None)
                merchant_id = merchant_id_from_param or (
                    resolve_merchant_id(after if action == AuditAction.CREATE else before)
                    if resolve_merchant_id
                    else None
                )
                await _write_log(
                    db,
                    actor_id=getattr(user, "id", None),
                    actor_email=getattr(user, "email", None),
                    actor_role=getattr(user, "role", None),
                    action=action,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    merchant_id=merchant_id,
                    before=before,
                    after=after,
                    changed_fields=_diff_keys(before, after) if action == AuditAction.UPDATE else [],
                    method=method,
                    path=str(request.url.path),
                    outcome=AuditOutcome.SUCCESS,
                    status_code=success_status,
                    error_message=None,
                    ip=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                )

            return result

        # FastAPI's get_typed_signature() resolves string annotations via
        # `call.__globals__` directly, and a function's __globals__ is fixed
        # at creation from its defining module's namespace (read-only
        # attribute). `wrapper` is defined here in audit.py, so its
        # __globals__ can't see `UploadFile`/`AsyncSession`/etc. from the
        # route module. But `wrapper`'s own bytecode also needs names that
        # live only in audit.py's namespace (METHOD_TO_ACTION, AuditAction,
        # _write_log, ...). Rebinding straight to `fn.__globals__` would
        # break those lookups (NameError at call time). Instead, rebind to a
        # merged namespace: fn's module globals (for FastAPI's annotation
        # resolution) layered with audit.py's own globals (so wrapper's body
        # keeps working) — audit.py names win on collision since they're
        # what `wrapper` was compiled against.
        merged_globals = dict(fn.__globals__)
        merged_globals.update(wrapper.__globals__)
        rebound = types.FunctionType(
            wrapper.__code__, merged_globals, name=fn.__name__, argdefs=wrapper.__defaults__, closure=wrapper.__closure__,
        )
        rebound.__kwdefaults__ = wrapper.__kwdefaults__
        rebound.__doc__ = fn.__doc__
        rebound.__qualname__ = fn.__qualname__
        rebound.__module__ = fn.__module__
        rebound.__wrapped__ = fn
        rebound.__signature__ = inspect.signature(fn)
        rebound.__annotations__ = dict(fn.__annotations__)
        return rebound

    return decorator
