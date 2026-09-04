"""Contract 5 -- chart-ready aggregates, computed in SQL.

The frontend does no summing, no bucketing, no zero-filling and no percentage
math.  Everything below is ``GROUP BY`` + ``SUM`` in the database; the only
Python is merging two aggregate result sets and laying them into the fixed
month window Contract 5c promises.

Every query carries ``user_id`` in its WHERE clause.
"""
from typing import Any, Dict, List, Sequence, Tuple

from sqlalchemy import String, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.categories import color_for, label_for, order_index
from app.crud import budget_totals_for_months
from app.database import dialect_name
from app.models import Budget, Expense
from app.months import month_bounds, month_series, one_decimal

CURRENCY = "NGN"


def month_bucket_expr(dialect: str):
    """A SQL expression yielding ``'YYYY-MM'`` from ``expenses.date``.

    Postgres and SQLite spell this differently and neither understands the
    other's function.  The ``substr(cast(...))`` fallback works anywhere a DATE
    casts to an ISO string.

    Takes the dialect name rather than a session so the Postgres branch -- which
    the SQLite test database can never execute -- is still directly testable.
    """
    if dialect == "postgresql":
        return func.to_char(Expense.date, "YYYY-MM")
    if dialect == "sqlite":
        return func.strftime("%Y-%m", Expense.date)
    return func.substr(cast(Expense.date, String), 1, 7)


def _month_bucket(db: AsyncSession):
    return month_bucket_expr(dialect_name(db))


# --------------------------------------------------------------------------
# 5a -- headline numbers
# --------------------------------------------------------------------------
async def summary(db: AsyncSession, user_id: int, month: str) -> Dict[str, Any]:
    start, end = month_bounds(month)

    spend_stmt = select(
        func.coalesce(func.sum(Expense.amount_minor), 0),
        func.count(Expense.id),
    ).where(Expense.user_id == user_id, Expense.date >= start, Expense.date < end)
    total_spent, expense_count = (await db.execute(spend_stmt)).one()

    budget_stmt = select(func.coalesce(func.sum(Budget.limit_minor), 0)).where(
        Budget.user_id == user_id, Budget.month == month
    )
    total_budget = (await db.execute(budget_stmt)).scalar_one()

    total_spent = int(total_spent or 0)
    total_budget = int(total_budget or 0)

    return {
        "month": month,
        "currency": CURRENCY,
        "total_spent_minor": total_spent,
        "total_budget_minor": total_budget,
        # May be negative -- an over-budget month is a real state, not an error.
        "remaining_minor": total_budget - total_spent,
        "percent_used": one_decimal(total_spent, total_budget),
        "expense_count": int(expense_count or 0),
    }


# --------------------------------------------------------------------------
# 5b -- category breakdown
# --------------------------------------------------------------------------
async def by_category(db: AsyncSession, user_id: int, month: str) -> Dict[str, Any]:
    start, end = month_bounds(month)

    spend_stmt = (
        select(Expense.category, func.coalesce(func.sum(Expense.amount_minor), 0))
        .where(Expense.user_id == user_id, Expense.date >= start, Expense.date < end)
        .group_by(Expense.category)
    )
    spent_by_category: Dict[str, int] = {
        row[0]: int(row[1]) for row in (await db.execute(spend_stmt)).all()
    }

    budget_stmt = select(Budget.category, Budget.limit_minor).where(
        Budget.user_id == user_id, Budget.month == month
    )
    limit_by_category: Dict[str, int] = {
        row[0]: int(row[1]) for row in (await db.execute(budget_stmt)).all()
    }

    total_spent = sum(spent_by_category.values())

    # Inclusion rule: spend > 0 (the pie needs it) OR a budget is set (the
    # gauge must show an untouched budget).  Neither -> omitted entirely.
    keys = set(spent_by_category) | set(limit_by_category)

    rows: List[Dict[str, Any]] = []
    for key in keys:
        spent = spent_by_category.get(key, 0)
        limit = limit_by_category.get(key)
        rows.append(
            {
                "category": key,
                "label": label_for(key),
                "color": color_for(key),
                "spent_minor": spent,
                "percent": one_decimal(spent, total_spent),
                "limit_minor": limit,
                "remaining_minor": None if limit is None else limit - spent,
                "percent_used": None if limit is None else one_decimal(spent, limit),
                "over_budget": limit is not None and spent > limit,
            }
        )

    # spent_minor DESC, then the frozen category order as the tie-break.
    rows.sort(key=lambda r: (-r["spent_minor"], order_index(r["category"])))

    return {
        "month": month,
        "currency": CURRENCY,
        "total_spent_minor": total_spent,
        "categories": rows,
    }


# --------------------------------------------------------------------------
# 5c -- month over month
# --------------------------------------------------------------------------
async def monthly(db: AsyncSession, user_id: int, months: int) -> Dict[str, Any]:
    window: Sequence[str] = month_series(months)
    window_start, _ = month_bounds(window[0])
    _, window_end = month_bounds(window[-1])

    bucket = _month_bucket(db)
    spend_stmt = (
        select(bucket.label("m"), func.coalesce(func.sum(Expense.amount_minor), 0))
        .where(
            Expense.user_id == user_id,
            Expense.date >= window_start,
            Expense.date < window_end,
        )
        .group_by(bucket)
    )
    spent_by_month: Dict[str, int] = {
        str(row[0]): int(row[1]) for row in (await db.execute(spend_stmt)).all()
    }
    budget_by_month = await budget_totals_for_months(db, user_id, window)

    # Zero-filled and contiguous: `months=6` returns exactly 6 elements even
    # for a brand-new account, so the bar chart never handles a gap.
    points = [
        {
            "month": key,
            "total_spent_minor": spent_by_month.get(key, 0),
            "total_budget_minor": budget_by_month.get(key, 0),
        }
        for key in window
    ]

    return {"currency": CURRENCY, "months": points}
