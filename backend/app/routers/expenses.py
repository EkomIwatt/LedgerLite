"""Contract 3 -- expense CRUD, entirely scoped to the authenticated user.

No route here reads a user id from a body, a query string or a path segment.
Ownership comes from the access token and nowhere else, and every fetch goes
through ``crud.get_owned_expense`` so a row belonging to another user is a 404,
never a 403.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.categories import is_valid_category
from app.database import get_db
from app.deps import get_current_user, optional_month
from app.errors import ApiError
from app.models import User
from app.schemas import ExpenseCreate, ExpenseListOut, ExpenseOut, ExpenseUpdate

router = APIRouter(prefix="/api/expenses", tags=["expenses"])

NOT_FOUND = "Expense not found."


def _validate_category_filter(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    if not is_valid_category(value):
        raise ApiError(400, "Unknown category '%s'." % (value,))
    return value


@router.get("", response_model=ExpenseListOut)
async def list_expenses(
    month: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ExpenseListOut:
    month = optional_month(month)
    category = _validate_category_filter(category)

    rows, total = await crud.list_expenses(
        db, user.id, month=month, category=category, limit=limit, offset=offset
    )
    # An empty result is an empty list, never a 404.
    return ExpenseListOut(
        expenses=[ExpenseOut.model_validate(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_expense(
    payload: ExpenseCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    expense = await crud.create_expense(
        db,
        user_id=user.id,
        amount_minor=payload.amount_minor,
        category=payload.category,
        date=payload.date,
        note=payload.note,
    )
    return ExpenseOut.model_validate(expense)


@router.patch("/{expense_id}", response_model=ExpenseOut)
async def update_expense(
    expense_id: int,
    payload: ExpenseUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ExpenseOut:
    expense = await crud.get_owned_expense(db, user.id, expense_id)
    if expense is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, NOT_FOUND)

    expense = await crud.update_expense(db, expense, payload.changes())
    return ExpenseOut.model_validate(expense)


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense(
    expense_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    expense = await crud.get_owned_expense(db, user.id, expense_id)
    if expense is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, NOT_FOUND)

    await crud.delete_expense(db, expense)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
