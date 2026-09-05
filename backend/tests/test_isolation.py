"""User scoping.

A route that forgets its ``user_id`` predicate is the single worst bug this
project can ship, so this file tries to reach every one of user B's rows
through every verb user A has: read, list, update, delete, and each of the
three analytics aggregates.

Two invariants throughout:

* the answer is **404, not 403** -- a 403 would confirm the row exists;
* B's data is verified **unchanged afterwards**, because a write that returns
  404 but still mutated the row would otherwise pass silently.
"""
import pytest

from app.categories import CATEGORY_KEYS


@pytest.fixture
async def b_expense(user_b):
    return await user_b.add_expense(777, category="health", date="2026-09-10", note="B only")


@pytest.fixture
async def b_budget(user_b):
    return await user_b.set_budget("2026-09", "health", 999000)


# --------------------------------------------------------------------------
# expenses
# --------------------------------------------------------------------------
async def test_a_cannot_list_bs_expenses(user_a, user_b, b_expense):
    await user_a.add_expense(100, category="food", date="2026-09-10")

    listed = (await user_a.get("/api/expenses")).json()
    assert listed["total"] == 1
    assert [e["id"] for e in listed["expenses"]] != [b_expense["id"]]
    assert all(e["note"] != "B only" for e in listed["expenses"])


async def test_a_cannot_read_bs_expense_through_the_list_filters(user_a, user_b, b_expense):
    for query in ("?month=2026-09", "?category=health", "?limit=200"):
        body = (await user_a.get("/api/expenses%s" % query)).json()
        assert body["total"] == 0
        assert body["expenses"] == []


async def test_a_patching_bs_expense_is_404_and_changes_nothing(user_a, user_b, b_expense):
    response = await user_a.patch(
        "/api/expenses/%d" % b_expense["id"], json={"amount_minor": 1, "note": "hacked"}
    )
    assert response.status_code == 404
    assert response.json() == {"error": "Expense not found."}

    still_there = (await user_b.get("/api/expenses")).json()["expenses"][0]
    assert still_there["amount_minor"] == 777
    assert still_there["note"] == "B only"
    assert still_there["updated_at"] == b_expense["updated_at"]


async def test_a_deleting_bs_expense_is_404_and_the_row_survives(user_a, user_b, b_expense):
    response = await user_a.delete("/api/expenses/%d" % b_expense["id"])
    assert response.status_code == 404
    assert response.json() == {"error": "Expense not found."}

    assert (await user_b.get("/api/expenses")).json()["total"] == 1


async def test_cross_user_access_is_404_not_403(user_a, user_b, b_expense):
    """404 must be byte-identical to 'no such id' -- a 403 would confirm existence."""
    real_but_foreign = await user_a.patch(
        "/api/expenses/%d" % b_expense["id"], json={"amount_minor": 5}
    )
    nonexistent = await user_a.patch("/api/expenses/987654321", json={"amount_minor": 5})

    assert real_but_foreign.status_code == nonexistent.status_code == 404
    assert real_but_foreign.content == nonexistent.content


# --------------------------------------------------------------------------
# budgets
# --------------------------------------------------------------------------
async def test_a_cannot_see_bs_budgets(user_a, user_b, b_budget):
    assert (await user_a.get("/api/budgets?month=2026-09")).json()["budgets"] == []


async def test_a_setting_the_same_budget_does_not_overwrite_bs(user_a, user_b, b_budget):
    await user_a.set_budget("2026-09", "health", 1)

    assert (await user_a.get("/api/budgets?month=2026-09")).json()["budgets"] == [
        {"category": "health", "limit_minor": 1}
    ]
    assert (await user_b.get("/api/budgets?month=2026-09")).json()["budgets"] == [
        {"category": "health", "limit_minor": 999000}
    ]


async def test_a_deleting_bs_budget_is_404_and_bs_budget_survives(user_a, user_b, b_budget):
    response = await user_a.delete("/api/budgets/2026-09/health")
    assert response.status_code == 404
    assert response.json() == {"error": "No budget set for that category and month."}

    assert (await user_b.get("/api/budgets?month=2026-09")).json()["budgets"] == [
        {"category": "health", "limit_minor": 999000}
    ]


# --------------------------------------------------------------------------
# analytics
# --------------------------------------------------------------------------
async def test_summary_never_includes_another_users_rows(user_a, user_b, b_expense, b_budget):
    body = (await user_a.get("/api/analytics/summary?month=2026-09")).json()
    assert body["total_spent_minor"] == 0
    assert body["total_budget_minor"] == 0
    assert body["expense_count"] == 0

    await user_a.add_expense(5, category="food", date="2026-09-10")
    body = (await user_a.get("/api/analytics/summary?month=2026-09")).json()
    assert body["total_spent_minor"] == 5
    assert body["expense_count"] == 1


async def test_by_category_never_includes_another_users_rows(
    user_a, user_b, b_expense, b_budget
):
    body = (await user_a.get("/api/analytics/by-category?month=2026-09")).json()
    assert body["categories"] == []
    assert body["total_spent_minor"] == 0


async def test_monthly_never_includes_another_users_rows(user_a, user_b):
    from app.months import current_month

    now = current_month()
    await user_b.add_expense(4242, category="food", date="%s-10" % now)
    await user_b.set_budget(now, "food", 8888)

    body = (await user_a.get("/api/analytics/monthly?months=3")).json()
    assert all(m["total_spent_minor"] == 0 for m in body["months"])
    assert all(m["total_budget_minor"] == 0 for m in body["months"])


# --------------------------------------------------------------------------
# the client never supplies a user id
# --------------------------------------------------------------------------
async def test_a_user_id_in_the_body_is_ignored(user_a, user_b):
    """Ownership comes from the token; a user_id field must not be honoured."""
    response = await user_a.post(
        "/api/expenses",
        json={
            "amount_minor": 100,
            "category": "food",
            "date": "2026-09-04",
            "user_id": user_b.id,
        },
    )
    assert response.status_code == 201

    assert (await user_a.get("/api/expenses")).json()["total"] == 1
    assert (await user_b.get("/api/expenses")).json()["total"] == 0


async def test_a_user_id_query_parameter_is_ignored(user_a, user_b):
    await user_b.add_expense(500, category="food", date="2026-09-04")
    body = (await user_a.get("/api/expenses?user_id=%d" % user_b.id)).json()
    assert body["total"] == 0


async def test_every_category_is_isolated(user_a, user_b):
    """Loop the whole vocabulary so no single category has a stray query."""
    for key in CATEGORY_KEYS:
        await user_b.add_expense(10, category=key, date="2026-09-04")

    assert (await user_a.get("/api/expenses")).json()["total"] == 0
    assert (await user_a.get("/api/analytics/by-category?month=2026-09")).json()[
        "categories"
    ] == []
    assert (await user_b.get("/api/expenses")).json()["total"] == len(CATEGORY_KEYS)
