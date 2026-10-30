"""
Port of prisma/seed-admin.ts. Bootstraps the default SUPER_ADMIN user.
Idempotent — never overwrites an existing password, only re-asserts role/status.

Run: python -m scripts.seed_admin
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from sqlalchemy import select

from app.common.security.password import hash_password
from app.config import get_settings
from app.db.session import SessionLocal
from app.models.auth import User
from app.models.enums import Role, UserStatus


async def main() -> None:
    settings = get_settings()
    email = (settings.SUPER_ADMIN_EMAIL or "superadmin@innowi.com").lower()
    password = settings.SUPER_ADMIN_PASSWORD or "ChangeMe123!"

    async with SessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()

        if existing:
            existing.role = Role.SUPER_ADMIN
            existing.status = UserStatus.ACTIVE
            await db.commit()
            print(f"[seed:admin] Super Admin already exists ({email}) — role/status verified, password unchanged.")
            return

        user = User(
            email=email,
            password_hash=hash_password(password),
            first_name="Super",
            last_name="Admin",
            role=Role.SUPER_ADMIN,
            status=UserStatus.ACTIVE,
            password_changed_at=datetime.now(timezone.utc),
        )
        db.add(user)
        await db.commit()

        print("==========================================================")
        print("[seed:admin] Default Super Admin user created:")
        print(f"  email:    {email}")
        # Never echo the password - this runs in deploy logs (scripts/deploy.py).
        print("  password: (the SUPER_ADMIN_PASSWORD you configured)" if settings.SUPER_ADMIN_PASSWORD else f"  password: {password}")
        print("  >>> CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN <<<")
        print("  (POST /api/v1/auth/change-password)")
        print("==========================================================")


if __name__ == "__main__":
    asyncio.run(main())
