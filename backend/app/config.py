"""Application settings.

Everything that differs between local development and production comes from the
environment.  The two that matter most are ``SECRET_KEY`` (which the app refuses
to boot without in production) and the pair ``COOKIE_SECURE`` / ``COOKIE_SAMESITE``
that Contract 1 makes environment-driven.
"""
from functools import lru_cache
from typing import List, Optional

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The value shipped in .env.example.  Booting production with this (or an empty
# string, or anything short) is a hard failure.
DEV_PLACEHOLDER_SECRET = "dev-only-insecure-secret-change-me"

_VALID_SAMESITE = ("lax", "strict", "none")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    environment: str = "development"

    # --- database ---
    database_url: str = "sqlite+aiosqlite:///./ledgerlite.db"
    sql_echo: bool = False

    # --- auth ---
    secret_key: str = DEV_PLACEHOLDER_SECRET
    jwt_algorithm: str = "HS256"
    access_token_ttl_seconds: int = 900        # 15 minutes  (Contract 1)
    refresh_token_ttl_seconds: int = 2592000   # 30 days     (Contract 1)
    # How long a just-rotated refresh token still answers instead of being
    # treated as theft (Contract 1, ratified amendment). Two tabs of one
    # browser share a cookie jar but not a single-flight promise, so the second
    # can arrive carrying the cookie the first has just rotated away. That is a
    # benign race, not a stolen token. Set to 0 to disable the window entirely.
    refresh_replay_grace_seconds: int = 10

    # --- refresh cookie (Contract 1) ---
    cookie_name: str = "refresh_token"
    cookie_path: str = "/api/auth"
    cookie_secure: bool = False                # prod: true
    cookie_samesite: str = "lax"               # prod: none
    cookie_domain: Optional[str] = None

    # --- CORS (Contract 6) ---
    # Exact origin(s), no wildcard.  Comma-separated is accepted so a Vercel
    # preview origin can be added without a code change, but every entry is
    # still an exact string.
    frontend_origin: str = "http://localhost:5173"

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() in ("production", "prod")

    @property
    def allowed_origins(self) -> List[str]:
        return [o.strip().rstrip("/") for o in self.frontend_origin.split(",") if o.strip()]

    @field_validator("cookie_samesite")
    @classmethod
    def _normalize_samesite(cls, v: str) -> str:
        value = (v or "").strip().lower()
        if value not in _VALID_SAMESITE:
            raise ValueError(
                "COOKIE_SAMESITE must be one of: lax, strict, none (got %r)." % v
            )
        return value

    @field_validator("frontend_origin")
    @classmethod
    def _no_wildcard_origin(cls, v: str) -> str:
        if "*" in v:
            raise ValueError(
                "FRONTEND_ORIGIN must be an exact origin; a wildcard is invalid "
                "alongside allow_credentials=True."
            )
        return v.strip()

    @model_validator(mode="after")
    def _production_hardening(self) -> "Settings":
        if self.is_production:
            secret = (self.secret_key or "").strip()
            if not secret or secret == DEV_PLACEHOLDER_SECRET or len(secret) < 32:
                raise ValueError(
                    "SECRET_KEY must be set to a strong, non-default value (>= 32 chars) "
                    "in production. Generate one with: python -c "
                    '"import secrets; print(secrets.token_urlsafe(48))"'
                )
            if self.cookie_samesite == "none" and not self.cookie_secure:
                raise ValueError(
                    "COOKIE_SAMESITE=None requires COOKIE_SECURE=true; browsers drop "
                    "SameSite=None cookies that are not Secure."
                )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
