"""
Give (or take away) a per-person capability, e.g. let someone create tickets.

    python -m scripts.grant_capability aima@innowi.com maheen@innowi.com
    python -m scripts.grant_capability --capability ticket.manage someone@innowi.com
    python -m scripts.grant_capability --revoke someone@innowi.com
    python -m scripts.grant_capability --list

Only capabilities in app.common.capabilities.USER_GRANTABLE can be granted
(today: ticket.manage). Admins can do the same through
PATCH /api/v1/users/:id with {"grantedCapabilities": [...]}.
Changes apply on the person's next request — no re-login needed.
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.common.capabilities import USER_GRANTABLE
from app.db.session import SessionLocal
from app.models.auth import User


async def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("emails", nargs="*")
    parser.add_argument("--capability", default="ticket.manage", choices=sorted(USER_GRANTABLE))
    parser.add_argument("--revoke", action="store_true", help="remove the capability instead of granting it")
    parser.add_argument("--list", action="store_true", help="show everyone who holds a granted capability")
    args = parser.parse_args(argv)

    async with SessionLocal() as db:
        if args.list:
            rows = (await db.execute(select(User).where(User.granted_capabilities != []).order_by(User.email))).scalars().all()
            if not rows:
                print("Nobody has a granted capability.")
            for u in rows:
                print(f"{u.email:40} {', '.join(u.granted_capabilities)}")
            return 0

        if not args.emails:
            parser.error("give at least one email (or --list)")

        failed = 0
        for raw in args.emails:
            email = raw.strip().lower()
            user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
            if not user:
                print(f"✗ {email}: no such user")
                failed += 1
                continue
            current = set(user.granted_capabilities or [])
            if args.revoke:
                current.discard(args.capability)
            else:
                current.add(args.capability)
            user.granted_capabilities = sorted(current)
            verb = "revoked from" if args.revoke else "granted to"
            print(f"✓ {args.capability} {verb} {email}")
        await db.commit()
        return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
