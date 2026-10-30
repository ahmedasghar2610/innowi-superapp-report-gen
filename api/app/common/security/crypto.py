"""
Encryption-at-rest for third-party credentials.

Ported from Final-MVP's `sitemanager/crypto.py`: any secret the platform has
to hold on a merchant's behalf (an API key for a connected service, a
WordPress application password, an OAuth refresh token) is encrypted with
Fernet (AES-128-CBC + HMAC-SHA256) before it is written to the database, and
decrypted only at the point of use. The key never leaves the server.

Required env var (only when something actually stores a credential):
    CREDENTIAL_ENCRYPTION_KEY — a Fernet key. Generate once with:
        python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    Losing it means re-entering every stored credential; leaking it means
    rotating all of them.

Usage:
    from app.common.security.crypto import encrypt_secret, decrypt_secret, mask_secret
    row.secret_encrypted = encrypt_secret(dto.apiKey)
    ...
    client = Service(api_key=decrypt_secret(row.secret_encrypted))
    response.apiKey = mask_secret(dto.apiKey)   # never echo the plaintext back
"""
from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


class CredentialKeyMissing(RuntimeError):
    """CREDENTIAL_ENCRYPTION_KEY is not configured."""


class CredentialDecryptError(RuntimeError):
    """Ciphertext was produced with a different key or has been tampered with."""


@lru_cache
def _fernet() -> Fernet:
    key = get_settings().CREDENTIAL_ENCRYPTION_KEY
    if not key:
        raise CredentialKeyMissing(
            "CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with "
            "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"`"
        )
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except (ValueError, TypeError) as exc:
        raise CredentialKeyMissing("CREDENTIAL_ENCRYPTION_KEY is not a valid Fernet key") from exc


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise CredentialDecryptError("Stored credential could not be decrypted with the current key") from exc


def mask_secret(value: str | None) -> str:
    """`sk-ab…xyz` style preview for API responses — same shape Final-MVP's
    SEO settings endpoint returned, so a UI can show *that* a key is set
    without ever receiving it."""
    if not value:
        return ""
    if len(value) <= 10:
        return "set"
    return f"{value[:5]}…{value[-3:]}"
