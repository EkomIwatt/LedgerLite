"""Contract 6 -- one error envelope, correct status codes, and CORS.

FastAPI's defaults are wrong for this contract in two specific ways, so both
are asserted directly: ``HTTPException`` would emit ``{"detail": ...}``, and a
validation failure would emit a nested list.  Every test below therefore checks
for the *absence* of ``detail`` as well as the presence of ``error``.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app

ORIGIN = "http://localhost:5173"


def assert_envelope(response):
    body = response.json()
    assert set(body) == {"error"}, body
    assert isinstance(body["error"], str)
    assert body["error"].endswith((".", "!", "?")), body["error"]
    assert body["error"] == body["error"].strip()
    assert len(body["error"]) > 1
    assert "detail" not in body


async def test_validation_failure_uses_the_envelope(user_a):
    response = await user_a.post(
        "/api/expenses", json={"amount_minor": 0, "category": "food", "date": "2026-09-04"}
    )
    assert response.status_code == 422
    assert_envelope(response)


async def test_not_found_uses_the_envelope(user_a):
    response = await user_a.delete("/api/expenses/424242")
    assert response.status_code == 404
    assert_envelope(response)


async def test_unauthenticated_uses_the_envelope(client):
    response = await client.get("/api/auth/me")
    assert response.status_code == 401
    assert_envelope(response)


async def test_conflict_uses_the_envelope(user_a, client):
    response = await client.post(
        "/api/auth/signup", json={"email": user_a.email, "password": "another-password"}
    )
    assert response.status_code == 409
    assert_envelope(response)


async def test_unknown_path_uses_the_envelope(client):
    response = await client.get("/api/nope")
    assert response.status_code == 404
    assert_envelope(response)


async def test_method_not_allowed_uses_the_envelope(client):
    response = await client.put("/api/categories")
    assert response.status_code == 405
    assert_envelope(response)


async def test_missing_body_uses_the_envelope(client):
    response = await client.post("/api/auth/login", json={})
    assert response.status_code == 422
    assert_envelope(response)
    assert response.json() == {"error": "email is required."}


async def test_malformed_json_uses_the_envelope(client):
    response = await client.post(
        "/api/auth/login",
        content=b"{not json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert_envelope(response)


async def test_unexpected_error_is_a_generic_500_with_no_leakage(engine, monkeypatch):
    """A crash must not surface a stack trace, a SQL string or an exception message."""
    import app.routers.categories as categories_router

    def explode():
        raise RuntimeError("SELECT secret FROM users -- internal detail")

    monkeypatch.setattr(categories_router, "as_list", explode)

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as c:
        response = await c.get("/api/categories")

    assert response.status_code == 500
    assert response.json() == {"error": "Something went wrong."}
    assert "SELECT" not in response.text
    assert "RuntimeError" not in response.text
    assert "Traceback" not in response.text


# --------------------------------------------------------------------------
# status-code discipline
# --------------------------------------------------------------------------
async def test_status_codes_match_the_contract(user_a, client):
    # 201 created
    created = await user_a.post(
        "/api/expenses", json={"amount_minor": 10, "category": "food", "date": "2026-09-04"}
    )
    assert created.status_code == 201

    # 200 PUT-upsert
    assert (
        await user_a.put(
            "/api/budgets",
            json={"month": "2026-09", "category": "food", "limit_minor": 10},
        )
    ).status_code == 200

    # 204 delete + logout
    assert (
        await user_a.delete("/api/expenses/%d" % created.json()["id"])
    ).status_code == 204
    assert (await client.post("/api/auth/logout")).status_code == 204


# --------------------------------------------------------------------------
# CORS
# --------------------------------------------------------------------------
async def test_cors_echoes_the_exact_origin_with_credentials(client):
    response = await client.get("/api/categories", headers={"Origin": ORIGIN})
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"
    # A wildcard here would silently break the refresh cookie.
    assert response.headers["access-control-allow-origin"] != "*"


async def test_cors_preflight_allows_the_contract_methods_and_headers(client):
    response = await client.options(
        "/api/expenses",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    allowed = response.headers["access-control-allow-methods"]
    for method in ("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"):
        assert method in allowed
    assert response.headers["access-control-allow-credentials"] == "true"


async def test_cors_does_not_echo_an_unknown_origin(client):
    response = await client.get(
        "/api/categories", headers={"Origin": "https://evil.example.com"}
    )
    assert response.headers.get("access-control-allow-origin") != "https://evil.example.com"


def test_settings_reject_a_wildcard_origin():
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError):
        Settings(frontend_origin="*")


def test_production_refuses_to_boot_with_the_placeholder_secret():
    from pydantic import ValidationError

    from app.config import DEV_PLACEHOLDER_SECRET, Settings

    with pytest.raises(ValidationError):
        Settings(environment="production", secret_key=DEV_PLACEHOLDER_SECRET)
    with pytest.raises(ValidationError):
        Settings(environment="production", secret_key="")
    with pytest.raises(ValidationError):
        Settings(environment="production", secret_key="too-short")


def test_production_refuses_samesite_none_without_secure():
    from pydantic import ValidationError

    from app.config import Settings

    strong = "x" * 48
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            secret_key=strong,
            cookie_samesite="none",
            cookie_secure=False,
        )
    ok = Settings(
        environment="production",
        secret_key=strong,
        cookie_samesite="None",
        cookie_secure=True,
    )
    assert ok.cookie_samesite == "none"


def test_dev_defaults_are_the_local_proxy_configuration():
    assert settings.cookie_secure is False
    assert settings.cookie_samesite == "lax"
    assert settings.cookie_path == "/api/auth"
