"""LedgerLite API application factory.

CORS is the one piece of configuration that will silently break the refresh
cookie if it is wrong: ``allow_credentials=True`` is incompatible with a
wildcard origin, so ``FRONTEND_ORIGIN`` must be the exact deployed origin.
(Snipp's was ``snipp-kappa.vercel.app``, not the bare project name -- confirm
the real one at deploy time.)
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import engine
from app.errors import install_exception_handlers
from app.models import Base
from app.routers import analytics, auth, budgets, categories, expenses

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ledgerlite")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # No migration tool in this stack; create_all is idempotent and is what
    # lets a fresh Neon database come up without a manual step.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info(
        "LedgerLite API ready (env=%s, origins=%s, cookie secure=%s samesite=%s)",
        settings.environment,
        settings.allowed_origins,
        settings.cookie_secure,
        settings.cookie_samesite,
    )
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="LedgerLite API",
        version="1.0.0",
        description="Private personal expense tracker. Every row is scoped to one user.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,  # exact origins, never "*"
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # Must come before the routers so FastAPI's default {"detail": ...} and
    # nested-validation bodies never escape (Contract 6).
    install_exception_handlers(app)

    app.include_router(auth.router)
    app.include_router(categories.router)
    app.include_router(expenses.router)
    app.include_router(budgets.router)
    app.include_router(analytics.router)

    @app.get("/api/health", tags=["ops"], include_in_schema=False)
    async def health():
        """Not part of any contract -- a platform health check target."""
        return {"status": "ok"}

    return app


app = create_app()
