"""Port of auth.controller.ts + user.controller.ts."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.audit import audited
from app.common.deps import AuthenticatedUser, get_current_user, require_capability
from app.common.security.throttle import login_throttle
from app.db.session import get_db
from app.models.auth import User
from app.models.enums import Role
from app.modules.auth.service import AuthService, UserService
from app.schemas.auth import (
    AuthResponseDto,
    PaginatedUsersDto,
    ChangePasswordDto,
    LoginDto,
    QueryUserDto,
    RefreshTokenDto,
    RegisterDto,
    TemporaryPasswordDto,
    UpdateUserDto,
    UserResponseDto,
)

auth_router = APIRouter(prefix="/auth", tags=["Auth"])
users_router = APIRouter(prefix="/users", tags=["Users"], dependencies=[Depends(require_capability("users.manage"))])


# ---------------------------------------------------------------- Auth ----
@auth_router.post("/login", response_model=AuthResponseDto)
async def login(dto: LoginDto, request: Request, db: AsyncSession = Depends(get_db)):
    ip = request.client.host if request.client else None
    # Brute-force guard: 10 failed passwords per (IP, email) per 10 minutes,
    # the same rule the per-website /admin editor login already applies.
    throttle_key = f"{ip or '-'}|{dto.email.lower()}"
    if login_throttle.is_blocked(throttle_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many sign-in attempts. Try again in a few minutes.",
            headers={"Retry-After": str(login_throttle.retry_after(throttle_key))},
        )
    service = AuthService(db)
    try:
        result = await service.login(dto.email, dto.password, ip=ip, user_agent=request.headers.get("user-agent"))
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            login_throttle.record_failure(throttle_key)
        raise
    login_throttle.reset(throttle_key)
    return result


@auth_router.post("/refresh", response_model=AuthResponseDto)
async def refresh(dto: RefreshTokenDto, request: Request, db: AsyncSession = Depends(get_db)):
    service = AuthService(db)
    return await service.refresh(dto.refreshToken, ip=request.client.host if request.client else None,
                                  user_agent=request.headers.get("user-agent"))


@auth_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    dto: RefreshTokenDto,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    await AuthService(db).logout(dto.refreshToken)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@auth_router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    await AuthService(db).logout_all(user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@auth_router.get("/me", response_model=UserResponseDto)
async def me(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    return await UserService(db).find_one(user.id)


@auth_router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    dto: ChangePasswordDto,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    await UserService(db).change_password(user.id, dto)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------- Users ----
async def _users_audit_read(id: str, db: AsyncSession):
    return await UserService(db).find_one_raw(id)


@users_router.post("", response_model=UserResponseDto, status_code=status.HTTP_201_CREATED)
@audited(entity_type="User")
async def create_user(dto: RegisterDto, request: Request, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(get_current_user)):
    if dto.role == Role.SUPER_ADMIN and user.role != Role.SUPER_ADMIN.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a Super Admin can create a Super Admin")
    return await UserService(db).create(dto)


@users_router.get("", response_model=PaginatedUsersDto)
async def list_users(query: QueryUserDto = Depends(), db: AsyncSession = Depends(get_db)):
    return await UserService(db).find_all(query)


@users_router.get("/{id}", response_model=UserResponseDto)
async def get_user(id: str, db: AsyncSession = Depends(get_db)):
    return await UserService(db).find_one(id)


@users_router.patch("/{id}", response_model=UserResponseDto)
@audited(entity_type="User", id_param="id", read=_users_audit_read)
async def update_user(
    id: str,
    dto: UpdateUserDto,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    if id == user.id and (dto.role or dto.status):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot change your own role or status")
    await _guard_super_admin(db, user, id, dto.role)
    return await UserService(db).update(id, dto, actor_role=user.role)


@users_router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
@audited(entity_type="User", id_param="id", read=_users_audit_read)
async def delete_user(
    id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    if id == user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot delete your own account")
    await UserService(db).remove(id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@users_router.post("/{id}/reset-password", response_model=TemporaryPasswordDto)
async def reset_password(
    id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """Settings → Team: give someone a new temporary password (shown once)
    and sign them out everywhere. Use Profile → Change password for your own."""
    if id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use Change password for your own account")
    await _guard_super_admin(db, user, id, None)
    temp = await UserService(db).reset_password(id)
    # Audited by hand: @audited would store the response, i.e. the password.
    from app.common.audit import _write_log
    from app.models.enums import AuditAction, AuditOutcome

    await _write_log(
        db,
        actor_id=user.id,
        actor_email=user.email,
        actor_role=user.role,
        action=AuditAction.UPDATE,
        entity_type="User",
        entity_id=id,
        merchant_id=None,
        before=None,
        after={"passwordReset": True},
        changed_fields=["password"],
        method=request.method,
        path=str(request.url.path),
        outcome=AuditOutcome.SUCCESS,
        status_code=200,
        error_message=None,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return {"temporaryPassword": temp}


async def _guard_super_admin(db: AsyncSession, actor: AuthenticatedUser, target_id: str, new_role) -> None:
    """Super Admin accounts are only touched by a Super Admin: an Admin can't
    edit, suspend or reset one, nor promote anyone to Super Admin."""
    if actor.role == Role.SUPER_ADMIN.value:
        return
    if new_role == Role.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a Super Admin can grant the Super Admin role")
    target = await db.get(User, target_id)
    if target is not None and target.role == Role.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a Super Admin can change a Super Admin account")
