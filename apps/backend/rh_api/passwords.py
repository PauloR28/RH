from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 260_000


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def hash_password(password: str) -> str:
    safe_password = str(password or "")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        safe_password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    return f"{PASSWORD_SCHEME}${PASSWORD_ITERATIONS}${_b64encode(salt)}${_b64encode(digest)}"


def verify_password(password: str, stored_hash: str | None) -> bool:
    safe_hash = str(stored_hash or "").strip()
    parts = safe_hash.split("$")
    if len(parts) != 4:
        return False

    scheme, raw_iterations, raw_salt, raw_digest = parts
    if scheme != PASSWORD_SCHEME:
        return False

    try:
        iterations = int(raw_iterations)
        salt = _b64decode(raw_salt)
        expected_digest = _b64decode(raw_digest)
    except Exception:
        return False

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        str(password or "").encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(digest, expected_digest)
