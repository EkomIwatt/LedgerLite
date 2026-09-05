"""Data access.

**Every** function that touches ``expenses`` or ``budgets`` takes a ``user_id``
and puts it in the WHERE clause.  There is no unscoped variant to reach for by
accident, and no route ever builds its own query.

``get_owned_expense`` is the ownership-checked fetch Contract 1 asks for: a row
that exists but belongs to somebody else comes back as ``None``, the same as a
row that never existed, so the caller has one code path and cannot leak
existence through a 403.
"""
from datetime import date as date_cls
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.categories import order_index
from app.models import Budget, Expense, RefreshToken, User, utcnow
from app.months import month_bounds


# --------------------------------------------------------------------------
# users
# --------------------------------------------------------------------------
def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    stmt = select(User).where(func.lower(User.email) == normalize_email(email))
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: int) -> Optional[User]:
    return await db.get(User, user_id)


async def create_user(db: AsyncSession, email: str, password_hash: str) -> User:
    user = User(email=normalize_email(email), password_hash=password_hash, token_version=0)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def bump_token_version(db: AsyncSession, user: User) -> None:
    """Invalidate every outstanding access and refresh token for this user."""
    user.token_version = (user.token_version or 0) + 1
    await db.commit()
    await db.refresh(user)


# --------------------------------------------------------------------------
# refresh tokens
# --------------------------------------------------------------------------
async def record_refresh_token(
    db: AsyncSession, user_id: int, jti: str, expires_at
) -> RefreshToken:
    row = RefreshToken(user_id=user_id, jti=jti, expires_at=expires_at)
    db.add(row)
    await db.commit()
    return row


async def get_refresh_token(db: AsyncSession, jti: str) -> Optional[RefreshToken]:
    stmt = select(RefreshToken).where(RefreshToken.jti == jti)
    return (await db.execute(stmt)).scalar_one_or_none()


async def has_live_refresh_token(db: AsyncSession, user_id: int) -> bool:
    """Is any refresh token for this user still usable?

    Guards the replay grace window: a replayed cookie is only forgiven while
    its successor is still alive. If the whole family is already revoked or
    expired there is no benign race to explain the replay, so it is treated as
    theft after all.
    """
    stmt = (
        select(RefreshToken.id)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > utcnow(),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def revoke_refresh_token(db: AsyncSession, row: RefreshToken) -> None:
    row.revoked_at = utcnow()
    await db.commit()


async def revoke_all_refresh_tokens(db: AsyncSession, user_id: int) -> None:
    stmt = (
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    await db.execute(stmt)
    await db.commit()


async def purge_expired_refresh_tokens(db: AsyncSession, user_id: int) -> None:
    """Opportunistic housekeeping so the table does not grow without bound."""
    stmt = delete(RefreshToken).where(
        RefreshToken.user_id == user_id, RefreshToken.expires_at < utcnow()
    )
    await db.execute(stmt)
    await db.commit()


# --------------------------------------------------------------------------
# expenses
# --------------------------------------------------------------------------
def _expense_scope(user_id: int):
    return Expense.user_id == user_id


async def list_expenses(
    db: AsyncSession,
    user_id: int,
    month: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Tuple[List[Expense], int]:
    filters = [_expense_scope(user_id)]
    if month:
        start, end = month_bounds(month)
        filters.append(Expense.date >= start)
        filters.append(Expense.date < end)
    if category:
        filters.append(Expense.category == category)

    total = (
        await db.execute(select(func.count()).select_from(Expense).where(*filters))
    ).scalar_one()

    stmt = (
        select(Expense)
        .where(*filters)
        # Contract 3: date DESC, then id DESC. Stable and mandatory.
        .order_by(Expense.date.desc(), Expense.id.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = list((await db.execute(stmt)).scalars().all())
    return rows, int(total)


async def get_owned_expense(
    db: AsyncSession, user_id: int, expense_id: int
) -> Optional[Expense]:
    """The ownership-checked fetch. Another user's row is indistinguishable
    from a nonexistent one -- that is what makes cross-user access a 404."""
    stmt = select(Expense).where(Expense.id == expense_id, _expense_scope(user_id))
    return (await db.execute(stmt)).scalar_one_or_none()


async def create_expense(
    db: AsyncSession,
    user_id: int,
    amount_minor: int,
    category: str,
    date: date_cls,
    note: Optional[str],
) -> Expense:
    expense = Expense(
        user_id=user_id,
        amount_minor=amount_minor,
        category=category,
        date=date,
        note=note,
    )
    db.add(expense)
    await db.commit()
    await db.refresh(expense)
    return expense


async def update_expense(
    db: AsyncSession, expense: Expense, changes: Dict[str, Any]
) -> Expense:
    for field in ("amount_minor", "category", "date", "note"):
        if field in changes:
            setattr(expense, field, changes[field])
    # Contract 3 promises a refreshed updated_at on every successful PATCH,
    # including a no-op one.
    expense.updated_at = utcnow()
    await db.commit()
    await db.refresh(expense)
    return expense


async def delete_expense(db: AsyncSession, expense: Expense) -> None:
    await db.delete(expense)
    await db.commit()


# --------------------------------------------------------------------------
# budgets
# --------------------------------------------------------------------------
async def list_budgets_for_month(
    db: AsyncSession, user_id: int, month: str
) -> List[Budget]:
    stmt = select(Budget).where(Budget.user_id == user_id, Budget.month == month)
    rows = list((await db.execute(stmt)).scalars().all())
    # Contract 4: ordered by the frozen category order, not alphabetically, so
    # the settings UI does not reshuffle between renders.
    rows.sort(key=lambda b: order_index(b.category))
    return rows


async def get_budget(
    db: AsyncSession, user_id: int, month: str, category: str
) -> Optional[Budget]:
    stmt = select(Budget).where(
        Budget.user_id == user_id, Budget.month == month, Budget.category == category
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def upsert_budget(
    db: AsyncSession, user_id: int, month: str, category: str, limit_minor: int
) -> Budget:
    existing = await get_budget(db, user_id, month, category)
    if existing is not None:
        existing.limit_minor = limit_minor
        existing.updated_at = utcnow()
        await db.commit()
        await db.refresh(existing)
        return existing

    budget = Budget(
        user_id=user_id, month=month, category=category, limit_minor=limit_minor
    )
    db.add(budget)
    try:
        await db.commit()
    except IntegrityError:
        # Lost a race against a concurrent insert; the unique constraint on
        # (user_id, category, month) held, so fall back to an update.
        await db.rollback()
        existing = await get_budget(db, user_id, month, category)
        if existing is None:  # pragma: no cover - defensive
            raise
        existing.limit_minor = limit_minor
        existing.updated_at = utcnow()
        await db.commit()
        await db.refresh(existing)
        return existing

    await db.refresh(budget)
    return budget


async def delete_budget(db: AsyncSession, budget: Budget) -> None:
    await db.delete(budget)
    await db.commit()


async def budget_totals_for_months(
    db: AsyncSession, user_id: int, months: Sequence[str]
) -> Dict[str, int]:
    """``{month: sum(limit_minor)}`` for the given months. Summed in SQL."""
    if not months:
        return {}
    stmt = (
        select(Budget.month, func.coalesce(func.sum(Budget.limit_minor), 0))
        .where(Budget.user_id == user_id, Budget.month.in_(list(months)))
        .group_by(Budget.month)
    )
    return {row[0]: int(row[1]) for row in (await db.execute(stmt)).all()}
