"""Contract 5 -- the three chart endpoints.

Instance 2 renders these arrays directly with no client-side math, so the
zero-fill, the inclusion rule and the divide-by-zero cases are tested head-on
rather than incidentally.
"""
import pytest

from app.months import current_month, shift_month


# --------------------------------------------------------------------------
# 5a -- summary
# --------------------------------------------------------------------------
async def test_summary_is_zeroed_for_a_brand_new_account(user_a):
    response = await user_a.get("/api/analytics/summary?month=2026-09")
    assert response.status_code == 200
    assert response.json() == {
        "month": "2026-09",
        "currency": "NGN",
        "total_spent_minor": 0,
        "total_budget_minor": 0,
        "remaining_minor": 0,
        "percent_used": 0,
        "expense_count": 0,
    }


async def test_summary_totals_and_percentage(user_a):
    await user_a.add_expense(300000, category="food", date="2026-09-04")
    await user_a.add_expense(200000, category="transport", date="2026-09-20")
    await user_a.set_budget("2026-09", "food", 500000)
    await user_a.set_budget("2026-09", "transport", 300000)

    body = (await user_a.get("/api/analytics/summary?month=2026-09")).json()
    assert body["total_spent_minor"] == 500000
    assert body["total_budget_minor"] == 800000
    assert body["remaining_minor"] == 300000
    assert body["percent_used"] == 62.5
    assert body["expense_count"] == 2


async def test_summary_remaining_goes_negative_when_over_budget(user_a):
    await user_a.add_expense(900000, category="food", date="2026-09-04")
    await user_a.set_budget("2026-09", "food", 500000)

    body = (await user_a.get("/api/analytics/summary?month=2026-09")).json()
    assert body["remaining_minor"] == -400000
    assert body["percent_used"] == 180.0


async def test_summary_percent_used_is_zero_when_no_budget_is_set(user_a):
    await user_a.add_expense(123456, date="2026-09-04")
    body = (await user_a.get("/api/analytics/summary?month=2026-09")).json()
    assert body["total_budget_minor"] == 0
    assert body["percent_used"] == 0
    assert body["remaining_minor"] == -123456


async def test_summary_ignores_other_months(user_a):
    await user_a.add_expense(100, date="2026-08-31")
    await user_a.add_expense(999, date="2026-09-15")
    await user_a.add_expense(100, date="2026-10-01")
    body = (await user_a.get("/api/analytics/summary?month=2026-09")).json()
    assert body["total_spent_minor"] == 999
    assert body["expense_count"] == 1


async def test_percent_used_is_rounded_to_one_decimal(user_a):
    await user_a.add_expense(1000, date="2026-09-04")
    await user_a.set_budget("2026-09", "food", 3000)
    body = (await user_a.get("/api/analytics/summary?month=2026-09")).json()
    assert body["percent_used"] == 33.3


# --------------------------------------------------------------------------
# 5b -- by-category
# --------------------------------------------------------------------------
async def test_by_category_is_empty_for_a_brand_new_account(user_a):
    response = await user_a.get("/api/analytics/by-category?month=2026-09")
    assert response.status_code == 200
    assert response.json() == {
        "month": "2026-09",
        "currency": "NGN",
        "total_spent_minor": 0,
        "categories": [],
    }


async def test_by_category_denormalizes_label_and_color(user_a):
    await user_a.add_expense(100, category="food", date="2026-09-04")
    row = (await user_a.get("/api/analytics/by-category?month=2026-09")).json()[
        "categories"
    ][0]
    assert row["label"] == "Food"
    assert row["color"] == "#E8734A"
    assert set(row) == {
        "category", "label", "color", "spent_minor", "percent",
        "limit_minor", "remaining_minor", "percent_used", "over_budget",
    }


async def test_inclusion_rule(user_a):
    """spend>0 included; budget-only included; neither omitted."""
    await user_a.add_expense(400, category="food", date="2026-09-04")
    await user_a.set_budget("2026-09", "transport", 1000)  # budget, zero spend
    # 'housing' has neither and must not appear.

    body = (await user_a.get("/api/analytics/by-category?month=2026-09")).json()
    keys = [c["category"] for c in body["categories"]]
    assert keys == ["food", "transport"]

    transport = body["categories"][1]
    assert transport["spent_minor"] == 0
    assert transport["limit_minor"] == 1000
    assert transport["remaining_minor"] == 1000
    assert transport["percent_used"] == 0
    assert transport["over_budget"] is False


async def test_category_with_no_budget_reports_nulls_not_zeros(user_a):
    await user_a.add_expense(400, category="food", date="2026-09-04")
    row = (await user_a.get("/api/analytics/by-category?month=2026-09")).json()[
        "categories"
    ][0]
    assert row["limit_minor"] is None
    assert row["remaining_minor"] is None
    assert row["percent_used"] is None
    assert row["over_budget"] is False


async def test_over_budget_category_has_negative_remaining(user_a):
    await user_a.add_expense(1500, category="food", date="2026-09-04")
    await user_a.set_budget("2026-09", "food", 1000)
    row = (await user_a.get("/api/analytics/by-category?month=2026-09")).json()[
        "categories"
    ][0]
    assert row["remaining_minor"] == -500
    assert row["percent_used"] == 150.0
    assert row["over_budget"] is True


async def test_spending_exactly_the_limit_is_not_over_budget(user_a):
    await user_a.add_expense(1000, category="food", date="2026-09-04")
    await user_a.set_budget("2026-09", "food", 1000)
    row = (await user_a.get("/api/analytics/by-category?month=2026-09")).json()[
        "categories"
    ][0]
    assert row["remaining_minor"] == 0
    assert row["percent_used"] == 100.0
    assert row["over_budget"] is False


async def test_ordering_is_spend_desc_then_frozen_category_order(user_a):
    # transport and housing tie on spend; the Contract 2 order breaks the tie
    # (transport is index 1, housing index 2), and food outranks both.
    await user_a.add_expense(500, category="housing", date="2026-09-04")
    await user_a.add_expense(500, category="transport", date="2026-09-04")
    await user_a.add_expense(900, category="food", date="2026-09-04")

    keys = [
        c["category"]
        for c in (await user_a.get("/api/analytics/by-category?month=2026-09")).json()[
            "categories"
        ]
    ]
    assert keys == ["food", "transport", "housing"]


async def test_percent_is_share_of_total_and_zero_when_total_is_zero(user_a):
    await user_a.add_expense(750, category="food", date="2026-09-04")
    await user_a.add_expense(250, category="transport", date="2026-09-04")
    body = (await user_a.get("/api/analytics/by-category?month=2026-09")).json()
    assert body["total_spent_minor"] == 1000
    assert [c["percent"] for c in body["categories"]] == [75.0, 25.0]

    # A budget-only month has total 0 -- percent must be 0, not a crash.
    await user_a.set_budget("2026-10", "food", 5000)
    october = (await user_a.get("/api/analytics/by-category?month=2026-10")).json()
    assert october["total_spent_minor"] == 0
    assert october["categories"][0]["percent"] == 0


# --------------------------------------------------------------------------
# 5c -- monthly
# --------------------------------------------------------------------------
async def test_monthly_returns_exactly_n_zero_filled_months_for_a_new_account(user_a):
    body = (await user_a.get("/api/analytics/monthly")).json()
    assert body["currency"] == "NGN"
    assert len(body["months"]) == 6
    assert all(m["total_spent_minor"] == 0 for m in body["months"])
    assert all(m["total_budget_minor"] == 0 for m in body["months"])


@pytest.mark.parametrize("months", [1, 3, 6, 12, 24])
async def test_monthly_length_always_matches_the_parameter(user_a, months):
    body = (await user_a.get("/api/analytics/monthly?months=%d" % months)).json()
    assert len(body["months"]) == months


async def test_monthly_is_contiguous_oldest_first_ending_on_the_current_month(user_a):
    keys = [
        m["month"] for m in (await user_a.get("/api/analytics/monthly?months=4")).json()["months"]
    ]
    now = current_month()
    assert keys[-1] == now
    assert keys == [shift_month(now, -3), shift_month(now, -2), shift_month(now, -1), now]


async def test_monthly_buckets_spend_and_budget_by_month(user_a):
    now = current_month()
    previous = shift_month(now, -1)

    await user_a.add_expense(100, date="%s-05" % now)
    await user_a.add_expense(200, date="%s-06" % now)
    await user_a.add_expense(50, date="%s-15" % previous)
    await user_a.set_budget(now, "food", 900)
    await user_a.set_budget(now, "transport", 100)

    points = {
        m["month"]: m
        for m in (await user_a.get("/api/analytics/monthly?months=3")).json()["months"]
    }
    assert points[now]["total_spent_minor"] == 300
    assert points[now]["total_budget_minor"] == 1000
    assert points[previous]["total_spent_minor"] == 50
    assert points[previous]["total_budget_minor"] == 0


async def test_monthly_skips_expenses_outside_the_window(user_a):
    now = current_month()
    outside = shift_month(now, -5)
    await user_a.add_expense(999, date="%s-15" % outside)

    body = (await user_a.get("/api/analytics/monthly?months=3")).json()
    assert sum(m["total_spent_minor"] for m in body["months"]) == 0

    wider = (await user_a.get("/api/analytics/monthly?months=6")).json()
    assert sum(m["total_spent_minor"] for m in wider["months"]) == 999


@pytest.mark.parametrize("months", [0, 25, -1])
async def test_out_of_range_months_is_400(user_a, months):
    response = await user_a.get("/api/analytics/monthly?months=%d" % months)
    assert response.status_code == 400
    assert "error" in response.json()


# --------------------------------------------------------------------------
# shared: required month, authentication
# --------------------------------------------------------------------------
@pytest.mark.parametrize("path", ["/api/analytics/summary", "/api/analytics/by-category"])
async def test_month_is_required_and_validated(user_a, path):
    missing = await user_a.get(path)
    assert missing.status_code == 400
    assert missing.json() == {"error": "month is required."}

    malformed = await user_a.get("%s?month=2026-13" % path)
    assert malformed.status_code == 400
    assert malformed.json() == {"error": "Invalid month format. Expected YYYY-MM."}


@pytest.mark.parametrize(
    "path",
    [
        "/api/analytics/summary?month=2026-09",
        "/api/analytics/by-category?month=2026-09",
        "/api/analytics/monthly",
    ],
)
async def test_analytics_routes_require_authentication(client, path):
    response = await client.get(path)
    assert response.status_code == 401
    assert response.json() == {"error": "Not authenticated."}
