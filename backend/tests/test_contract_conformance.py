"""Contract conformance: exact wire shapes for every endpoint.

Instance 2 built its entire UI against a mock of this output without ever
seeing this code, and is running a mirror-image suite against that mock.  This
file is the producer half of that pair -- it asserts the *shape* of every
response (exact key sets, exact types, exact nullability) rather than the
business logic, which the per-contract files already cover.

If the Reconciler finds a mismatch at merge, the disagreement should be
visible by diffing this file against Instance 2's conformance suite.
"""
import re

ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH = re.compile(r"^\d{4}-\d{2}$")
HEX_COLOR = re.compile(r"^#[0-9A-F]{6}$")


def assert_keys(obj, expected):
    assert isinstance(obj, dict)
    assert set(obj) == set(expected), "got %s, want %s" % (sorted(obj), sorted(expected))


def assert_user(user):
    assert_keys(user, ["id", "email", "created_at"])
    assert isinstance(user["id"], int)
    assert isinstance(user["email"], str)
    assert ISO_Z.match(user["created_at"])


def assert_expense(expense):
    assert_keys(
        expense,
        ["id", "amount_minor", "category", "date", "note", "created_at", "updated_at"],
    )
    assert isinstance(expense["id"], int)
    assert isinstance(expense["amount_minor"], int)
    assert not isinstance(expense["amount_minor"], bool)
    assert isinstance(expense["category"], str)
    assert DATE.match(expense["date"])
    assert expense["note"] is None or isinstance(expense["note"], str)
    assert ISO_Z.match(expense["created_at"])
    assert ISO_Z.match(expense["updated_at"])


# --------------------------------------------------------------------------
# Contract 1
# --------------------------------------------------------------------------
async def test_signup_and_login_share_one_session_shape(client, user_a):
    signup = await client.post(
        "/api/auth/signup", json={"email": "shape@example.com", "password": "a-good-password"}
    )
    login = await user_a.client.post(
        "/api/auth/login", json={"email": user_a.email, "password": user_a.password}
    )
    assert signup.status_code == 201
    assert login.status_code == 200

    for body in (signup.json(), login.json()):
        assert_keys(body, ["access_token", "token_type", "expires_in", "user"])
        assert isinstance(body["access_token"], str) and body["access_token"]
        assert body["token_type"] == "bearer"
        assert body["expires_in"] == 900
        assert_user(body["user"])


async def test_refresh_shape(user_a):
    body = (await user_a.client.post("/api/auth/refresh")).json()
    assert_keys(body, ["access_token", "token_type", "expires_in"])
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 900
    # The refresh token is never in a response body.
    assert "refresh_token" not in body


async def test_me_shape(user_a):
    assert_user((await user_a.get("/api/auth/me")).json())


# --------------------------------------------------------------------------
# Contract 2
# --------------------------------------------------------------------------
async def test_categories_shape(client):
    body = (await client.get("/api/categories")).json()
    assert_keys(body, ["categories"])
    assert len(body["categories"]) == 10
    for entry in body["categories"]:
        assert_keys(entry, ["key", "label", "color"])
        assert HEX_COLOR.match(entry["color"]), entry["color"]


# --------------------------------------------------------------------------
# Contract 3
# --------------------------------------------------------------------------
async def test_expense_list_shape(user_a):
    await user_a.add_expense(1234, note="shape check")
    body = (await user_a.get("/api/expenses")).json()
    assert_keys(body, ["expenses", "total", "limit", "offset"])
    assert isinstance(body["total"], int)
    assert isinstance(body["limit"], int)
    assert isinstance(body["offset"], int)
    for expense in body["expenses"]:
        assert_expense(expense)


async def test_expense_write_shapes(user_a):
    created = await user_a.post(
        "/api/expenses",
        json={"amount_minor": 10, "category": "food", "date": "2026-09-04"},
    )
    assert created.status_code == 201
    assert_expense(created.json())

    patched = await user_a.patch(
        "/api/expenses/%d" % created.json()["id"], json={"note": "edited"}
    )
    assert patched.status_code == 200
    assert_expense(patched.json())

    deleted = await user_a.delete("/api/expenses/%d" % created.json()["id"])
    assert deleted.status_code == 204
    assert deleted.content == b""


# --------------------------------------------------------------------------
# Contract 4
# --------------------------------------------------------------------------
async def test_budget_shapes(user_a):
    upserted = await user_a.put(
        "/api/budgets",
        json={"month": "2026-09", "category": "food", "limit_minor": 500000},
    )
    assert_keys(upserted.json(), ["month", "category", "limit_minor"])

    listed = (await user_a.get("/api/budgets?month=2026-09")).json()
    assert_keys(listed, ["month", "budgets"])
    assert MONTH.match(listed["month"])
    for entry in listed["budgets"]:
        assert_keys(entry, ["category", "limit_minor"])
        assert isinstance(entry["limit_minor"], int)


# --------------------------------------------------------------------------
# Contract 5
# --------------------------------------------------------------------------
async def test_summary_shape(user_a):
    await user_a.add_expense(1000, date="2026-09-04")
    await user_a.set_budget("2026-09", "food", 4000)
    body = (await user_a.get("/api/analytics/summary?month=2026-09")).json()

    assert_keys(
        body,
        [
            "month", "currency", "total_spent_minor", "total_budget_minor",
            "remaining_minor", "percent_used", "expense_count",
        ],
    )
    assert MONTH.match(body["month"])
    assert body["currency"] == "NGN"
    for key in ("total_spent_minor", "total_budget_minor", "remaining_minor", "expense_count"):
        assert isinstance(body[key], int), key
    assert isinstance(body["percent_used"], (int, float))


async def test_by_category_shape(user_a):
    await user_a.add_expense(1000, category="food", date="2026-09-04")
    await user_a.set_budget("2026-09", "transport", 4000)
    body = (await user_a.get("/api/analytics/by-category?month=2026-09")).json()

    assert_keys(body, ["month", "currency", "total_spent_minor", "categories"])
    assert body["currency"] == "NGN"

    for entry in body["categories"]:
        assert_keys(
            entry,
            [
                "category", "label", "color", "spent_minor", "percent",
                "limit_minor", "remaining_minor", "percent_used", "over_budget",
            ],
        )
        assert HEX_COLOR.match(entry["color"])
        assert isinstance(entry["spent_minor"], int)
        assert isinstance(entry["percent"], (int, float))
        assert isinstance(entry["over_budget"], bool)
        # The three budget fields are null together or present together.
        budget_fields = (entry["limit_minor"], entry["remaining_minor"], entry["percent_used"])
        assert all(f is None for f in budget_fields) or all(f is not None for f in budget_fields)


async def test_monthly_shape(user_a):
    body = (await user_a.get("/api/analytics/monthly?months=3")).json()
    assert_keys(body, ["currency", "months"])
    assert body["currency"] == "NGN"
    assert len(body["months"]) == 3
    for entry in body["months"]:
        assert_keys(entry, ["month", "total_spent_minor", "total_budget_minor"])
        assert MONTH.match(entry["month"])
        assert isinstance(entry["total_spent_minor"], int)
        assert isinstance(entry["total_budget_minor"], int)


# --------------------------------------------------------------------------
# Contract 5 -- the empty-state guarantee, all three at once
# --------------------------------------------------------------------------
async def test_a_brand_new_account_gets_200_from_every_analytics_endpoint(user_a):
    summary = await user_a.get("/api/analytics/summary?month=2026-09")
    by_category = await user_a.get("/api/analytics/by-category?month=2026-09")
    monthly = await user_a.get("/api/analytics/monthly")

    assert summary.status_code == by_category.status_code == monthly.status_code == 200
    assert summary.json()["total_spent_minor"] == 0
    assert by_category.json()["categories"] == []
    assert len(monthly.json()["months"]) == 6
    # Never a null at the top level.
    for response in (summary, by_category, monthly):
        assert all(v is not None for v in response.json().values())
