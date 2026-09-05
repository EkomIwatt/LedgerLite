# LedgerLite — Backend API

FastAPI + SQLAlchemy 2 (async) + Postgres. Serves the whole LedgerLite API:
authentication, expenses, budgets and the three chart aggregates.

Produces Contracts 1–6 from the root `CLAUDE.md`. Those are frozen — the
contract text is the specification, not a sketch.

---

## Quick start

### Option A — docker compose (Postgres included)

```bash
cd backend
docker compose up --build
# API   http://localhost:8000
# Docs  http://localhost:8000/docs
```

### Option B — local interpreter + SQLite

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows
# source .venv/bin/activate   # macOS / Linux
pip install -r requirements.txt

cp .env.example .env
# set DATABASE_URL=sqlite+aiosqlite:///./ledgerlite.db for a zero-setup run

uvicorn app.main:app --reload --port 8000
```

Tables are created at startup (`Base.metadata.create_all`, idempotent), so
there is no migration step.

### Tests

```bash
cd backend
.venv/Scripts/python.exe -m pytest        # Windows
# .venv/bin/pytest                        # macOS / Linux
```

195 tests run against the real ASGI app over in-memory SQLite — nothing below
the HTTP boundary is mocked.

```bash
pytest tests/test_isolation.py -v   # user scoping
pytest tests/test_auth.py -v        # tokens, rotation, enumeration
pytest tests/test_analytics.py -v   # the three chart contracts
```

---

## Layout

```
app/
  main.py         app factory, CORS, lifespan
  config.py       env-driven settings; production boot guards
  database.py     async engine + hosted-Postgres URL normalization
  models.py       users, expenses, budgets, refresh_tokens
  schemas.py      pydantic v2 wire shapes (Contracts 1–5)
  security.py     argon2 hashing, JWT mint/verify, typ discipline
  deps.py         get_current_user, query-param validation
  crud.py         all data access — every query is user-scoped
  analytics.py    Contract 5 aggregates, computed in SQL
  categories.py   Contract 2 frozen vocabulary
  errors.py       Contract 6 error envelope
  months.py       month arithmetic, half-up percentages
  routers/        auth, categories, expenses, budgets, analytics
db/init.sql       Postgres DDL for docker-compose first boot
```

---

## Security notes

Worth reading before changing anything in `app/security.py`, `app/deps.py` or
`app/crud.py`.

**Password hashing.** argon2 via passlib. Passwords are never logged, never
returned, and stored only as the hash.

**No user enumeration.** `POST /api/auth/login` returns the identical 401 body
for an unknown email and a wrong password. The unknown-email branch runs
`verify_password_dummy`, a real argon2 verification against a fixed hash, so
the two paths cost comparable time. `tests/test_auth.py` asserts both the
byte-identical response and that the dummy verification actually runs.

**Token discipline.** Access and refresh tokens are the same algorithm with the
same key; the only thing separating them is the `typ` claim, and
`decode_token(token, expected_type)` refuses to decode without being told which
type it expects. A refresh token presented as a Bearer credential is a 401.

**Rotation and revocation.** Two mechanisms, doing different jobs:

- `users.token_version` is asserted as the `tv` claim on *both* token types.
  Logout bumps it, which retires every outstanding access and refresh token for
  that user at once.
- `refresh_tokens` stores one row per issued token. Refresh revokes the row it
  consumed and issues a new one, so rotation is precise: one device signing out
  does not sign the others out.

Presenting a cookie that has already been rotated is treated as **replay**, not
as a stale tab: the whole token family is revoked and `token_version` is
bumped. This is deliberate and it depends on the frontend's single-flight
refresh (Contract 1) — N concurrent 401s must share one refresh promise, or
they will rotate each other's cookie away and trip the reuse detector.

**Scoping.** Every SELECT, UPDATE and DELETE on `expenses` and `budgets`
carries `user_id = current_user.id`. There is no unscoped helper in `crud.py`
to reach for by accident, and no route builds its own query. The client never
sends a user id — `tests/test_isolation.py` asserts that a `user_id` in a body
or a query string is ignored.

**404, not 403.** `crud.get_owned_expense` returns `None` both for a row that
does not exist and for one belonging to another user, so the two are
indistinguishable from outside. A 403 would confirm the row exists.

**Secrets.** `SECRET_KEY` comes from the environment. In production the app
refuses to boot with a missing, placeholder, or under-32-character secret, and
refuses `SameSite=None` without `Secure`.

---

## Environment

See `.env.example` for the annotated list. The two that differ between
environments:

| Variable | Local dev | Production |
|----------|-----------|------------|
| `COOKIE_SECURE` | `false` | `true` |
| `COOKIE_SAMESITE` | `lax` | `none` |

Local development is same-origin — the Vite dev server proxies `/api` to
`:8000` — so `Lax` over plain http works. In production the UI (Vercel) and API
(Render) are different origins, which requires `SameSite=None`, which browsers
only honour with `Secure` over HTTPS. The two move together.

`FRONTEND_ORIGIN` must be the exact deployed origin, no trailing slash. A
wildcard is invalid alongside `allow_credentials=True` and breaks the cookie
silently — it presents as a misleading "can't reach the API" error.

---

## Endpoints

| Method | Path | Auth | Contract |
|--------|------|------|----------|
| POST | `/api/auth/signup` | public | 1 |
| POST | `/api/auth/login` | public | 1 |
| POST | `/api/auth/refresh` | cookie | 1 |
| POST | `/api/auth/logout` | cookie/optional | 1 |
| GET | `/api/auth/me` | bearer | 1 |
| GET | `/api/categories` | public | 2 |
| GET · POST | `/api/expenses` | bearer | 3 |
| PATCH · DELETE | `/api/expenses/{id}` | bearer | 3 |
| GET · PUT | `/api/budgets` | bearer | 4 |
| DELETE | `/api/budgets/{month}/{category}` | bearer | 4 |
| GET | `/api/analytics/summary` | bearer | 5a |
| GET | `/api/analytics/by-category` | bearer | 5b |
| GET | `/api/analytics/monthly` | bearer | 5c |
| GET | `/api/health` | public | — (ops only) |

`/api/health` is not part of any contract; it exists as a platform health-check
target and is excluded from the OpenAPI schema.

Every non-2xx response from every endpoint is `{ "error": "<sentence>" }` —
never FastAPI's `{"detail": ...}`, never a nested validation list.

---

## Conventions

**Money is an integer of the minor unit** (kobo), never a float, never a
string. Wire fields carry a `_minor` suffix. All arithmetic — sums,
`remaining = limit − spent`, percentages — happens in minor units; formatting
is the frontend's last render step.

**Dates.** An expense `date` is a calendar date `YYYY-MM-DD`. A month is
`YYYY-MM`. Server timestamps are ISO-8601 UTC with a trailing `Z`, second
precision. Month bucketing is by calendar month of the expense date, and month
filtering uses a half-open `[start, next_month)` range so the
`(user_id, date DESC)` index stays usable.

**Aggregation is SQL.** Contract 5's three endpoints are `GROUP BY` + `SUM`,
not Python loops over fetched rows. The frontend does no summing, no bucketing,
no zero-filling and no percentage math. `percent` and `percent_used` are
rounded half-up to one decimal — not banker's rounding, so the number on screen
is the number a person would compute by hand.

**Python version.** The container pins 3.12.8 (`.python-version` and the
`Dockerfile`). The source stays `typing.Optional`-compatible rather than using
`X | None`, so the suite also runs on the 3.9 local interpreter.
