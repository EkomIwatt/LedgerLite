"""Contract 4 -- per (user, category, month) budgets."""
import pytest

from app.categories import CATEGORY_KEYS


async def test_empty_month_returns_an_empty_list(user_a):
    response = await user_a.get("/api/budgets?month=2026-09")
    assert response.status_code == 200
    assert response.json() == {"month": "2026-09", "budgets": []}


async def test_put_creates_then_updates_in_place(user_a):
    created = await user_a.put(
        "/api/budgets",
        json={"month": "2026-09", "category": "food", "limit_minor": 500000},
    )
    assert created.status_code == 200
    assert created.json() == {
        "month": "2026-09",
        "category": "food",
        "limit_minor": 500000,
    }

    updated = await user_a.put(
        "/api/budgets",
        json={"month": "2026-09", "category": "food", "limit_minor": 750000},
    )
    assert updated.status_code == 200
    assert updated.json()["limit_minor"] == 750000

    listed = (await user_a.get("/api/budgets?month=2026-09")).json()
    assert listed["budgets"] == [{"category": "food", "limit_minor": 750000}]


async def test_listing_follows_the_frozen_category_order_not_alphabetical(user_a):
    # Inserted in a deliberately scrambled order.
    for category in ("shopping", "food", "utilities", "transport"):
        await user_a.set_budget("2026-09", category, 1000)

    listed = (await user_a.get("/api/budgets?month=2026-09")).json()["budgets"]
    returned = [b["category"] for b in listed]
    assert returned == ["food", "transport", "utilities", "shopping"]
    # And that is the Contract 2 order, not sorted().
    assert returned == sorted(returned, key=CATEGORY_KEYS.index)
    assert returned != sorted(returned)


async def test_budgets_do_not_carry_forward_between_months(user_a):
    await user_a.set_budget("2026-09", "food", 500000)
    assert (await user_a.get("/api/budgets?month=2026-10")).json()["budgets"] == []


async def test_same_category_in_two_months_is_two_budgets(user_a):
    await user_a.set_budget("2026-09", "food", 100)
    await user_a.set_budget("2026-10", "food", 200)
    assert (await user_a.get("/api/budgets?month=2026-09")).json()["budgets"][0][
        "limit_minor"
    ] == 100
    assert (await user_a.get("/api/budgets?month=2026-10")).json()["budgets"][0][
        "limit_minor"
    ] == 200


async def test_delete_removes_a_budget(user_a):
    await user_a.set_budget("2026-09", "food", 100)
    assert (await user_a.delete("/api/budgets/2026-09/food")).status_code == 204
    assert (await user_a.get("/api/budgets?month=2026-09")).json()["budgets"] == []


async def test_delete_missing_budget_is_404(user_a):
    response = await user_a.delete("/api/budgets/2026-09/food")
    assert response.status_code == 404
    assert response.json() == {"error": "No budget set for that category and month."}


@pytest.mark.parametrize("path", ["/api/budgets/2026-9/food", "/api/budgets/2026-09/nope"])
async def test_delete_with_a_malformed_path_is_404(user_a, path):
    response = await user_a.delete(path)
    assert response.status_code == 404
    assert response.json() == {"error": "No budget set for that category and month."}


# --------------------------------------------------------------------------
# validation
# --------------------------------------------------------------------------
@pytest.mark.parametrize("limit_minor", [0, -1])
async def test_non_positive_limit_is_422(user_a, limit_minor):
    response = await user_a.put(
        "/api/budgets",
        json={"month": "2026-09", "category": "food", "limit_minor": limit_minor},
    )
    assert response.status_code == 422
    assert response.json() == {"error": "limit_minor must be greater than 0."}


async def test_unknown_category_on_put_is_422(user_a):
    response = await user_a.put(
        "/api/budgets",
        json={"month": "2026-09", "category": "foo", "limit_minor": 100},
    )
    assert response.status_code == 422
    assert response.json() == {"error": "Unknown category 'foo'."}


async def test_bad_month_in_body_is_422(user_a):
    response = await user_a.put(
        "/api/budgets",
        json={"month": "2026-9", "category": "food", "limit_minor": 100},
    )
    assert response.status_code == 422
    assert response.json() == {"error": "month must be in YYYY-MM format."}


async def test_bad_month_query_on_get_is_400(user_a):
    response = await user_a.get("/api/budgets?month=2026-9")
    assert response.status_code == 400
    assert response.json() == {"error": "Invalid month format. Expected YYYY-MM."}


async def test_missing_required_month_query_is_400(user_a):
    response = await user_a.get("/api/budgets")
    assert response.status_code == 400
    assert response.json() == {"error": "month is required."}


@pytest.mark.parametrize(
    "method,url",
    [
        ("get", "/api/budgets?month=2026-09"),
        ("put", "/api/budgets"),
        ("delete", "/api/budgets/2026-09/food"),
    ],
)
async def test_budget_routes_require_authentication(client, method, url):
    call = getattr(client, method)
    response = await call(url) if method in ("get", "delete") else await call(url, json={})
    assert response.status_code == 401
    assert response.json() == {"error": "Not authenticated."}
