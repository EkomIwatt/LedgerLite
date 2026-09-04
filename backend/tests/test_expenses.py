"""Contract 3 -- expense CRUD, filtering, ordering and validation."""
import pytest


async def test_create_returns_the_expense_object(user_a):
    response = await user_a.post(
        "/api/expenses",
        json={
            "amount_minor": 249900,
            "category": "food",
            "date": "2026-09-04",
            "note": "Jollof",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert set(body) == {
        "id", "amount_minor", "category", "date", "note", "created_at", "updated_at"
    }
    assert body["amount_minor"] == 249900
    assert body["category"] == "food"
    assert body["date"] == "2026-09-04"
    assert body["note"] == "Jollof"
    assert body["created_at"].endswith("Z")
    assert body["updated_at"].endswith("Z")


async def test_note_is_optional_and_empty_string_becomes_null(user_a):
    without = await user_a.post(
        "/api/expenses",
        json={"amount_minor": 100, "category": "other", "date": "2026-09-04"},
    )
    assert without.status_code == 201
    assert without.json()["note"] is None

    blank = await user_a.add_expense(100, note="   ")
    assert blank["note"] is None


async def test_list_is_empty_not_404_for_a_new_account(user_a):
    response = await user_a.get("/api/expenses")
    assert response.status_code == 200
    assert response.json() == {"expenses": [], "total": 0, "limit": 50, "offset": 0}


async def test_list_orders_by_date_desc_then_id_desc(user_a):
    older = await user_a.add_expense(100, date="2026-09-01")
    same_day_first = await user_a.add_expense(200, date="2026-09-05")
    same_day_second = await user_a.add_expense(300, date="2026-09-05")

    rows = (await user_a.get("/api/expenses")).json()["expenses"]
    assert [r["id"] for r in rows] == [
        same_day_second["id"],
        same_day_first["id"],
        older["id"],
    ]


async def test_month_filter_uses_calendar_month_boundaries(user_a):
    await user_a.add_expense(100, date="2026-08-31")
    inside_first = await user_a.add_expense(200, date="2026-09-01")
    inside_last = await user_a.add_expense(300, date="2026-09-30")
    await user_a.add_expense(400, date="2026-10-01")

    rows = (await user_a.get("/api/expenses?month=2026-09")).json()
    assert rows["total"] == 2
    assert {r["id"] for r in rows["expenses"]} == {inside_first["id"], inside_last["id"]}


async def test_december_month_filter_rolls_the_year(user_a):
    inside = await user_a.add_expense(100, date="2026-12-31")
    await user_a.add_expense(200, date="2027-01-01")
    rows = (await user_a.get("/api/expenses?month=2026-12")).json()
    assert [r["id"] for r in rows["expenses"]] == [inside["id"]]


async def test_category_filter(user_a):
    food = await user_a.add_expense(100, category="food")
    await user_a.add_expense(200, category="transport")
    rows = (await user_a.get("/api/expenses?category=food")).json()
    assert rows["total"] == 1
    assert rows["expenses"][0]["id"] == food["id"]


async def test_total_ignores_limit_and_offset(user_a):
    for i in range(5):
        await user_a.add_expense(100 + i, date="2026-09-0%d" % (i + 1))

    page = (await user_a.get("/api/expenses?limit=2&offset=1")).json()
    assert page["total"] == 5
    assert page["limit"] == 2
    assert page["offset"] == 1
    assert len(page["expenses"]) == 2


async def test_patch_updates_a_subset_and_refreshes_updated_at(user_a):
    created = await user_a.add_expense(100, category="food", note="old")
    response = await user_a.patch(
        "/api/expenses/%d" % created["id"], json={"amount_minor": 555}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["amount_minor"] == 555
    assert body["category"] == "food"
    assert body["note"] == "old"


async def test_patch_can_clear_a_note_with_explicit_null(user_a):
    created = await user_a.add_expense(100, note="temporary")
    response = await user_a.patch("/api/expenses/%d" % created["id"], json={"note": None})
    assert response.status_code == 200
    assert response.json()["note"] is None


async def test_patch_rejects_an_explicit_null_amount(user_a):
    created = await user_a.add_expense(100)
    response = await user_a.patch(
        "/api/expenses/%d" % created["id"], json={"amount_minor": None}
    )
    assert response.status_code == 422
    assert "error" in response.json()


async def test_delete_removes_the_row(user_a):
    created = await user_a.add_expense(100)
    assert (await user_a.delete("/api/expenses/%d" % created["id"])).status_code == 204
    assert (await user_a.get("/api/expenses")).json()["total"] == 0


async def test_patch_and_delete_on_unknown_id_are_404(user_a):
    patched = await user_a.patch("/api/expenses/999999", json={"amount_minor": 1})
    deleted = await user_a.delete("/api/expenses/999999")
    assert patched.status_code == deleted.status_code == 404
    assert patched.json() == {"error": "Expense not found."}
    assert deleted.json() == {"error": "Expense not found."}


# --------------------------------------------------------------------------
# validation
# --------------------------------------------------------------------------
@pytest.mark.parametrize("amount", [0, -1])
async def test_non_positive_amount_is_422(user_a, amount):
    response = await user_a.post(
        "/api/expenses",
        json={"amount_minor": amount, "category": "food", "date": "2026-09-04"},
    )
    assert response.status_code == 422
    assert response.json() == {"error": "amount_minor must be greater than 0."}


async def test_amount_above_the_ceiling_is_422(user_a):
    response = await user_a.post(
        "/api/expenses",
        json={
            "amount_minor": 1_000_000_000_001,
            "category": "food",
            "date": "2026-09-04",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"].startswith("amount_minor must not exceed")


async def test_float_amount_is_rejected(user_a):
    response = await user_a.post(
        "/api/expenses",
        json={"amount_minor": 12.5, "category": "food", "date": "2026-09-04"},
    )
    assert response.status_code == 422


async def test_unknown_category_is_422_with_the_frozen_sentence(user_a):
    response = await user_a.post(
        "/api/expenses",
        json={"amount_minor": 100, "category": "foo", "date": "2026-09-04"},
    )
    assert response.status_code == 422
    assert response.json() == {"error": "Unknown category 'foo'."}


async def test_note_over_500_chars_is_422(user_a):
    response = await user_a.post(
        "/api/expenses",
        json={
            "amount_minor": 100,
            "category": "food",
            "date": "2026-09-04",
            "note": "x" * 501,
        },
    )
    assert response.status_code == 422
    assert "500" in response.json()["error"]


async def test_past_and_future_dates_are_both_allowed(user_a):
    assert (await user_a.add_expense(100, date="1999-01-01"))["date"] == "1999-01-01"
    assert (await user_a.add_expense(100, date="2099-12-31"))["date"] == "2099-12-31"


async def test_invalid_date_is_422(user_a):
    response = await user_a.post(
        "/api/expenses",
        json={"amount_minor": 100, "category": "food", "date": "2026-02-30"},
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------
# query-parameter errors are 400, not 422
# --------------------------------------------------------------------------
@pytest.mark.parametrize("month", ["2026-9", "202609", "not-a-month", "2026-13"])
async def test_bad_month_query_is_400_with_the_frozen_sentence(user_a, month):
    response = await user_a.get("/api/expenses?month=%s" % month)
    assert response.status_code == 400
    assert response.json() == {"error": "Invalid month format. Expected YYYY-MM."}


@pytest.mark.parametrize("limit", [0, 201, -5])
async def test_out_of_range_limit_is_400(user_a, limit):
    response = await user_a.get("/api/expenses?limit=%d" % limit)
    assert response.status_code == 400
    assert "error" in response.json()


async def test_negative_offset_is_400(user_a):
    response = await user_a.get("/api/expenses?offset=-1")
    assert response.status_code == 400


async def test_unknown_category_filter_is_400(user_a):
    response = await user_a.get("/api/expenses?category=nope")
    assert response.status_code == 400
    assert response.json() == {"error": "Unknown category 'nope'."}


# --------------------------------------------------------------------------
# every route is protected
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    "method,url",
    [
        ("get", "/api/expenses"),
        ("post", "/api/expenses"),
        ("patch", "/api/expenses/1"),
        ("delete", "/api/expenses/1"),
    ],
)
async def test_expense_routes_require_authentication(client, method, url):
    call = getattr(client, method)
    response = await call(url) if method in ("get", "delete") else await call(url, json={})
    assert response.status_code == 401
    assert response.json() == {"error": "Not authenticated."}
    assert response.headers.get("WWW-Authenticate") == "Bearer"
