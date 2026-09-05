"""Month arithmetic.

A month is the string ``"YYYY-MM"`` on the wire and, in SQL, the half-open
calendar range ``[first_of_month, first_of_next_month)``.  Filtering by range
rather than by a formatted string keeps the ``(user_id, date DESC)`` index
usable and keeps the query dialect-independent.
"""
import re
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import List, Optional, Tuple

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def is_valid_month(value: str) -> bool:
    return bool(value) and bool(MONTH_RE.match(value))


def parse_month(value: str) -> Optional[Tuple[int, int]]:
    if not is_valid_month(value):
        return None
    year, month = value.split("-")
    return int(year), int(month)


def month_bounds(value: str) -> Tuple[date, date]:
    """``"2026-09"`` -> ``(date(2026, 9, 1), date(2026, 10, 1))``.

    Caller must have validated the string first.
    """
    parsed = parse_month(value)
    if parsed is None:
        raise ValueError("invalid month: %r" % (value,))
    year, month = parsed
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def month_key(d: date) -> str:
    return "%04d-%02d" % (d.year, d.month)


def current_month(today: Optional[date] = None) -> str:
    """The current calendar month in server UTC (Contract 5c)."""
    if today is None:
        today = datetime.now(timezone.utc).date()
    return month_key(today)


def shift_month(value: str, delta: int) -> str:
    year, month = parse_month(value)
    index = year * 12 + (month - 1) + delta
    return "%04d-%02d" % (index // 12, index % 12 + 1)


def month_series(count: int, end_month: Optional[str] = None) -> List[str]:
    """``count`` contiguous months, oldest first, ending at ``end_month``.

    This is the skeleton Contract 5c zero-fills against: the caller sums what
    the database actually returned into this fixed-length list, so a month with
    no expenses appears as 0 rather than being skipped.
    """
    if end_month is None:
        end_month = current_month()
    return [shift_month(end_month, -(count - 1 - i)) for i in range(count)]


def one_decimal(numerator: int, denominator: int) -> float:
    """A percentage rounded to one decimal place, half-up.

    Half-up rather than Python's default banker's rounding so the number the
    UI shows is the number a person would compute by hand.  Returns 0.0 when
    the denominator is 0 -- Contract 5 makes that explicit for both
    ``percent`` and ``percent_used``.
    """
    if not denominator:
        return 0.0
    value = (Decimal(numerator) * Decimal(100)) / Decimal(denominator)
    return float(value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
