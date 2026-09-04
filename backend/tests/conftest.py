"""Test harness: the real ASGI app over in-memory SQLite.

Nothing is mocked below the HTTP boundary -- these tests drive the actual
routers, the actual dependency graph and the actual SQL.  Each test gets a
fresh database and a fresh event loop.

``ApiUser`` bundles a signed-up account with its own httpx client (and
therefore its own cookie jar), which is what makes the two-user isolation
tests honest: user B genuinely cannot see user A's cookie or token.
"""
import os

# Must be set before app.config is imported, since Settings is built at import.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-anywhere-real-0123456789")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("COOKIE_SAMESITE", "lax")
os.environ.setdefault("FRONTEND_ORIGIN", "http://localhost:5173")

from typing import Any, Dict, List, Optional  # noqa: E402

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import build_engine, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402

BASE_URL = "http://testserver"
DEFAULT_PASSWORD = "correct-horse-battery"


@pytest.fixture
async def engine():
    eng = build_engine("sqlite+aiosqlite:///:memory:")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
async def make_client(engine):
    """Factory for independent clients sharing one database.

    Independent cookie jars matter: a shared client would let one account's
    refresh cookie leak into another's requests and quietly hide a bug.
    """
    session_factory = async_sessionmaker(
        bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )

    async def _get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _get_db
    opened: List[AsyncClient] = []

    async def _make() -> AsyncClient:
        client = AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL)
        opened.append(client)
        return client

    yield _make

    for client in opened:
        await client.aclose()
    app.dependency_overrides.clear()


@pytest.fixture
async def client(make_client) -> AsyncClient:
    return await make_client()


class ApiUser:
    """A signed-up account plus the client that owns its session."""

    def __init__(self, client: AsyncClient, payload: Dict[str, Any], password: str):
        self.client = client
        self.password = password
        self.access_token = payload["access_token"]
        self.user = payload["user"]
        self.id = payload["user"]["id"]
        self.email = payload["user"]["email"]

    @property
    def headers(self) -> Dict[str, str]:
        return {"Authorization": "Bearer %s" % self.access_token}

    async def get(self, url: str, **kw):
        return await self.client.get(url, headers=self.headers, **kw)

    async def post(self, url: str, **kw):
        return await self.client.post(url, headers=self.headers, **kw)

    async def patch(self, url: str, **kw):
        return await self.client.patch(url, headers=self.headers, **kw)

    async def put(self, url: str, **kw):
        return await self.client.put(url, headers=self.headers, **kw)

    async def delete(self, url: str, **kw):
        return await self.client.delete(url, headers=self.headers, **kw)

    # --- convenience builders -------------------------------------------
    async def add_expense(
        self,
        amount_minor: int,
        category: str = "food",
        date: str = "2026-09-04",
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        response = await self.post(
            "/api/expenses",
            json={
                "amount_minor": amount_minor,
                "category": category,
                "date": date,
                "note": note,
            },
        )
        assert response.status_code == 201, response.text
        return response.json()

    async def set_budget(self, month: str, category: str, limit_minor: int) -> Dict[str, Any]:
        response = await self.put(
            "/api/budgets",
            json={"month": month, "category": category, "limit_minor": limit_minor},
        )
        assert response.status_code == 200, response.text
        return response.json()


async def signup(
    client: AsyncClient, email: str, password: str = DEFAULT_PASSWORD
) -> ApiUser:
    response = await client.post(
        "/api/auth/signup", json={"email": email, "password": password}
    )
    assert response.status_code == 201, response.text
    return ApiUser(client, response.json(), password)


@pytest.fixture
async def user_a(make_client) -> ApiUser:
    return await signup(await make_client(), "alice@example.com")


@pytest.fixture
async def user_b(make_client) -> ApiUser:
    return await signup(await make_client(), "bob@example.com")


@pytest.fixture
def access_ttl() -> int:
    return settings.access_token_ttl_seconds
