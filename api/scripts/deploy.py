"""
Release step: bring the database up to date, then load idempotent reference data.

    python -m scripts.deploy

Run it once per deploy, before the new code takes traffic:

* Vercel - wired in as the build script (pyproject.toml [tool.vercel.scripts]).
  It only touches the database for **production** deployments; preview builds
  share the same env vars, and must never migrate the shared database with
  unmerged code.
* Docker / Render - use the same command as a pre-deploy / release command.

Steps (each is idempotent and safe to re-run):
1. ``alembic upgrade head``
2. ``scripts.seed``          - packages, service catalog, entitlement matrix
3. ``scripts.seed_websites`` - the bundled sample websites (adds missing slugs only)
4. ``scripts.seed_admin``    - only when SUPER_ADMIN_EMAIL and a real
   SUPER_ADMIN_PASSWORD are set. Without them no admin is created, rather than
   creating one with the well-known default password.
"""
from __future__ import annotations

import os
import subprocess
import sys

# Placeholders that must never become a real password (mirrors app/config.py).
_PLACEHOLDER_PASSWORDS = {"ChangeMe123!", "admin123", "password", "changeme"}
_MIN_ADMIN_PASSWORD_LENGTH = 12


def _run(*args: str) -> None:
    print(f"[deploy] $ {' '.join(args)}", flush=True)
    subprocess.run([sys.executable, *args], check=True)


def main() -> int:
    on_vercel = os.getenv("VERCEL") == "1"
    vercel_env = os.getenv("VERCEL_ENV")
    if on_vercel and vercel_env != "production":
        print(f"[deploy] Vercel {vercel_env or 'unknown'} build: skipping migrations and seeds "
              "(only production deployments touch the database).")
        return 0

    if not os.getenv("DATABASE_URL") or not os.getenv("DIRECT_URL"):
        print("[deploy] DATABASE_URL / DIRECT_URL are not set - cannot migrate. Failing the release "
              "so a build without a database never goes live.", file=sys.stderr)
        return 1

    _run("-m", "alembic", "upgrade", "head")
    _run("-m", "scripts.seed")
    _run("-m", "scripts.seed_websites")
    _run("-m", "scripts.seed_quotes")

    email = (os.getenv("SUPER_ADMIN_EMAIL") or "").strip()
    password = os.getenv("SUPER_ADMIN_PASSWORD") or ""
    if email and len(password) >= _MIN_ADMIN_PASSWORD_LENGTH and password not in _PLACEHOLDER_PASSWORDS:
        _run("-m", "scripts.seed_admin")
    else:
        print("[deploy] Skipping the Super Admin seed: set SUPER_ADMIN_EMAIL and a SUPER_ADMIN_PASSWORD of "
              f"at least {_MIN_ADMIN_PASSWORD_LENGTH} characters (not a placeholder) to create the first admin.")

    # After the admin seed, so the roadmap's owners can be matched to users.
    _run("-m", "scripts.seed_roadmap")

    print("[deploy] Release step finished.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
