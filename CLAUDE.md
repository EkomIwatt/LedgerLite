# LedgerLite — Multi-Agent Coordination File

> Project 2 of 10 in the AI-accelerated full-stack ladder. Second Swarm run.
> Snipp proved the machinery on a no-auth app; this run adds the two things Snipp
> deliberately excluded: **an auth layer** and **user-scoped data**.

## Project goal

LedgerLite is a private personal expense tracker. A user signs up with email + password,
logs expenses (amount, category, date, note), edits and deletes them, sets a monthly
spending limit per category, and sees where the money went through three visualizations:
a **category pie chart**, a **month-over-month bar chart**, and a **budget-remaining gauge**.
Every row belongs to exactly one user and is invisible to everyone else. The engineering
targets are (a) authentication done properly — argon2 password hashing, short-lived access
JWTs with an httpOnly refresh cookie, protected routes, and *every* query scoped to the
authenticated user — and (b) data visualization, meaning the backend turns raw expense rows
into chart-ready aggregates so the frontend's chart code stays dumb.

**Deliverables:** a FastAPI + Postgres backend, a React/Vite/TypeScript frontend, both test
suites green, and a clean Reconciler merge with every frozen contract holding on both real sides.

## Stack (settled — do not change without the human)

| Layer | Choice |
|-------|--------|
| Backend | **FastAPI** + SQLAlchemy 2 (async) + asyncpg |
| Database | **Postgres** (Neon in prod); tests run on in-memory SQLite via aiosqlite |
| Auth | **argon2** (passlib) hashing · **HS256 JWT** access token · httpOnly refresh cookie |
| Frontend | **React 19** + Vite + TypeScript + react-router |
| Charts | **Recharts** |
| Tests | pytest + httpx (backend) · Vitest + Testing Library (frontend) |
| Deploy | Vercel (UI) → Render (API) → Neon (Postgres) — same three-layer split as Snipp |

## Decomposition rationale

**Two instances. The seam is the process boundary: server vs. client.**

*Could one instance do this?* Yes — but the two halves are written in different languages,
live in disjoint directories, and communicate only over HTTP/JSON. That is the cleanest
possible seam, and it is the same seam that produced zero mismatches on Snipp. Splitting here
buys real parallelism at near-zero coordination cost.

*Why not three — why isn't auth its own instance?* Because auth is not separable from the API
it protects. The `current_user` dependency is injected into every expense, budget, and analytics
route; the `users` table is the FK target of every other table; and the user-scoping predicate
lives inside the same queries that compute the aggregates. A third instance would have to hand
Instance 1 *real importable Python*, not a stubbable JSON contract — which is precisely the
"can't be stubbed" test for pieces that must not run in parallel. So **auth folds into the
backend instance** (rule a: fold cross-cutting work into the domain owner that naturally
produces it).

*Why not a third instance for glue?* Same rule. `docker-compose.yml`, `Dockerfile`, `db/init.sql`,
CORS config and `.env.example` fold into Instance 1. The Vite dev proxy, `vercel.json` and the
frontend `.env.example` fold into Instance 2. `BUILT-WITH-SWARM.md`, `DEPLOY.md` and the root
`README.md` are left as **merge-time artifacts for the human/Reconciler** (rule b: small,
spanning both, and best written once both halves are real). No cross-cutting work here is
substantial enough to earn its own instance (rule c not triggered).

**Nothing is deliberately sequenced.** Both instances build fully in parallel behind the frozen
contracts: Instance 2 stubs the entire backend through a mock layer, exactly as it did on Snipp.

**One boundary that cannot be proven until merge:** the httpOnly refresh cookie round-trip
(login sets the cookie → page reload → `POST /api/auth/refresh` returns a fresh access token).
A mock can simulate the *responses* but not a real `Set-Cookie` from a real origin. Instance 2
must build and test the refresh-on-401 and boot-refresh logic against mocks; the genuine cookie
round-trip is an explicit **check-at-merge** item for the Reconciler (see the bottom of this file).
This is the analogue of Snipp's deferred live e2e — known, scoped, and written down in advance.

## Status legend
IN PROGRESS · PENDING · BLOCKED · DONE · ASSUMED · WAITING ON <who/what>

## Project-wide conventions (binding on both instances)

- **Money is always an integer of the minor unit** (kobo/cents), never a float, never a string.
  Wire field names carry a `_minor` suffix so neither side can misread them. All arithmetic —
  sums, `remaining = limit − spent`, percentages — happens in minor units; formatting to
  `₦2,499.00` happens only at the last render step.
- **Currency is a single display constant.** `"NGN"` is returned by the analytics endpoints and
  used for formatting. No multi-currency, no conversion. `ASSUMED` — low stakes, display-only.
- **Dates:** an expense `date` is a calendar date `"YYYY-MM-DD"` (no time, no timezone).
  A month is `"YYYY-MM"`. Server timestamps (`created_at`, `updated_at`) are ISO-8601 UTC with a
  trailing `Z`. Month bucketing is by calendar month of the expense `date`. `ASSUMED`.
- **Error envelope is `{ "error": "<sentence>" }`** for every non-2xx response, from every
  endpoint. See Contract 6.
- **The client never sends a user id.** Ownership is derived from the access token, always.

---

## INTERFACE CONTRACTS  —  STATUS: FROZEN
<!-- Becomes FROZEN only on human ratification. After that: no edits without the human.
     Ratify and commit on `main` BEFORE creating the worktrees, so both instances provably
     branch from byte-identical contract text. -->

### Contract 1: Authentication
- **Producer:** Instance 1
- **Consumer(s):** Instance 2
- **Shape / format:**

```
POST /api/auth/signup            (public)
  request   { "email": string, "password": string }
  201       { "access_token": string,
              "token_type": "bearer",
              "expires_in": 900,
              "user": { "id": int, "email": string, "created_at": "2026-09-04T10:00:00Z" } }
            + Set-Cookie: refresh_token=<jwt>; HttpOnly; Path=/api/auth; Max-Age=2592000; ...
  409       { "error": "An account with that email already exists." }
  422       { "error": "Password must be at least 8 characters." }

POST /api/auth/login             (public)
  request   { "email": string, "password": string }
  200       <identical body + Set-Cookie to signup's 201>
  401       { "error": "Incorrect email or password." }
            ^ THE SAME message for an unknown email and for a wrong password.
              No user enumeration — not by message, not by status code, not by timing.

POST /api/auth/refresh           (cookie only — NO request body, NO Authorization header)
  200       { "access_token": string, "token_type": "bearer", "expires_in": 900 }
            + Set-Cookie: refresh_token=<new jwt>   (rotated on every refresh)
  401       { "error": "Session expired. Please sign in again." }
            ^ for missing, malformed and expired cookies alike

  [AMENDMENT 1 — ratified 2026-09-05, post-merge] An ALREADY-ROTATED cookie is no
  longer unconditionally a 401. Within a grace window (REFRESH_REPLAY_GRACE_SECONDS,
  default 10s) of its rotation, AND only while some refresh token in the family is
  still live, a replayed cookie returns 200 with a fresh access token and NO
  Set-Cookie — the jar already holds the successor. Outside the window, or once the
  family is dead, it is treated as theft: the family is revoked, token_version is
  bumped, and the response is the same 401.
  Rationale: two tabs share a cookie jar but not a single-flight promise, so the
  losing tab posts the cookie the winner just rotated. Under the pre-amendment rule
  that benign race signed the user out on every device. See ESCALATIONS below.

POST /api/auth/logout            (cookie; access token optional)
  204       no body. Clears the cookie. Idempotent — 204 even if not logged in.

GET  /api/auth/me                (protected)
  200       { "id": int, "email": string, "created_at": "2026-09-04T10:00:00Z" }
  401       { "error": "Not authenticated." }

--- Token semantics ---
Access token:  HS256 JWT. Claims: sub (user id as string), typ ("access"), iat, exp, jti.
               Lifetime 900s (15 min). Sent as `Authorization: Bearer <token>`.
Refresh token: HS256 JWT. Claims: sub, typ ("refresh"), iat, exp, jti. Lifetime 30 days.
               Lives ONLY in the httpOnly cookie. Never in a response body, never in JS.
The `typ` claim is mandatory and MUST be checked: a refresh token presented as a Bearer
access token is rejected with 401, and vice versa.

--- Cookie attributes (environment-driven) ---
  name      refresh_token
  HttpOnly  always
  Path      /api/auth
  Max-Age   2592000
  Secure    prod: true   · local dev: false      (env: COOKIE_SECURE)
  SameSite  prod: None   · local dev: Lax        (env: COOKIE_SAMESITE)
Rationale: in production the UI (Vercel) and API (Render) are different origins, so the cookie
must be SameSite=None, which browsers only honour with Secure over HTTPS. Locally the frontend
proxies /api to :8000, making the request same-origin, so Lax + insecure works over plain http.
Both instances must assume this dual configuration.

--- Protected-endpoint semantics (applies to Contracts 3, 4, 5) ---
Missing / malformed / expired / wrong-typ token  -> 401 { "error": "Not authenticated." }
                                                     + header `WWW-Authenticate: Bearer`
A resource that exists but belongs to another user -> 404, NOT 403.
  ^ 403 would confirm the row exists. 404 is byte-identical to "no such id".

--- Frontend obligations (Instance 2) ---
- The access token is held IN MEMORY only (module/context variable). Never localStorage,
  never sessionStorage. Session survival across reloads comes from the refresh cookie.
- On app boot: call POST /api/auth/refresh once. 200 -> authenticated. 401 -> show login.
- On any 401 from a non-/api/auth endpoint: attempt refresh ONCE, then retry the original
  request once. If the refresh 401s, clear state and route to /login. Never loop.
- Concurrent 401s share a SINGLE in-flight refresh promise (single-flight), so N failed
  requests trigger one refresh, not N.
  [AMENDMENT 1] "Concurrent" spans TABS, not just requests. An in-tab promise is
  per JavaScript realm, so the refresh must additionally be serialised across every
  document of the origin — `navigator.locks.request()`, falling through uncontended
  where the API is unavailable (Safari < 15.4, jsdom).
- Every request to /api/auth/* is sent with `credentials: "include"`.

--- Backend obligations (Instance 1) ---
- CORS: `allow_credentials=True` with the EXACT frontend origin from `FRONTEND_ORIGIN`.
  A wildcard origin is invalid alongside credentials and will silently break the cookie.
```

### Contract 2: Category vocabulary
- **Producer:** Instance 1
- **Consumer(s):** Instance 2
- **Shape / format:**

```
GET /api/categories              (public, static, cacheable)
  200  { "categories": [ { "key": string, "label": string, "color": "#RRGGBB" }, ... ] }

The list is FROZEN, in this order, with these exact keys, labels and colors. Instance 2 may
hardcode this list as a build-time fallback; if it does, the two copies must be identical.

  [ { "key": "food",          "label": "Food",          "color": "#E8734A" },
    { "key": "transport",     "label": "Transport",     "color": "#4A8FE8" },
    { "key": "housing",       "label": "Housing",       "color": "#7C5CE0" },
    { "key": "utilities",     "label": "Utilities",     "color": "#2FA3A3" },
    { "key": "health",        "label": "Health",        "color": "#E05C7B" },
    { "key": "entertainment", "label": "Entertainment", "color": "#C77DE8" },
    { "key": "shopping",      "label": "Shopping",      "color": "#E8A93A" },
    { "key": "education",     "label": "Education",     "color": "#3F8F5B" },
    { "key": "savings",       "label": "Savings",       "color": "#5B7FA6" },
    { "key": "other",         "label": "Other",         "color": "#8A8F98" } ]

`key` is the value used in the `category` field of every expense and budget.
An unrecognized key on a write -> 422 { "error": "Unknown category 'foo'." }
Colors are the authoritative chart palette: the pie chart and the bar chart MUST use them,
so a category is the same color everywhere in the UI.
```

### Contract 3: Expenses (CRUD)
- **Producer:** Instance 1
- **Consumer(s):** Instance 2
- **Shape / format:**

```
--- The Expense object (returned everywhere an expense appears) ---
  { "id": int,
    "amount_minor": int,          // > 0, minor units
    "category": string,           // a key from Contract 2
    "date": "2026-09-04",         // calendar date
    "note": string | null,        // <= 500 chars
    "created_at": "2026-09-04T10:00:00Z",
    "updated_at": "2026-09-04T10:00:00Z" }

GET /api/expenses                (protected)
  query   month=YYYY-MM   optional, filters to that calendar month
          category=<key>  optional
          limit=int       optional, 1..200, default 50
          offset=int      optional, >= 0, default 0
  200     { "expenses": [Expense, ...],
            "total": int,        // total matching rows, ignoring limit/offset
            "limit": int,
            "offset": int }
  Ordering: date DESC, then id DESC. Stable and mandatory.
  An empty result is `{ "expenses": [], "total": 0, ... }` — never 404.
  400     { "error": "Invalid month format. Expected YYYY-MM." }

POST /api/expenses               (protected)
  request { "amount_minor": int, "category": string, "date": "YYYY-MM-DD",
            "note": string | null }     // note optional, defaults to null
  201     Expense
  422     { "error": "amount_minor must be greater than 0." }

PATCH /api/expenses/{id}         (protected)
  request any subset of { amount_minor, category, date, note }
  200     Expense (with a refreshed updated_at)
  404     { "error": "Expense not found." }      // also when owned by another user
  422     validation, same shapes as POST

DELETE /api/expenses/{id}        (protected)
  204     no body
  404     { "error": "Expense not found." }      // also when owned by another user

--- Validation rules ---
  amount_minor   integer, 1 .. 1_000_000_000_000
  category       must be a Contract 2 key
  date           a valid calendar date; past and future dates are both allowed  [ASSUMED]
  note           null, or a string of <= 500 chars; empty string is stored as null
```

### Contract 4: Budgets
- **Producer:** Instance 1
- **Consumer(s):** Instance 2
- **Shape / format:**

```
A budget is a spending limit for one (user, category, month) triple. Budgets do NOT carry
forward between months — each month is set explicitly.  [ASSUMED]

GET /api/budgets                 (protected)
  query   month=YYYY-MM   REQUIRED
  200     { "month": "2026-09",
            "budgets": [ { "category": string, "limit_minor": int }, ... ] }
  Only categories with a budget set for that month appear. Ordered by the Contract 2
  category order (not alphabetically), so the settings UI is stable.
  No budgets set -> { "month": "2026-09", "budgets": [] }

PUT /api/budgets                 (protected)  — upsert
  request { "month": "YYYY-MM", "category": string, "limit_minor": int }
  200     { "month": string, "category": string, "limit_minor": int }
  limit_minor must be >= 1. To remove a budget, use DELETE — do not PUT 0.
  422     { "error": "limit_minor must be greater than 0." }

DELETE /api/budgets/{month}/{category}     (protected)
  204     no body
  404     { "error": "No budget set for that category and month." }
```

### Contract 5: Analytics — the three charts
- **Producer:** Instance 1
- **Consumer(s):** Instance 2
- **Shape / format:**

```
All three endpoints are protected and scoped to the authenticated user. All aggregation
happens in SQL on the backend. The frontend performs NO summing, NO bucketing, NO zero-filling
and NO percentage math — it renders what it is given. (This is the decoupling decision that
made Snipp's merge clean; it is repeated here deliberately.)

--- 5a. Headline numbers (drives the summary row + the gauge's total) ---
GET /api/analytics/summary       query month=YYYY-MM  REQUIRED
  200 { "month": "2026-09",
        "currency": "NGN",
        "total_spent_minor": int,
        "total_budget_minor": int,     // sum of budgets set for that month; 0 if none
        "remaining_minor": int,        // total_budget_minor - total_spent_minor; MAY BE NEGATIVE
        "percent_used": number,        // one decimal, e.g. 73.4; 0 when total_budget_minor == 0
        "expense_count": int }

--- 5b. Category breakdown (drives the PIE CHART and the per-category GAUGES) ---
GET /api/analytics/by-category   query month=YYYY-MM  REQUIRED
  200 { "month": "2026-09",
        "currency": "NGN",
        "total_spent_minor": int,
        "categories": [
          { "category": "food",
            "label": "Food",              // denormalized from Contract 2 — frontend need not join
            "color": "#E8734A",           // denormalized from Contract 2
            "spent_minor": int,
            "percent": number,            // share of total_spent_minor, one decimal; 0 if total is 0
            "limit_minor": int | null,    // null when no budget is set for this category/month
            "remaining_minor": int | null,// limit_minor - spent_minor; null when no budget; MAY BE NEGATIVE
            "percent_used": number | null,// one decimal; null when no budget
            "over_budget": boolean },     // false when no budget
          ... ] }

  INCLUSION RULE (agreed up front, both sides depend on it):
    - a category with spent_minor > 0        -> INCLUDED (the pie needs it)
    - a category with a budget set           -> INCLUDED even if spent_minor == 0
                                                (the gauge must show an untouched budget)
    - a category with neither                -> OMITTED entirely
  ORDERING: spent_minor DESC, then the Contract 2 category order as the tie-break.

--- 5c. Month-over-month (drives the BAR CHART) ---
GET /api/analytics/monthly       query months=int  optional, 1..24, default 6
  200 { "currency": "NGN",
        "months": [ { "month": "2026-04",
                      "total_spent_minor": int,
                      "total_budget_minor": int }, ... ] }

  ZERO-FILLED CONTIGUOUS MONTHS, oldest -> newest, the last element being the CURRENT month
  (server UTC). A month with no expenses appears with total_spent_minor = 0 — it is never
  skipped. `months=6` therefore always returns exactly 6 elements, even for a brand-new account.
  The bar chart can render the array directly with no gap handling.

--- Empty-state guarantee ---
A brand-new user with zero expenses and zero budgets gets 200 from all three endpoints with
zeroed totals and (for 5b) an empty `categories` array. Never 404, never null at the top level.
Instance 2 must render a designed empty state for each chart rather than crashing on [].
```

### Contract 6: Errors, status codes and CORS
- **Producer:** Instance 1
- **Consumer(s):** Instance 2
- **Shape / format:**

```
EVERY non-2xx response from EVERY endpoint has exactly this body:
  { "error": "<a human-readable sentence, capitalized, ending in a period>" }

FastAPI's defaults do NOT match this — `HTTPException` emits {"detail": ...} and validation
failures emit a nested list. Instance 1 MUST install exception handlers for HTTPException,
StarletteHTTPException and RequestValidationError that normalize all three into { "error": ... }.
Validation errors render the FIRST failing field as a sentence, e.g.
  "amount_minor must be greater than 0."   /   "Password must be at least 8 characters."

Status codes:
  200  successful read, update, PUT-upsert, login, refresh
  201  resource created (signup, POST /api/expenses)
  204  successful delete, logout
  400  malformed query parameter (bad month format, out-of-range limit)
  401  not authenticated, expired/invalid/wrong-typ token, bad credentials, dead refresh cookie
  404  unknown resource id — AND any resource belonging to another user
  409  signup with an email that already exists
  422  request body failed validation
  500  unexpected — body is { "error": "Something went wrong." }, details only in server logs

Never leak a stack trace, a SQL string, or an internal exception message to the client.

CORS (backend):
  allow_origins      = [FRONTEND_ORIGIN]     exact string, no wildcard, no trailing slash
  allow_credentials  = True
  allow_methods      = ["GET","POST","PATCH","PUT","DELETE","OPTIONS"]
  allow_headers      = ["Authorization","Content-Type"]
  NOTE FROM SNIPP: the deployed Vercel origin is often NOT the bare project name (Snipp's was
  `snipp-kappa.vercel.app`). The mismatch presents as a misleading "can't reach the API" error.
  Confirm the real origin at deploy time.
```

---

## ESCALATIONS & PROPOSED AMENDMENTS
<!-- Instances write structured requests + *proposed* amendments here. Never edit the
     frozen block or another instance's section directly. Human resolves. -->

No escalations were raised during the build — both instances finished with this
section empty. The entry below was raised by the Reconciler *after* merge.

### AMENDMENT 1 — Contract 1 · refresh replay · RATIFIED 2026-09-05
**Raised by:** Reconciler (post-merge integration) · **Ratified by:** human

**Finding.** Every contract passed on both real sides, and the merged system still
signed users out. Instance 1 implemented refresh rotation with theft detection —
replaying a rotated cookie revokes the whole family and bumps `token_version`
(`routers/auth.py`). Instance 2 implemented single-flight refresh correctly
(`api/client.ts`) — but the in-flight promise is a module variable, so it is
single-flight per JavaScript realm, i.e. **per tab**. Two tabs share one cookie jar
and not one promise.

**Reproduced live** against the real API + real Postgres:
```
tab A refresh (cookie C1) ......... 200, new access token
tab B refresh (same cookie C1) .... 401   ← read as theft, family revoked
tab A's brand-new access token .... 401   ← tab A signed out too
```
Because `tv` is asserted on access tokens as well, the lockout is immediate and
spans every device.

**Why the freeze did not catch it.** Neither side diverged from the contract — the
contract was underspecified. It said "concurrent 401s" without contemplating more
than one document, and never mentioned theft detection at all (Instance 1 added it
as a defensible improvement *beyond* the contract, and flagged the dependency in its
work log). Instance 2's stub models the cookie as a single mutable slot with no
`revoked_at` and no replay concept, so it **structurally cannot represent this
failure** — which is why 114 green frontend tests sat on top of it.

**Resolution — both halves applied:**
- *Backend:* a replay grace window (`refresh_replay_grace_seconds`, default 10s),
  gated on the family still being alive. Contract text amended above.
- *Frontend:* `navigator.locks` around `refreshSession()`, serialising refreshes
  across tabs. Not itself a contract change — it strengthens how the existing
  single-flight obligation is met — but the obligation's wording was clarified.

Deliberately belt-and-braces: the lock closes the race in browsers that have the
API, and the grace window covers those that do not, plus any future client (a mobile
app, a script) that never implements single-flight at all.

---

## INSTANCE 1 — Backend API & Auth  ·  STATUS: DONE

**Owns:** `backend/` in full — `app/` (models, schemas, routers, auth, crud, analytics, errors,
config, database), `tests/`, `db/init.sql`, `requirements.txt`, `pytest.ini`, `Dockerfile`,
`docker-compose.yml`, `.python-version`, `backend/.env.example`, `backend/README.md`.

**Does NOT touch:** `frontend/` (anything at all), the root `README.md`, `BUILT-WITH-SWARM.md`,
`DEPLOY.md`, the INTERFACE CONTRACTS block, or Instance 2's section of this file.

**Assigned skills:** `fastapi-expert`, `postgres-pro`, `api-designer`, `security-reviewer`, `test-master`

**Role prompt:**

You are **Instance 1**, owner of the LedgerLite backend. You build a FastAPI + Postgres API that
serves a single-user-scoped expense tracker, and you own the entire authentication layer.

You **produce all six contracts** (1 Authentication, 2 Categories, 3 Expenses, 4 Budgets,
5 Analytics, 6 Errors/CORS). Instance 2 is building its whole UI against a mock of your output
right now, without ever seeing your code — so the contract text is the specification, not a
sketch. If you believe a contract is wrong, do not "improve" it silently: write a proposed
amendment in ESCALATIONS and wait for the human.

**The security requirements are the point of this project. They are not optional:**

- **Hashing:** argon2 via passlib (`argon2-cffi`). Never bcrypt-with-a-truncated-input, never a
  hand-rolled scheme. Passwords are never logged, never returned, and never stored in any form
  but the hash.
- **No user enumeration.** `/api/auth/login` returns the identical 401 body for an unknown email
  and a wrong password — and takes comparable time in both cases. Perform a dummy hash
  verification when the email is unknown so timing does not distinguish them.
- **`typ` claim discipline.** Access and refresh JWTs carry `typ: "access"` / `typ: "refresh"`.
  Verify it on every path. A refresh token presented as a Bearer credential must be rejected.
- **Refresh rotation.** Every `/api/auth/refresh` issues a new refresh cookie and retires the
  previous one. `/api/auth/logout` invalidates outstanding refresh tokens for that user
  (a `token_version` integer on the user row, bumped on logout, and asserted as a claim, is a
  clean way to do this — the contract only constrains the endpoint behaviour, the mechanism is yours).
- **Scoping is absolute.** Every SELECT, UPDATE and DELETE on expenses, budgets and analytics
  carries a `user_id = current_user.id` predicate. The client never sends a user id and you never
  read one from the request body, a query param, or a path segment. A route that forgets the
  predicate is the single worst bug this project can ship — write the tests that would catch it.
- **Cross-user access returns 404, not 403** (Contract 1). Do not special-case this in each route;
  make the ownership-checked fetch helper return the same "not found" path for both.
- **`SECRET_KEY` comes from the environment** and is absent from git. Ship `.env.example` with a
  placeholder and a note on generating one. The app should refuse to boot in production with a
  default/empty secret.
- **Cookie flags are environment-driven** (`COOKIE_SECURE`, `COOKIE_SAMESITE`) exactly as Contract 1
  describes, so local dev (Lax, insecure, same-origin via the frontend proxy) and production
  (None, Secure, cross-origin) both work from one codebase.

**Data model** (yours to finalize; these constraints are required):

- `users` — id PK, email (**unique on `lower(email)`**; store and compare case-insensitively),
  password_hash, token_version, created_at.
- `expenses` — id PK, user_id FK→users **ON DELETE CASCADE**, amount_minor **BIGINT**, category,
  date **DATE**, note, created_at, updated_at. Index on `(user_id, date DESC)` and `(user_id, category)`.
- `budgets` — id PK, user_id FK→users ON DELETE CASCADE, category, month, limit_minor BIGINT.
  **UNIQUE (user_id, category, month)** — this is what makes `PUT /api/budgets` a real upsert.

**Aggregation:** Contract 5's three endpoints are computed **in SQL** — `GROUP BY` and `SUM`, not
Python loops over fetched rows. The zero-filled contiguous month series (5c) and the inclusion
rule for categories (5b) are the fiddly parts; they are also exactly what Instance 2 is trusting
you for, so test them directly.

**Tests** (pytest + httpx against the real ASGI app over in-memory SQLite, as Snipp did) must include:
- **User isolation:** user A cannot read, list, update or delete user B's expense or budget — all
  four attempts return 404, and B's row is unchanged afterwards. Analytics for A never include B's rows.
- **Token confusion:** a refresh token used as a Bearer access token is rejected 401.
- **Expiry:** an expired access token is rejected 401; the refresh flow then issues a working one.
- **Rotation:** a refresh cookie that has already been rotated no longer works.
- **No enumeration:** login with an unknown email and login with a wrong password return
  byte-identical bodies and status codes.
- **Aggregation:** the zero-filled month series has exactly `months` elements for a new account;
  5b's inclusion rule (zero-spend-with-budget included, neither-excluded); percentages when the
  total is 0; negative `remaining_minor` when over budget.
- **Error envelope:** a validation failure, a 404 and a 401 each return `{ "error": ... }` and no
  `detail` key.

**Deployment carry-overs from Snipp — apply these from the start, they each cost a redeploy last time:**
- Pin **Python 3.12.8** in `backend/.python-version` and the `Dockerfile`. Render otherwise defaults
  to a Python with no prebuilt `pydantic-core` wheel and the source build fails on a read-only FS.
- **Normalize hosted Postgres URLs** in `database.py`: force the `+asyncpg` driver, enable SSL, and
  strip libpq-only query args (`sslmode`, `channel_binding`) that asyncpg rejects. Local and SQLite
  URLs must pass through untouched. Snipp's `database.py` is a working reference.
- Check the local interpreter version before choosing typing syntax. Snipp stayed
  `typing.Optional`-compatible (Python 3.9) so the suite ran locally while the container pinned 3.12.
  Mirror whatever the local `python --version` reports.

**Also yours:** `docker-compose.yml` (Postgres + api, healthcheck, env), `db/init.sql`, the CORS
configuration, and a `backend/README.md` covering local run + test commands.

Follow the `swarm-worker` runtime protocol for all shared-file, escalation, and git rules.

**Work log:**

### 2026-09-04 — Instance 1 — backend complete, STATUS: DONE
Branch `instance/backend`, three commits (`727d135`, `0b65ddc`, `44f6437`).
**221 tests, all passing** (`cd backend && pytest`), run against the real ASGI app
over in-memory SQLite.

**Built** — `backend/app/`: `config` (env settings + production boot guards),
`database` (async engine + hosted-Postgres URL normalization), `models`
(users/expenses/budgets/refresh_tokens), `security` (argon2 + JWT), `deps`
(`get_current_user`, query-param validation), `crud` (all data access), `analytics`
(Contract 5 SQL), `categories`, `errors`, `months`, and five routers. Plus
`tests/` (11 files), `db/init.sql`, `Dockerfile`, `docker-compose.yml`,
`.env.example`, `pytest.ini`, `.python-version`, `backend/README.md`.

**All six contracts produced as frozen.** No amendments proposed; nothing in the
contract text turned out to be wrong or ambiguous in implementation.

**Contract surfaces a merger should double-check:**
1. **`POST /api/auth/refresh` is single-use.** Rotation is backed by a
   `refresh_tokens` row per issued token, and replaying an already-rotated cookie
   is treated as **theft**: the whole token family is revoked and `token_version`
   bumped, which signs that user out everywhere. This is deliberate, and it
   *depends* on Instance 2's single-flight refresh (Contract 1, frontend
   obligations). If three concurrent 401s each fire their own refresh, two will
   look like replays and log the user out. **This is the highest-value thing to
   verify at merge** — it is the sharp edge of the ★ cookie round-trip check.
2. **Logout kills access tokens too, not just refresh tokens.** `token_version` is
   asserted as the `tv` claim on both token types. Stricter than Contract 1
   requires, and compatible with it, but worth knowing: after logout an
   already-issued access token 401s immediately rather than living out its 15 min.
3. **`GET /api/health`** exists and is not in any contract — a platform
   health-check target for Render/compose, excluded from the OpenAPI schema.
   Additive only.
4. **Query vs body error codes.** A malformed *query* param is 400, a bad *body*
   is 422, per Contract 6. Both use the `{"error": ...}` envelope, so Instance 2's
   error handling should not branch on status code to find the message.
5. **Timestamps are second-precision** ISO-8601 UTC with a trailing `Z` — no
   microseconds, on the wire or in the database.

**Verified beyond the unit tests:** a live uvicorn + curl round-trip confirmed the
real `Set-Cookie` carries `HttpOnly; Max-Age=2592000; Path=/api/auth; SameSite=lax`,
that CORS echoes the exact origin with `allow-credentials: true`, and that
cookie-only refresh (no body, no `Authorization` header) returns 200 and rotates.

**Decisions taken as ASSUMED** (all low-stakes, none contradicting a contract):
- Unknown category on a *query filter* → **400** `Unknown category 'foo'.`
  (Contract 2 only specifies 422 for a *write*; Contract 6 makes a bad query param
  a 400.)
- `DELETE /api/budgets/{month}/{category}` with a malformed month or unknown
  category → **404** with the contract's `No budget set for that category and month.`
  rather than inventing a status the contract does not list for that endpoint.
- An empty `?month=` on `GET /api/expenses` is treated as absent, not malformed.
- `FRONTEND_ORIGIN` accepts a comma-separated list (each entry still an exact
  origin, never a wildcard) so a Vercel preview origin can be added without a code
  change.
- Password capped at 128 chars; `note` stripped before the 500-char check.

**Not verified locally — for the Reconciler:**
- **The suite has never run against real Postgres.** Docker was unavailable in this
  worktree. `tests/test_postgres_compat.py` compiles the models and the
  month-bucketing SQL against the Postgres dialect (catching type, index and
  `to_char` mistakes at compile time), but `docker compose up` + a live run is
  still worth doing once at merge. The only genuinely Postgres-specific runtime
  branch is `to_char(date, 'YYYY-MM')` in `analytics.monthly`.
- The browser half of the ★ cookie check (a real `Set-Cookie` accepted by a real
  browser across the Vercel→Render origin pair) remains as planned.

---

## INSTANCE 2 — Frontend Dashboard  ·  STATUS: DONE

**Owns:** `frontend/` in full — `src/` (pages, components, charts, api client, mock layer, auth
context, hooks, formatting helpers), `index.html`, `package.json`, `vite.config.ts`, `tsconfig*.json`,
`frontend/.env.example`, `vercel.json`, `frontend/README.md`.

**Does NOT touch:** `backend/` (anything at all), the root `README.md`, `BUILT-WITH-SWARM.md`,
`DEPLOY.md`, the INTERFACE CONTRACTS block, or Instance 1's section of this file.

**Assigned skills:** `react-expert`, `typescript-pro`, `ui-ux-pro-max`, `frontend-design`, `test-master`

**Role prompt:**

You are **Instance 2**, owner of the LedgerLite frontend. You build the entire React/Vite/TypeScript
UI: signup, login, the expense list with add/edit/delete, the per-category budget settings, and the
three visualizations.

You **consume Contracts 1–6** and produce none. You will never see Instance 1's code. Build the whole
app against a **mock layer** (`src/api/mocks.ts`) that implements the contracts verbatim, toggled by
`VITE_USE_MOCKS`, and write tests asserting your stub conforms to the frozen contract shapes — that
conformance suite is what made Snipp's merge land byte-for-byte, so repeat it here.

**Auth is the new surface, and the token handling is the graded part:**

- **The access token lives in memory only** — a module variable or React context. Never localStorage,
  never sessionStorage, never a non-httpOnly cookie. Session survival across a page reload comes from
  the httpOnly refresh cookie, which your JavaScript cannot read and must not try to.
- **On app boot**, call `POST /api/auth/refresh` once. 200 → hydrate the session and render the app.
  401 → render the login screen. Show a loading state while this is in flight; do not flash the
  login page at an already-authenticated user.
- **Refresh-on-401 with single-flight.** A 401 from any non-`/api/auth` endpoint triggers one refresh
  attempt, then one retry of the original request. Concurrent 401s must share a single in-flight
  refresh promise — the dashboard fires three analytics calls at once, and three parallel refreshes
  would rotate the cookie out from under each other. A failed refresh clears state and routes to
  `/login`. Never retry more than once; never loop.
- **`credentials: "include"`** on every `/api/auth/*` request, or the cookie is neither sent nor stored.
- **Protected routes** redirect unauthenticated users to `/login` while preserving the intended
  destination, so a deep link survives the round trip.
- **Never render a raw error object.** Read `body.error` (Contract 6) and show that sentence.

**The three charts (Recharts), all rendered from server-computed data:**

- **Category pie** ← Contract 5b. Use the `color` field the server sends; do not invent a palette.
  A category is the same color in the pie, the legend and the budget list.
- **Month-over-month bar** ← Contract 5c. The array is already zero-filled and contiguous — render it
  directly. Do not add client-side gap filling; if a month looks missing, that is a contract bug to
  escalate, not to patch around.
- **Budget-remaining gauge** ← Contract 5a for the headline and 5b for the per-category breakdown
  (`RadialBarChart` works well). **`remaining_minor` can be negative** and `percent_used` can exceed
  100 — design the over-budget state deliberately rather than clamping it away.
- **Empty states are a real requirement.** A new account returns zeroed totals and an empty
  `categories` array from every analytics endpoint. Each chart needs a designed empty state; none may
  crash on `[]` or divide by a zero total.

**Money:** one `formatMoney(minor: number): string` helper, used everywhere. All arithmetic stays in
integer minor units; never do math on a formatted string, never introduce a float.

**Also yours:** the Vite dev proxy (`/api` → `http://localhost:8000`) — this makes local development
same-origin, which is what lets the `SameSite=Lax` dev cookie work at all, so it is load-bearing, not
convenience. Plus `vercel.json` with the SPA rewrite (Snipp needed it) and `.env.example` documenting
`VITE_API_BASE_URL` and `VITE_USE_MOCKS`.

**Design:** this is a portfolio piece. Aim for a considered, distinctive interface — coherent
type scale, real spacing rhythm, accessible contrast in both light and dark, and charts that read
cleanly at small sizes. Lean on `ui-ux-pro-max` and `frontend-design` rather than shipping default
component styling.

Follow the `swarm-worker` runtime protocol for all shared-file, escalation, and git rules.

**Work log:**
2026-09-04 — Instance 2 — Frontend complete.

**Built.** Full React 19 + Vite + TypeScript app in `frontend/`. Signup, login, the expense
ledger with add/edit/delete, per-category budget settings, and the three visualizations.
41 source files, strict TS (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) clean,
114 tests green, production build clean.

**Where things live.** `src/api/` — contract types, client, endpoints, the frozen Contract 2
list, the mock backend. `src/auth/` — session state machine, provider, route guards.
`src/charts/` — the three visualizations. `src/pages/`, `src/components/`, `src/features/`,
`src/hooks/`, `src/lib/`, `src/styles/`, `src/test/`.

**Mock layer.** `src/api/mocks.ts` is a `fetch`-shaped implementation of Contracts 1–6, swapped
in as the client's transport by `VITE_USE_MOCKS=true`. The client above it is unchanged in
mocked and real mode, so the refresh dance, credential handling and error parsing are the
same code path either way. Seeded demo account: `demo@ledgerlite.app` / `demo1234`.

**Conformance suite.** `src/test/contract-conformance.test.ts` (61 tests) asserts the mock
against the contract *text* — status codes, field names, error sentences, orderings, inclusion
rules. It is a ready-made checklist for the Reconciler: point it at Instance 1's real API and
every expectation is a question already asked. Notable coverage: no-enumeration byte-identity,
404-not-403 cross-user access on expenses and budgets with the victim's row verified intact,
5b's inclusion rule and its spent-DESC-then-Contract-2-order tie-break, 5c's zero-filled
contiguous series including a gap month, `percent_used` 0 when no budget, negative
`remaining_minor`, and `{ "error": ... }` with no `detail` key on every failure path.

**Auth plumbing.** `src/test/client-refresh.test.ts` (14 tests) covers the graded part: one
refresh + one retry, never a loop; four concurrent 401s share ONE in-flight refresh promise
(asserted as exactly 9 transport calls for 4 requests); a failed refresh clears the token and
notifies; `credentials: "include"` on `/api/auth/*` and `same-origin` elsewhere; a 401 from
`/api/auth/*` never auto-refreshes. Access token is in a module variable only — never storage.

**Contract observations for the merger** (no amendments proposed; nothing was ambiguous enough
to need one):
- Contract 1 requires `WWW-Authenticate: Bearer` on protected 401s. Easy to omit server-side;
  the mock sets it and the conformance suite asserts it.
- `POST /api/auth/refresh` returns no `user`, so boot is refresh → `GET /api/auth/me`. Confirm
  Instance 1 serves `/api/auth/me` with the Bearer token from a just-refreshed session.
- Contract 6 does not fix the sentence for an out-of-range `limit` or `months`, or for an
  invalid `date`/`note`. The mock invents readable sentences; only the *shape* is asserted, so
  Instance 1's wording will not fail the suite.
- `GET /api/categories` is fetched at runtime and compared against the compiled-in frozen copy;
  a mismatch logs a console warning naming both. Contract-drift canary, deliberately loud.

**ASSUMED (unchanged from the contract, flagged for the record):** current month is derived in
UTC to match 5c's definition, while the expense-form date default is the user's local today;
`limit=25` is used for the expenses page (contract allows 1..200, default 50).

**Check-at-merge, as planned:** the real `Set-Cookie` refresh round-trip. A mock cannot set or
read an httpOnly cookie, so rotation is modelled with a module variable. Boot-refresh,
refresh-on-401, single-flight and rotation-after-logout are all tested against that model;
the genuine cookie behaviour remains item ★4 for the Reconciler.

**Environment notes.** (1) Vitest's default `forks` pool cannot start a worker under this
OneDrive-synced path (times out waiting for the child); `pool: 'threads'` is pinned in
`vite.config.ts` with the reason recorded there. (2) The dashboard is a lazily-imported chunk
pulling in Recharts, so `testTimeout` is raised to 20s — the code is split for the sake of the
bundle, not un-split for the sake of the runner. (3) Two boot-sequence tests asserted a
transient state (the boot screen) and were intermittently racing the mock's own resolution —
roughly 2 failures in 10 runs. Fixed by holding mock responses for a tick in those two tests so
the window is real; 8 consecutive full-suite runs clean afterwards.

**Not touched:** `backend/`, root `README.md`, `BUILT-WITH-SWARM.md`, `DEPLOY.md`, the
INTERFACE CONTRACTS block, Instance 1's section.

---

## MERGE-TIME ARTIFACTS & CHECKS (human / Reconciler — not assigned to any instance)

Deferred here deliberately (rule b): small, spanning both halves, and best written once both
sides are real.

1. **`BUILT-WITH-SWARM.md`** — the portfolio narrative: this coordination file, the frozen
   contracts, and the reconciliation report. Snipp's is the template.
2. **`DEPLOY.md`** — the Vercel → Render → Neon runbook, extended with the two new auth-specific
   steps: `SECRET_KEY` generation/config, and `COOKIE_SECURE=true` + `COOKIE_SAMESITE=None` in the
   Render environment.
3. **Root `README.md`** — update from the placeholder once the app exists.
4. **★ The cookie round-trip check** — the one boundary a mock cannot prove. After merge, against
   the real backend: sign up → confirm `Set-Cookie: refresh_token` arrives with `HttpOnly` and the
   right `SameSite`/`Secure` for the environment → reload the page → confirm the app silently
   re-authenticates via `POST /api/auth/refresh` → let the access token expire (or force a 401) →
   confirm exactly one refresh fires and the original request is retried successfully.
5. **★ The user-isolation check, end to end** — create two real accounts through the real UI, log an
   expense on each, and confirm neither account's dashboard, list or charts show any trace of the
   other. Instance 1 tests this at the API level; verify it once through the whole stack.
