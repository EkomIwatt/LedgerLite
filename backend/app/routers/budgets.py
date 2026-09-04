"""Contract 4 -- per (user, category, month) spending limits.

Budgets do not carry forward between months; each month is set explicitly.
``PUT`` is a real upsert, backed by the UNIQUE (user_id, category, month)
constraint rather than by a check-then-write race.
"""
from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.categories import is_valid_category
from app.database import get_db
from app.deps import get_current_user, require_month
from app.errors import ApiError
from app.models import User
from app.months import is_valid_month
from app.schemas import BudgetItemOut, BudgetListOut, BudgetOut, BudgetUpsert

router = APIRouter(prefix="/api/budgets", tags=["budgets"])

NO_BUDGET = "No budget set for that category and month."


@router.get("", response_model=BudgetListOut)
async def list_budgets(
    month: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BudgetListOut:
    month = require_month(month)
    rows = await crud.list_budgets_for_month(db, user.id, month)
    return BudgetListOut(
        month=month,
        budgets=[
            BudgetItemOut(category=row.category, limit_minor=row.limit_minor)
            for row in rows
        ],
    )


@router.put("", response_model=BudgetOut)
async def upsert_budget(
    payload: BudgetUpsert,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> BudgetOut:
    budget = await crud.upsert_budget(
        db,
        user_id=user.id,
        month=payload.month,
        category=payload.category,
        limit_minor=payload.limit_minor,
    )
    return BudgetOut(
        month=budget.month, category=budget.category, limit_minor=budget.limit_minor
    )


@router.delete("/{month}/{category}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(
    month: str,
    category: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    # A malformed month or an unknown category cannot name an existing budget,
    # so both collapse into the same 404 the contract already defines rather
    # than inventing a status code it does not list.
    if not is_valid_month(month) or not is_valid_category(category):
        raise ApiError(status.HTTP_404_NOT_FOUND, NO_BUDGET)

    budget = await crud.get_budget(db, user.id, month, category)
    if budget is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, NO_BUDGET)

    await crud.delete_budget(db, budget)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
