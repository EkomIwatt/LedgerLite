"""Month arithmetic and percentage rounding.

The zero-filled contiguous month series and the one-decimal percentages are
what Instance 2 is trusting the backend for, so they get direct unit coverage
in addition to the endpoint tests.
"""
from datetime import date

import pytest

from app.months import (
    current_month,
    is_valid_month,
    month_bounds,
    month_key,
    month_series,
    one_decimal,
    shift_month,
)


@pytest.mark.parametrize("value", ["2026-01", "2026-09", "2026-12", "1999-05"])
def test_valid_months(value):
    assert is_valid_month(value)


@pytest.mark.parametrize(
    "value", ["2026-9", "2026-13", "2026-00", "202609", "2026", "", "not-a-month", "2026-1a"]
)
def test_invalid_months(value):
    assert not is_valid_month(value)


def test_month_bounds_is_half_open():
    start, end = month_bounds("2026-09")
    assert start == date(2026, 9, 1)
    assert end == date(2026, 10, 1)


def test_december_bounds_roll_the_year():
    start, end = month_bounds("2026-12")
    assert start == date(2026, 12, 1)
    assert end == date(2027, 1, 1)


@pytest.mark.parametrize(
    "value,delta,expected",
    [
        ("2026-09", -1, "2026-08"),
        ("2026-01", -1, "2025-12"),
        ("2026-12", 1, "2027-01"),
        ("2026-06", -12, "2025-06"),
        ("2026-03", -14, "2025-01"),
        ("2026-09", 0, "2026-09"),
    ],
)
def test_shift_month(value, delta, expected):
    assert shift_month(value, delta) == expected


def test_month_series_is_contiguous_oldest_first_ending_on_the_given_month():
    assert month_series(6, "2026-03") == [
        "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
    ]


@pytest.mark.parametrize("count", [1, 2, 6, 12, 24])
def test_month_series_length_always_matches(count):
    assert len(month_series(count, "2026-09")) == count


def test_month_series_defaults_to_the_current_month():
    assert month_series(3)[-1] == current_month()


def test_month_key_formats_with_leading_zeros():
    assert month_key(date(2026, 1, 5)) == "2026-01"


# --------------------------------------------------------------------------
# percentages
# --------------------------------------------------------------------------
def test_zero_denominator_is_zero_not_a_crash():
    assert one_decimal(0, 0) == 0.0
    assert one_decimal(500, 0) == 0.0


@pytest.mark.parametrize(
    "numerator,denominator,expected",
    [
        (1, 3, 33.3),
        (2, 3, 66.7),
        (1, 2, 50.0),
        (3, 4, 75.0),
        (0, 100, 0.0),
        (100, 100, 100.0),
        (180, 100, 180.0),  # over budget is not clamped
        (1000, 3000, 33.3),
    ],
)
def test_one_decimal(numerator, denominator, expected):
    assert one_decimal(numerator, denominator) == expected


def test_rounding_is_half_up_not_bankers():
    # 0.25 -> 25.0; the interesting case is a .x5 boundary at one decimal.
    assert one_decimal(1125, 10000) == 11.3  # 11.25 -> 11.3, not 11.2
    assert one_decimal(1175, 10000) == 11.8  # 11.75 -> 11.8
