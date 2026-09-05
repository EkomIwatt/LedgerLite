"""Async engine / session wiring, plus hosted-Postgres URL normalization.

Snipp's lesson, carried over verbatim: a hosted Postgres URL (Neon, Render,
Supabase) arrives in libpq form --
``postgresql://...?sslmode=require&channel_binding=require`` -- and asyncpg
rejects both of those query arguments outright.  ``normalize_database_url``
forces the ``+asyncpg`` driver, lifts SSL out of the query string into connect
args, and drops the libpq-only parameters.  SQLite and plain local URLs pass
through untouched.
"""
from typing import Any, AsyncIterator, Dict, Tuple
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.config import settings

# Query args libpq understands but asyncpg does not.  Passing them through
# raises ``TypeError: connect() got an unexpected keyword argument 'sslmode'``.
_LIBPQ_ONLY_ARGS = ("sslmode", "channel_binding", "target_session_attrs", "gssencmode")

_LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1", "0.0.0.0", "db", "postgres")


def normalize_database_url(raw_url: str) -> Tuple[str, Dict[str, Any]]:
    """Return ``(url, connect_args)`` safe to hand to ``create_async_engine``."""
    url = (raw_url or "").strip()

    # --- SQLite -----------------------------------------------------------
    if url.startswith("sqlite"):
        if "+aiosqlite" not in url:
            url = url.replace("sqlite://", "sqlite+aiosqlite://", 1)
        return url, {"check_same_thread": False}

    # --- Postgres ---------------------------------------------------------
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]

    parts = urlsplit(url)
    query_pairs = parse_qsl(parts.query, keep_blank_values=True)

    sslmode = None
    kept = []
    for key, value in query_pairs:
        lowered = key.lower()
        if lowered == "sslmode":
            sslmode = value.lower()
            continue
        if lowered in _LIBPQ_ONLY_ARGS:
            continue
        kept.append((key, value))

    url = urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment)
    )

    connect_args: Dict[str, Any] = {}
    host = (parts.hostname or "").lower()
    is_local = host in _LOCAL_HOSTS or host == ""

    if sslmode is not None:
        if sslmode not in ("disable", "allow"):
            connect_args["ssl"] = True
    elif not is_local:
        # Hosted Postgres without an explicit sslmode still requires TLS.
        connect_args["ssl"] = True

    return url, connect_args


def build_engine(raw_url: str, echo: bool = False) -> AsyncEngine:
    url, connect_args = normalize_database_url(raw_url)
    kwargs: Dict[str, Any] = {"echo": echo, "future": True, "connect_args": connect_args}

    if url.startswith("sqlite"):
        # An in-memory SQLite database only exists for the life of one
        # connection, so the whole app (and the whole test session) has to
        # share exactly one.
        if ":memory:" in url or "mode=memory" in url:
            kwargs["poolclass"] = StaticPool
    else:
        kwargs.update(pool_pre_ping=True, pool_size=5, max_overflow=10, pool_recycle=1800)

    return create_async_engine(url, **kwargs)


engine: AsyncEngine = build_engine(settings.database_url, echo=settings.sql_echo)

SessionLocal: async_sessionmaker = async_sessionmaker(
    bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


def dialect_name(session: AsyncSession) -> str:
    """Best-effort dialect name for the session's bind.

    Used only to pick a portable month-bucketing SQL expression; every caller
    has a working fallback, so an empty string is an acceptable answer.
    """
    bind = getattr(session, "bind", None)
    if bind is None:
        try:
            bind = session.get_bind()
        except Exception:  # pragma: no cover - defensive
            return ""
    dialect = getattr(bind, "dialect", None)
    if dialect is not None:
        return dialect.name
    sync_engine = getattr(bind, "sync_engine", None)
    if sync_engine is not None:  # pragma: no cover - defensive
        return sync_engine.dialect.name
    return ""
