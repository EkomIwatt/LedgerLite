"""Password hashing and JWT minting/verification.

Two rules carry the weight here:

1. **Constant-ish login timing.**  ``verify_password_dummy`` exists so that a
   login with an unknown email performs the same argon2 work as a login with a
   known one.  Without it, response time alone enumerates accounts.
2. **``typ`` discipline.**  Access and refresh tokens are the same algorithm
   with the same key, so the only thing stopping a refresh token from being
   replayed as a Bearer credential is that the ``typ`` claim is checked on
   every single path.  ``decode_token`` will not decode without being told
   which type it expects.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt
from passlib.context import CryptContext

from app.config import settings

TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"

pwd_context = CryptContext(
    schemes=["argon2"],
    deprecated="auto",
    argon2__time_cost=2,
    argon2__memory_cost=65536,  # 64 MiB
    argon2__parallelism=2,
)

# A real argon2 hash of a value nobody can supply.  Verifying against it burns
# the same CPU as a genuine check, which is the whole point.
_DUMMY_HASH = pwd_context.hash("ledgerlite-dummy-password-for-constant-time-login")


class TokenError(Exception):
    """Any reason a token is unacceptable. Deliberately carries no detail."""


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        # A malformed stored hash must not be distinguishable from a wrong
        # password, and must never surface as a 500.
        return False


def verify_password_dummy(password: str) -> bool:
    """Burn one argon2 verification and return False.

    Called when the email is unknown, so that path costs the same as the
    wrong-password path.
    """
    try:
        pwd_context.verify(password, _DUMMY_HASH)
    except Exception:
        pass
    return False


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _encode(
    subject: int, token_type: str, ttl_seconds: int, token_version: int, jti: str
) -> str:
    issued_at = _now()
    payload = {
        "sub": str(subject),
        "typ": token_type,
        "iat": issued_at,
        "exp": issued_at + timedelta(seconds=ttl_seconds),
        "jti": jti,
        "tv": token_version,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(
    user_id: int, token_version: int, ttl_seconds: Optional[int] = None
) -> str:
    ttl = settings.access_token_ttl_seconds if ttl_seconds is None else ttl_seconds
    return _encode(user_id, TOKEN_TYPE_ACCESS, ttl, token_version, uuid.uuid4().hex)


def create_refresh_token(
    user_id: int, token_version: int, jti: str, ttl_seconds: Optional[int] = None
) -> str:
    ttl = settings.refresh_token_ttl_seconds if ttl_seconds is None else ttl_seconds
    return _encode(user_id, TOKEN_TYPE_REFRESH, ttl, token_version, jti)


def refresh_token_expiry(ttl_seconds: Optional[int] = None) -> datetime:
    """Naive-UTC expiry matching what ``create_refresh_token`` will stamp."""
    ttl = settings.refresh_token_ttl_seconds if ttl_seconds is None else ttl_seconds
    return (_now() + timedelta(seconds=ttl)).replace(tzinfo=None)


def decode_token(token: str, expected_type: str) -> Dict[str, Any]:
    """Decode and fully validate a token, or raise ``TokenError``.

    ``expected_type`` is mandatory -- there is no way to decode a token without
    committing to what it is supposed to be.
    """
    if not token:
        raise TokenError("missing token")
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "iat", "sub", "jti"]},
        )
    except jwt.PyJWTError as exc:
        raise TokenError("invalid token") from exc

    if payload.get("typ") != expected_type:
        # A refresh token presented as a Bearer credential lands here.
        raise TokenError("wrong token type")

    subject = payload.get("sub")
    try:
        payload["user_id"] = int(subject)
    except (TypeError, ValueError) as exc:
        raise TokenError("invalid subject") from exc

    if not isinstance(payload.get("tv"), int):
        raise TokenError("missing token version")

    return payload
