"""Guards for the hosting setup (Vercel + shared Supabase Postgres).

See scripts/deploy.py, app/db/schemas.py and pyproject.toml.
"""
from __future__ import annotations

import pathlib
import tomllib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _requirements() -> list[str]:
    lines = (ROOT / "requirements.txt").read_text().splitlines()
    return [line.split("#")[0].strip() for line in lines if line.split("#")[0].strip()]


def test_pyproject_dependencies_match_requirements():
    # Vercel installs from pyproject.toml, the Dockerfile from requirements.txt:
    # they must list exactly the same packages and pins.
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text())
    assert pyproject["project"]["dependencies"] == _requirements()


def test_vercel_build_runs_the_release_step():
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text())
    assert pyproject["tool"]["vercel"]["scripts"]["build"] == "python -m scripts.deploy"


@pytest.fixture()
def settings_env(monkeypatch):
    from app.config import get_settings

    def _apply(**env):
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        get_settings.cache_clear()
        return get_settings()

    yield _apply
    get_settings.cache_clear()


def test_schema_helpers_are_noops_without_prefix(settings_env, monkeypatch):
    monkeypatch.delenv("DB_SCHEMA_PREFIX", raising=False)
    settings_env()
    from app.db import schemas

    assert schemas.schema_translate_map() is None
    assert schemas.qualified("profiling") == "profiling"


def test_schema_helpers_apply_prefix(settings_env):
    settings_env(DB_SCHEMA_PREFIX="superapp_")
    from app.db import schemas

    mapping = schemas.schema_translate_map()
    assert mapping is not None
    assert mapping["auth"] == "superapp_auth"
    assert set(mapping) == set(schemas.APP_SCHEMAS)
    assert schemas.qualified("marketing") == "superapp_marketing"
    with pytest.raises(ValueError):
        schemas.qualified("public")


def test_deploy_skips_database_on_vercel_preview(monkeypatch):
    from scripts import deploy

    calls = []
    monkeypatch.setattr(deploy, "_run", lambda *a: calls.append(a))
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("VERCEL_ENV", "preview")
    assert deploy.main() == 0
    assert calls == []


def test_deploy_fails_without_database_in_production(monkeypatch):
    from scripts import deploy

    monkeypatch.setattr(deploy, "_run", lambda *a: pytest.fail("must not run"))
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("VERCEL_ENV", "production")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DIRECT_URL", raising=False)
    assert deploy.main() == 1


@pytest.mark.parametrize("password,expect_admin", [("", False), ("ChangeMe123!", False), ("short", False), ("a-real-long-password-1", True)])
def test_deploy_only_seeds_admin_with_real_password(monkeypatch, password, expect_admin):
    from scripts import deploy

    calls = []
    monkeypatch.setattr(deploy, "_run", lambda *a: calls.append(a))
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("VERCEL_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
    monkeypatch.setenv("DIRECT_URL", "postgresql://u:p@h/db")
    monkeypatch.setenv("SUPER_ADMIN_EMAIL", "admin@example.com")
    monkeypatch.setenv("SUPER_ADMIN_PASSWORD", password)
    assert deploy.main() == 0
    assert ("-m", "alembic", "upgrade", "head") in calls
    assert (("-m", "scripts.seed_admin") in calls) is expect_admin
