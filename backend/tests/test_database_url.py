"""Hosted-Postgres URL normalization.

This is a pure unit test on purpose: every one of these cases cost Snipp a
redeploy to discover, and none of them is reachable from the SQLite test
database.
"""
import pytest

from app.database import normalize_database_url


@pytest.mark.parametrize(
    "raw",
    [
        "postgres://u:p@ep-x.neon.tech/db",
        "postgresql://u:p@ep-x.neon.tech/db",
        "postgresql+asyncpg://u:p@ep-x.neon.tech/db",
    ],
)
def test_every_postgres_spelling_becomes_asyncpg(raw):
    url, _ = normalize_database_url(raw)
    assert url.startswith("postgresql+asyncpg://")


def test_libpq_only_query_args_are_stripped():
    """asyncpg raises TypeError on sslmode and channel_binding."""
    url, connect_args = normalize_database_url(
        "postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require"
    )
    assert "sslmode" not in url
    assert "channel_binding" not in url
    assert connect_args["ssl"] is True


def test_unknown_query_args_are_preserved():
    url, _ = normalize_database_url(
        "postgresql://u:p@ep-x.neon.tech/db?application_name=ledgerlite&sslmode=require"
    )
    assert "application_name=ledgerlite" in url


def test_hosted_host_gets_ssl_even_without_sslmode():
    _, connect_args = normalize_database_url("postgresql://u:p@ep-x.neon.tech/db")
    assert connect_args["ssl"] is True


def test_local_postgres_does_not_force_ssl():
    for host in ("localhost", "127.0.0.1", "db"):
        _, connect_args = normalize_database_url("postgresql://u:p@%s:5432/ledgerlite" % host)
        assert "ssl" not in connect_args


def test_sslmode_disable_is_honoured():
    _, connect_args = normalize_database_url(
        "postgresql://u:p@ep-x.neon.tech/db?sslmode=disable"
    )
    assert "ssl" not in connect_args


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("sqlite:///./ledgerlite.db", "sqlite+aiosqlite:///./ledgerlite.db"),
        ("sqlite+aiosqlite:///:memory:", "sqlite+aiosqlite:///:memory:"),
    ],
)
def test_sqlite_urls_pass_through_with_the_async_driver(raw, expected):
    url, connect_args = normalize_database_url(raw)
    assert url == expected
    assert connect_args == {"check_same_thread": False}


def test_surrounding_whitespace_is_tolerated():
    url, _ = normalize_database_url("  postgres://u:p@ep-x.neon.tech/db  ")
    assert url.startswith("postgresql+asyncpg://")
