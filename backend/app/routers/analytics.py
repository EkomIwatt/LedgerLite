"""Contract 5 -- the three chart endpoints.

Thin by design: each route validates its query parameter, calls into
``app.analytics`` (where the SQL lives) and returns the result.  A brand-new
account gets a 200 with zeroed totals from all three -- never a 404, never a
null at the top level.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app import analytics
from app.database import get_db
from app.deps import get_current_user, require_month
from app.models import User
from app.schemas import ByCategoryOut, MonthlyOut, SummaryOut

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary", response_model=SummaryOut)
async def get_summary(
    month: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SummaryOut:
    month = require_month(month)
    return SummaryOut(**await analytics.summary(db, user.id, month))


@router.get("/by-category", response_model=ByCategoryOut)
async def get_by_category(
    month: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ByCategoryOut:
    month = require_month(month)
    return ByCategoryOut(**await analytics.by_category(db, user.id, month))


@router.get("/monthly", response_model=MonthlyOut)
async def get_monthly(
    months: int = Query(default=6, ge=1, le=24),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MonthlyOut:
    return MonthlyOut(**await analytics.monthly(db, user.id, months))
