"""Security measures ported from Final-MVP: response headers, environment
validation, credential encryption, and login throttling. No live DB needed."""
from __future__ import annotations

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.common.security import crypto
from app.common.security.throttle import FailureThrottle
from app.config import Settings, validate_environment
from app.main import app

client = TestClient(app)


# ------------------------------------------------------------ headers ----
def test_security_headers_on_api_responses():
    res = client.get("/health")
    assert res.status_code == 200
    h = res.headers
    assert h["x-content-type-options"] == "nosniff"
    assert h["x-frame-options"] == "DENY"
    assert h["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "frame-ancestors 'none'" in h["content-security-policy"]
    assert "permissions-policy" in h


def test_api_json_is_never_cached_and_never_runs_scripts():
    res = client.post("/api/v1/auth/login", json={"email": "x", "password": ""})
    assert res.headers["cache-control"] == "no-store"
    assert res.headers["content-security-policy"].startswith("default-src 'none'")


def test_docs_page_gets_a_csp_that_allows_swagger():
    res = client.get("/api/docs")
    assert res.status_code == 200
    assert "cdn.jsdelivr.net" in res.headers["content-security-policy"]


def test_headers_present_on_error_responses_too():
    res = client.get("/api/v1/auth/me")  # 401
    assert res.status_code == 401
    assert res.headers["x-frame-options"] == "DENY"


# ------------------------------------------------- environment validation ----
def _settings(**overrides) -> Settings:
    base = dict(
        DATABASE_URL="postgresql://u:p@localhost/db",
        DIRECT_URL="postgresql://u:p@localhost/db",
        SHADOW_DATABASE_URL="postgresql://u:p@localhost/shadow",
        JWT_ACCESS_SECRET="a" * 64,
        JWT_REFRESH_SECRET="b" * 64,
    )
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[call-arg]


def test_validate_environment_is_clean_for_a_good_dev_config():
    assert validate_environment(_settings()) == []


def test_validate_environment_flags_placeholder_and_reused_secrets():
    problems = validate_environment(_settings(JWT_REFRESH_SECRET="a" * 64))
    assert any("must be different" in p for p in problems)

    placeholder = "replace_with_a_random_64_char_hex_secret_______________________"
    problems = validate_environment(_settings(JWT_ACCESS_SECRET=placeholder))
    assert any("placeholder" in p for p in problems)


def test_validate_environment_is_strict_in_production():
    problems = validate_environment(
        _settings(NODE_ENV="production", CORS_ORIGINS="*", SUPER_ADMIN_PASSWORD="ChangeMe123!", ENABLE_HSTS=False)
    )
    joined = "\n".join(problems)
    assert "CORS_ORIGINS" in joined
    assert "SUPER_ADMIN_PASSWORD" in joined
    assert "ENABLE_HSTS" in joined

    ok = validate_environment(
        _settings(NODE_ENV="production", CORS_ORIGINS="https://app.innowi.com", ENABLE_HSTS=True)
    )
    assert ok == []


def test_validate_environment_rejects_a_bad_fernet_key():
    problems = validate_environment(_settings(CREDENTIAL_ENCRYPTION_KEY="not-a-key"))
    assert any("Fernet" in p for p in problems)
    assert validate_environment(_settings(CREDENTIAL_ENCRYPTION_KEY=Fernet.generate_key().decode())) == []


# ------------------------------------------------------------- crypto ----
def test_credential_roundtrip_and_masking(monkeypatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setattr(crypto, "get_settings", lambda: _settings(CREDENTIAL_ENCRYPTION_KEY=key))
    crypto._fernet.cache_clear()

    token = crypto.encrypt_secret("wp_app_password xyz 1234")
    assert token != "wp_app_password xyz 1234"
    assert crypto.decrypt_secret(token) == "wp_app_password xyz 1234"

    # A different key must not decrypt it.
    monkeypatch.setattr(crypto, "get_settings", lambda: _settings(CREDENTIAL_ENCRYPTION_KEY=Fernet.generate_key().decode()))
    crypto._fernet.cache_clear()
    with pytest.raises(crypto.CredentialDecryptError):
        crypto.decrypt_secret(token)

    assert crypto.mask_secret("sk-abcdefghijklmnop") == "sk-ab…nop"
    assert crypto.mask_secret("short") == "set"
    assert crypto.mask_secret(None) == ""


def test_crypto_refuses_to_run_without_a_key(monkeypatch):
    monkeypatch.setattr(crypto, "get_settings", lambda: _settings(CREDENTIAL_ENCRYPTION_KEY=None))
    crypto._fernet.cache_clear()
    with pytest.raises(crypto.CredentialKeyMissing):
        crypto.encrypt_secret("x")
    crypto._fernet.cache_clear()


# ----------------------------------------------------------- throttle ----
def test_failure_throttle_blocks_after_limit_and_resets():
    t = FailureThrottle(limit=3, window_seconds=60)
    assert not t.is_blocked("k")
    for _ in range(3):
        t.record_failure("k")
    assert t.is_blocked("k")
    assert t.retry_after("k") >= 1
    assert not t.is_blocked("other")
    t.reset("k")
    assert not t.is_blocked("k")


def test_failure_throttle_window_slides(monkeypatch):
    import app.common.security.throttle as mod

    clock = [1000.0]
    monkeypatch.setattr(mod.time, "monotonic", lambda: clock[0])
    t = FailureThrottle(limit=2, window_seconds=10)
    t.record_failure("k")
    t.record_failure("k")
    assert t.is_blocked("k")
    clock[0] += 11
    assert not t.is_blocked("k")
