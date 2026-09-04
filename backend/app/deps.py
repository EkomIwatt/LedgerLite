"""Shared dependencies: the authenticated user, and query-param validation.

``get_current_user`` is the single gate in front of Contracts 3, 4 and 5.  It
returns a ``User`` or raises 401 -- there is no "maybe authenticated" state for
a protected route to mishandle.
"""
from typing import Optional

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.errors import ApiError
from app.models import User
from app.database import get_db
from app.months import is_valid_month
from app.security import TOKEN_TYPE_ACCESS, TokenError, decode_token

NOT_AUTHENTICATED = "Not authenticated."
BAD_MONTH = "Invalid month format. Expected YYYY-MM."

# Contract 1 requires the WWW-Authenticate header alongside every protected-route 401.
_AUTH_HEADERS = {"WWW-Authenticate": "Bearer"}


def unauthenticated() -> ApiError:
    return ApiError(401, NOT_AUTHENTICATED, headers=dict(_AUTH_HEADERS))


def bearer_token(request: Request) -> Optional[str]:
    header = request.headers.get("Authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = token.strip()
    return token or None


async def get_current_user(
    request: Request, db: AsyncSession = Depends(get_db)
) -> User:
    token = bearer_token(request)
    if token is None:
        raise unauthenticated()

    try:
        # Refusing to decode without an expected type is what stops a refresh
        # token from being replayed as a Bearer credential.
        payload = decode_token(token, TOKEN_TYPE_ACCESS)
    except TokenError:
        raise unauthenticated()

    user = await crud.get_user_by_id(db, payload["user_id"])
    if user is None:
        raise unauthenticated()

    # A logout bumps token_version, which retires every token already issued.
    if payload.get("tv") != user.token_version:
        raise unauthenticated()

    return user


CurrentUser = Depends(get_current_user)


def require_month(value: str) -> str:
    """Validate a REQUIRED ``month=YYYY-MM`` query parameter."""
    if not is_valid_month(value):
        raise ApiError(400, BAD_MONTH)
    return value


def optional_month(value: Optional[str]) -> Optional[str]:
    """Validate an OPTIONAL ``month=YYYY-MM`` query parameter.

    An absent parameter is fine; a present-but-malformed one is a 400.  An
    empty string is treated as absent so ``?month=`` does not 400 a page load.
    """
    if value is None or value == "":
        return None
    if not is_valid_month(value):
        raise ApiError(400, BAD_MONTH)
    return value
