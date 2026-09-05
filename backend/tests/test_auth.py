"""Contract 1 -- authentication, tokens and the refresh cookie."""
from typing import Optional

import pytest

from app.config import settings
from app.security import (
    TOKEN_TYPE_ACCESS,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from tests.conftest import DEFAULT_PASSWORD, signup

COOKIE = "refresh_token"


def set_cookie_headers(response):
    return [h for h in response.headers.get_list("set-cookie") if h.startswith(COOKIE + "=")]


def refresh_cookie_value(response) -> Optional[str]:
    for raw in set_cookie_headers(response):
        return raw.split("=", 1)[1].split(";", 1)[0]
    return None


# --------------------------------------------------------------------------
# signup
# --------------------------------------------------------------------------
async def test_signup_returns_contract_shape_and_sets_cookie(client):
    response = await client.post(
        "/api/auth/signup", json={"email": "new@example.com", "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 201

    body = response.json()
    assert set(body) == {"access_token", "token_type", "expires_in", "user"}
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 900
    assert set(body["user"]) == {"id", "email", "created_at"}
    assert body["user"]["email"] == "new@example.com"
    assert body["user"]["created_at"].endswith("Z")
    assert "password" not in response.text and "hash" not in response.text

    raw = set_cookie_headers(response)[0]
    assert "HttpOnly" in raw
    assert "Path=/api/auth" in raw
    assert "Max-Age=2592000" in raw
    # The refresh token lives only in the cookie -- never in the body.
    assert refresh_cookie_value(response) not in response.text


async def test_signup_rejects_duplicate_email_case_insensitively(client):
    await client.post(
        "/api/auth/signup", json={"email": "dup@example.com", "password": DEFAULT_PASSWORD}
    )
    response = await client.post(
        "/api/auth/signup", json={"email": "DUP@Example.COM", "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 409
    assert response.json() == {"error": "An account with that email already exists."}


async def test_signup_rejects_short_password(client):
    response = await client.post(
        "/api/auth/signup", json={"email": "short@example.com", "password": "abc"}
    )
    assert response.status_code == 422
    assert response.json() == {"error": "Password must be at least 8 characters."}


async def test_signup_normalizes_email_to_lowercase(client):
    response = await client.post(
        "/api/auth/signup", json={"email": "MiXeD@Example.com", "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 201
    assert response.json()["user"]["email"] == "mixed@example.com"


# --------------------------------------------------------------------------
# login / no user enumeration
# --------------------------------------------------------------------------
async def test_login_succeeds_and_issues_a_new_cookie(user_a):
    response = await user_a.client.post(
        "/api/auth/login", json={"email": user_a.email, "password": user_a.password}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["expires_in"] == 900
    assert body["user"]["id"] == user_a.id
    assert set_cookie_headers(response)


async def test_login_is_case_insensitive_on_email(user_a):
    response = await user_a.client.post(
        "/api/auth/login",
        json={"email": user_a.email.upper(), "password": user_a.password},
    )
    assert response.status_code == 200


async def test_unknown_email_and_wrong_password_are_byte_identical(user_a, client):
    unknown = await client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": DEFAULT_PASSWORD},
    )
    wrong = await client.post(
        "/api/auth/login", json={"email": user_a.email, "password": "wrong-password-x"}
    )

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.content == wrong.content
    assert unknown.json() == {"error": "Incorrect email or password."}
    # Nothing leaks through headers either.
    assert not set_cookie_headers(unknown)
    assert not set_cookie_headers(wrong)


async def test_unknown_email_still_performs_a_password_verification(client, monkeypatch):
    """The anti-timing measure, asserted on mechanism rather than on a clock.

    A wall-clock comparison would be flaky in CI; what actually matters is that
    the unknown-email branch burns an equivalent argon2 verification.
    """
    calls = []
    import app.routers.auth as auth_module

    real = auth_module.verify_password_dummy

    def spy(password):
        calls.append(password)
        return real(password)

    monkeypatch.setattr(auth_module, "verify_password_dummy", spy)

    response = await client.post(
        "/api/auth/login", json={"email": "ghost@example.com", "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 401
    assert calls == [DEFAULT_PASSWORD]


# --------------------------------------------------------------------------
# protected endpoints / token discipline
# --------------------------------------------------------------------------
async def test_me_returns_the_authenticated_user(user_a):
    response = await user_a.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json() == user_a.user


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer not-a-jwt"},
        {"Authorization": "Basic abc"},
        {"Authorization": "Bearer "},
    ],
)
async def test_me_rejects_missing_or_malformed_credentials(client, headers):
    response = await client.get("/api/auth/me", headers=headers)
    assert response.status_code == 401
    assert response.json() == {"error": "Not authenticated."}
    assert response.headers.get("WWW-Authenticate") == "Bearer"


async def test_refresh_token_is_rejected_as_a_bearer_credential(user_a):
    """Token confusion: the typ claim is the only thing standing in the way."""
    stolen = create_refresh_token(user_a.id, 0, "some-jti")
    response = await user_a.client.get(
        "/api/auth/me", headers={"Authorization": "Bearer %s" % stolen}
    )
    assert response.status_code == 401
    assert response.json() == {"error": "Not authenticated."}


async def test_access_token_is_rejected_as_a_refresh_cookie(user_a, make_client):
    fresh = await make_client()
    fresh.cookies.set(COOKIE, user_a.access_token)
    response = await fresh.post("/api/auth/refresh")
    assert response.status_code == 401
    assert response.json() == {"error": "Session expired. Please sign in again."}


async def test_expired_access_token_is_rejected_then_refresh_issues_a_working_one(user_a):
    expired = create_access_token(user_a.id, 0, ttl_seconds=-10)
    denied = await user_a.client.get(
        "/api/auth/me", headers={"Authorization": "Bearer %s" % expired}
    )
    assert denied.status_code == 401
    assert denied.json() == {"error": "Not authenticated."}

    refreshed = await user_a.client.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    new_token = refreshed.json()["access_token"]

    allowed = await user_a.client.get(
        "/api/auth/me", headers={"Authorization": "Bearer %s" % new_token}
    )
    assert allowed.status_code == 200


async def test_token_claims_match_the_contract(user_a):
    payload = decode_token(user_a.access_token, TOKEN_TYPE_ACCESS)
    assert payload["sub"] == str(user_a.id)
    assert payload["typ"] == "access"
    assert payload["exp"] - payload["iat"] == 900
    assert payload["jti"]


# --------------------------------------------------------------------------
# refresh + rotation
# --------------------------------------------------------------------------
async def test_refresh_needs_no_body_or_authorization_header(user_a):
    response = await user_a.client.post("/api/auth/refresh")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"access_token", "token_type", "expires_in"}
    assert body["expires_in"] == 900


async def test_refresh_rotates_the_cookie(user_a):
    before = user_a.client.cookies.get(COOKIE)
    response = await user_a.client.post("/api/auth/refresh")
    after = refresh_cookie_value(response)
    assert after is not None
    assert after != before


async def test_a_rotated_cookie_is_forgiven_inside_the_grace_window(user_a, make_client):
    """The two-tab race (Contract 1, ratified amendment).

    Two tabs share a cookie jar but not a single-flight promise, so the loser
    posts the cookie the winner has just rotated. Immediately afterwards that
    is a benign race: it gets a working access token, and nobody is signed out.
    """
    original = user_a.client.cookies.get(COOKIE)
    assert (await user_a.client.post("/api/auth/refresh")).status_code == 200

    replay = await make_client()
    replay.cookies.set(COOKIE, original)
    response = await replay.post("/api/auth/refresh")

    assert response.status_code == 200
    assert set(response.json()) == {"access_token", "token_type", "expires_in"}
    # No second rotation: the jar already holds the winner's cookie.
    assert refresh_cookie_value(response) is None
    # The access token it hands back actually works...
    token = response.json()["access_token"]
    me = await replay.get("/api/auth/me", headers={"Authorization": "Bearer %s" % token})
    assert me.status_code == 200
    # ...and the winning tab is untouched.
    assert (await user_a.client.post("/api/auth/refresh")).status_code == 200


async def test_a_rotated_cookie_outside_the_grace_window_is_theft(
    user_a, make_client, monkeypatch
):
    """Past the window the replay has no benign explanation: retire the family."""
    monkeypatch.setattr(settings, "refresh_replay_grace_seconds", 0)

    original = user_a.client.cookies.get(COOKIE)
    assert (await user_a.client.post("/api/auth/refresh")).status_code == 200

    replay = await make_client()
    replay.cookies.set(COOKIE, original)
    response = await replay.post("/api/auth/refresh")
    assert response.status_code == 401
    assert response.json() == {"error": "Session expired. Please sign in again."}

    # The current, legitimately-rotated cookie is now dead too.
    assert (await user_a.client.post("/api/auth/refresh")).status_code == 401


async def test_replay_is_theft_once_the_family_is_dead(user_a, make_client):
    """Inside the window, but with no live token left, still theft.

    Logging out revokes the family; a replayed cookie arriving afterwards is
    not a racing tab, so the grace window must not resurrect it.
    """
    original = user_a.client.cookies.get(COOKIE)
    assert (await user_a.client.post("/api/auth/refresh")).status_code == 200
    assert (await user_a.client.post("/api/auth/logout")).status_code == 204

    replay = await make_client()
    replay.cookies.set(COOKIE, original)
    assert (await replay.post("/api/auth/refresh")).status_code == 401


@pytest.mark.parametrize("cookie_value", ["", "garbage", "a.b.c"])
async def test_missing_or_malformed_cookie_is_the_same_401(make_client, cookie_value):
    fresh = await make_client()
    if cookie_value:
        fresh.cookies.set(COOKIE, cookie_value)
    response = await fresh.post("/api/auth/refresh")
    assert response.status_code == 401
    assert response.json() == {"error": "Session expired. Please sign in again."}


async def test_expired_refresh_cookie_is_rejected(user_a, make_client):
    expired = create_refresh_token(user_a.id, 0, "expired-jti", ttl_seconds=-10)
    fresh = await make_client()
    fresh.cookies.set(COOKIE, expired)
    response = await fresh.post("/api/auth/refresh")
    assert response.status_code == 401


# --------------------------------------------------------------------------
# logout
# --------------------------------------------------------------------------
async def test_logout_clears_the_cookie_and_kills_the_session(user_a):
    response = await user_a.client.post("/api/auth/logout")
    assert response.status_code == 204
    assert response.content == b""

    cleared = set_cookie_headers(response)[0]
    assert "Max-Age=0" in cleared
    assert "Path=/api/auth" in cleared

    # Refresh is dead...
    assert (await user_a.client.post("/api/auth/refresh")).status_code == 401
    # ...and so is the access token that was already in hand.
    assert (await user_a.get("/api/auth/me")).status_code == 401


async def test_logout_is_idempotent_when_not_signed_in(client):
    first = await client.post("/api/auth/logout")
    second = await client.post("/api/auth/logout")
    assert first.status_code == second.status_code == 204


async def test_logout_does_not_affect_another_user(user_a, user_b):
    assert (await user_a.client.post("/api/auth/logout")).status_code == 204
    assert (await user_b.get("/api/auth/me")).status_code == 200


async def test_signing_in_again_after_logout_works(user_a, make_client):
    await user_a.client.post("/api/auth/logout")
    fresh = await make_client()
    response = await fresh.post(
        "/api/auth/login", json={"email": user_a.email, "password": user_a.password}
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    assert (
        await fresh.get("/api/auth/me", headers={"Authorization": "Bearer %s" % token})
    ).status_code == 200


# --------------------------------------------------------------------------
# cookie configuration
# --------------------------------------------------------------------------
async def test_cookie_flags_follow_the_environment(user_a):
    """Local dev: SameSite=Lax, not Secure (same-origin via the Vite proxy)."""
    response = await user_a.client.post("/api/auth/refresh")
    raw = set_cookie_headers(response)[0]
    assert settings.cookie_secure is False
    assert "Secure" not in raw
    assert "samesite=lax" in raw.lower()
