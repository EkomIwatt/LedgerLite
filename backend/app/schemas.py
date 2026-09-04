"""Pydantic v2 request/response models -- the wire shapes of Contracts 1-5.

Validator messages are written as finished sentences on purpose: ``errors.py``
lifts them straight into ``{"error": "..."}``, so the string here is the string
the frontend renders.

Two deliberate choices:

* ``typing.Optional`` over ``X | None``.  The container pins Python 3.12.8 but
  the local interpreter running this suite is 3.9, and pydantic evaluates
  annotations at import time.
* ``Annotated[Optional[T], BeforeValidator(...)]`` rather than
  ``Optional[Annotated[T, ...]]`` on the PATCH model.  With the latter, an
  explicit ``null`` would match the ``NoneType`` arm of the union and skip the
  validator entirely -- which is exactly the case that has to be rejected.
"""
from datetime import date as date_cls
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, BeforeValidator, ConfigDict, field_serializer
from typing_extensions import Annotated

from app.categories import is_valid_category
from app.months import is_valid_month

AMOUNT_MIN = 1
AMOUNT_MAX = 1_000_000_000_000
NOTE_MAX = 500
PASSWORD_MIN = 8
PASSWORD_MAX = 128


# --------------------------------------------------------------------------
# field cleaners -- each raises a finished sentence
# --------------------------------------------------------------------------
def _clean_email(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("Email must be a valid email address.")
    try:
        result = validate_email(value.strip(), check_deliverability=False)
    except EmailNotValidError:
        raise ValueError("Email must be a valid email address.")
    # Stored and compared lower-cased; the DB index is on lower(email).
    return result.normalized.lower()


def _clean_password(value: Any) -> str:
    if not isinstance(value, str) or len(value) < PASSWORD_MIN:
        raise ValueError("Password must be at least 8 characters.")
    if len(value) > PASSWORD_MAX:
        raise ValueError("Password must be at most 128 characters.")
    return value


def _clean_amount(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("amount_minor must be an integer number of minor units.")
    if value < AMOUNT_MIN:
        raise ValueError("amount_minor must be greater than 0.")
    if value > AMOUNT_MAX:
        raise ValueError("amount_minor must not exceed %d." % AMOUNT_MAX)
    return value


def _clean_category(value: Any) -> str:
    if not isinstance(value, str) or not is_valid_category(value):
        raise ValueError("Unknown category '%s'." % (value,))
    return value


def _clean_note(value: Any) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("note must be a string.")
    stripped = value.strip()
    if len(stripped) > NOTE_MAX:
        raise ValueError("note must be at most %d characters." % NOTE_MAX)
    # Contract 3: an empty string is stored as null.
    return stripped or None


def _clean_month(value: Any) -> str:
    if not isinstance(value, str) or not is_valid_month(value):
        raise ValueError("month must be in YYYY-MM format.")
    return value


def _clean_limit_minor(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("limit_minor must be an integer number of minor units.")
    if value < 1:
        raise ValueError("limit_minor must be greater than 0.")
    if value > AMOUNT_MAX:
        raise ValueError("limit_minor must not exceed %d." % AMOUNT_MAX)
    return value


def _reject_null_date(value: Any) -> Any:
    if value is None:
        raise ValueError("date must be a valid date in YYYY-MM-DD format.")
    return value


EmailField = Annotated[str, BeforeValidator(_clean_email)]
PasswordField = Annotated[str, BeforeValidator(_clean_password)]
AmountField = Annotated[int, BeforeValidator(_clean_amount)]
CategoryField = Annotated[str, BeforeValidator(_clean_category)]
NoteField = Annotated[Optional[str], BeforeValidator(_clean_note)]
MonthField = Annotated[str, BeforeValidator(_clean_month)]
LimitField = Annotated[int, BeforeValidator(_clean_limit_minor)]

# PATCH variants: present-but-null must fail, absent must be silent.
OptionalAmountField = Annotated[Optional[int], BeforeValidator(_clean_amount)]
OptionalCategoryField = Annotated[Optional[str], BeforeValidator(_clean_category)]
OptionalDateField = Annotated[Optional[date_cls], BeforeValidator(_reject_null_date)]


def iso_z(value: datetime) -> str:
    """ISO-8601 UTC with a trailing Z and no sub-second noise."""
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------
# Contract 1 -- authentication
# --------------------------------------------------------------------------
class Credentials(BaseModel):
    model_config = ConfigDict(extra="ignore")

    email: EmailField
    password: PasswordField


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    created_at: datetime

    @field_serializer("created_at")
    def _ser_created_at(self, value: datetime, _info) -> str:
        return iso_z(value)


class TokenOut(BaseModel):
    """POST /api/auth/refresh"""

    access_token: str
    token_type: str = "bearer"
    expires_in: int


class SessionOut(TokenOut):
    """POST /api/auth/signup and POST /api/auth/login"""

    user: UserOut


# --------------------------------------------------------------------------
# Contract 2 -- categories
# --------------------------------------------------------------------------
class CategoryOut(BaseModel):
    key: str
    label: str
    color: str


class CategoryListOut(BaseModel):
    categories: List[CategoryOut]


# --------------------------------------------------------------------------
# Contract 3 -- expenses
# --------------------------------------------------------------------------
class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    amount_minor: int
    category: str
    date: date_cls
    note: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    @field_serializer("created_at", "updated_at")
    def _ser_timestamps(self, value: datetime, _info) -> str:
        return iso_z(value)


class ExpenseListOut(BaseModel):
    expenses: List[ExpenseOut]
    total: int
    limit: int
    offset: int


class ExpenseCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    amount_minor: AmountField
    category: CategoryField
    date: date_cls
    note: NoteField = None


class ExpenseUpdate(BaseModel):
    """PATCH -- any subset of the four mutable fields."""

    model_config = ConfigDict(extra="ignore")

    amount_minor: OptionalAmountField = None
    category: OptionalCategoryField = None
    date: OptionalDateField = None
    note: NoteField = None

    def changes(self) -> Dict[str, Any]:
        return self.model_dump(exclude_unset=True)


# --------------------------------------------------------------------------
# Contract 4 -- budgets
# --------------------------------------------------------------------------
class BudgetItemOut(BaseModel):
    category: str
    limit_minor: int


class BudgetListOut(BaseModel):
    month: str
    budgets: List[BudgetItemOut]


class BudgetUpsert(BaseModel):
    model_config = ConfigDict(extra="ignore")

    month: MonthField
    category: CategoryField
    limit_minor: LimitField


class BudgetOut(BaseModel):
    month: str
    category: str
    limit_minor: int


# --------------------------------------------------------------------------
# Contract 5 -- analytics
# --------------------------------------------------------------------------
class SummaryOut(BaseModel):
    month: str
    currency: str
    total_spent_minor: int
    total_budget_minor: int
    remaining_minor: int
    percent_used: float
    expense_count: int


class CategoryBreakdownOut(BaseModel):
    category: str
    label: str
    color: str
    spent_minor: int
    percent: float
    limit_minor: Optional[int] = None
    remaining_minor: Optional[int] = None
    percent_used: Optional[float] = None
    over_budget: bool


class ByCategoryOut(BaseModel):
    month: str
    currency: str
    total_spent_minor: int
    categories: List[CategoryBreakdownOut]


class MonthlyPointOut(BaseModel):
    month: str
    total_spent_minor: int
    total_budget_minor: int


class MonthlyOut(BaseModel):
    currency: str
    months: List[MonthlyPointOut]
