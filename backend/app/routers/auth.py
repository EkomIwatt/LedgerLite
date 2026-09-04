"""Contract 1 -- authentication.

The refresh token lives in an httpOnly cookie scoped to ``/api/auth`` and
nowhere else: never in a response body, never reachable from JavaScript.  Every
call to ``/api/auth/refresh`` rotates it, and presenting a cookie that has
already been rotated is treated as a replay -- the whole token family is
revoked, not just that one row.
"""
import uuid

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.config import settings
from app.database import get_db
from app.deps import bearer_token, get_current_user
from app.errors import ApiError
from app.models import User, utcnow
from app.schemas import Credentials, SessionOut, TokenOut, UserOut
from app.security import (
    TOKEN_TYPE_ACCESS,
    TOKEN_TYPE_REFRESH,
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    refresh_token_expiry,
    verify_password,
    verify_password_dummy,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

EMAIL_TAKEN = "An account with that email already exists."
BAD_CREDENTIALS = "Incorrect email or password."
SESSION_EXPIRED = "Session expired. Please sign in again."


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        max_age=settings.refresh_token_ttl_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path=settings.cookie_path,
        domain=settings.cookie_domain,
    )


def _clear_refresh_cookie(response: Response) -> None:
    # Attributes must match the ones the cookie was set with or the browser
    # keeps the original.
    response.set_cookie(
        key=settings.cookie_name,
        value="",
        max_age=0,
        expires=0,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path=settings.cookie_path,
        domain=settings.cookie_domain,
    )


async def _issue_session(db: AsyncSession, user: User, response: Response) -> str:
    """Mint an access token and a fresh refresh cookie. Returns the access token."""
    jti = uuid.uuid4().hex
    refresh = create_refresh_token(user.id, user.token_version, jti)
    await crud.record_refresh_token(db, user.id, jti, refresh_token_expiry())
    _set_refresh_cookie(response, refresh)
    return create_access_token(user.id, user.token_version)


@router.post("/signup", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def signup(
    payload: Credentials, response: Response, db: AsyncSession = Depends(get_db)
) -> SessionOut:
    existing = await crud.get_user_by_email(db, payload.email)
    if existing is not None:
        raise ApiError(status.HTTP_409_CONFLICT, EMAIL_TAKEN)

    try:
        user = await crud.create_user(db, payload.email, hash_password(payload.password))
    except IntegrityError:
        # Lost a race against a concurrent signup; the lower(email) unique
        # index caught it.
        await db.rollback()
        raise ApiError(status.HTTP_409_CONFLICT, EMAIL_TAKEN)

    access = await _issue_session(db, user, response)
    return SessionOut(
        access_token=access,
        token_type="bearer",
        expires_in=settings.access_token_ttl_seconds,
        user=UserOut.model_validate(user),
    )


@router.post("/login", response_model=SessionOut)
async def login(
    payload: Credentials, response: Response, db: AsyncSession = Depends(get_db)
) -> SessionOut:
    user = await crud.get_user_by_email(db, payload.email)

    if user is None:
        # Burn an equivalent argon2 verification so an unknown email costs the
        # same as a wrong password.  No enumeration by message, status, or timing.
        verify_password_dummy(payload.password)
        raise ApiError(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)

    if not verify_password(payload.password, user.password_hash):
        raise ApiError(status.HTTP_401_UNAUTHORIZED, BAD_CREDENTIALS)

    await crud.purge_expired_refresh_tokens(db, user.id)
    access = await _issue_session(db, user, response)
    return SessionOut(
        access_token=access,
        token_type="bearer",
        expires_in=settings.access_token_ttl_seconds,
        user=UserOut.model_validate(user),
    )


@router.post("/refresh", response_model=TokenOut)
async def refresh(
    request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    """Cookie only -- no request body, no Authorization header.

    Missing, malformed, expired and already-rotated cookies are all the same
    401 with the same sentence.
    """
    expired = ApiError(status.HTTP_401_UNAUTHORIZED, SESSION_EXPIRED)

    raw = request.cookies.get(settings.cookie_name)
    if not raw:
        raise expired

    try:
        payload = decode_token(raw, TOKEN_TYPE_REFRESH)
    except TokenError:
        raise expired

    user = await crud.get_user_by_id(db, payload["user_id"])
    if user is None or payload.get("tv") != user.token_version:
        raise expired

    row = await crud.get_refresh_token(db, payload["jti"])
    if row is None or row.user_id != user.id:
        raise expired

    if row.revoked_at is not None:
        # This cookie was already rotated away. Either it leaked or something
        # replayed it; assume the worst and retire the entire family.
        await crud.revoke_all_refresh_tokens(db, user.id)
        await crud.bump_token_version(db, user)
        raise expired

    if row.expires_at <= utcnow():
        raise expired

    await crud.revoke_refresh_token(db, row)
    access = await _issue_session(db, user, response)
    return TokenOut(
        access_token=access,
        token_type="bearer",
        expires_in=settings.access_token_ttl_seconds,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    """Idempotent: 204 whether or not anyone was signed in."""
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    user = None

    raw = request.cookies.get(settings.cookie_name)
    if raw:
        try:
            payload = decode_token(raw, TOKEN_TYPE_REFRESH)
            user = await crud.get_user_by_id(db, payload["user_id"])
        except TokenError:
            user = None

    if user is None:
        # Fall back to the access token so a client whose cookie has already
        # gone can still explicitly end its session.
        token = bearer_token(request)
        if token:
            try:
                access_payload = decode_token(token, TOKEN_TYPE_ACCESS)
                user = await crud.get_user_by_id(db, access_payload["user_id"])
            except TokenError:
                user = None

    if user is not None:
        await crud.revoke_all_refresh_tokens(db, user.id)
        await crud.bump_token_version(db, user)

    _clear_refresh_cookie(response)
    return response


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
