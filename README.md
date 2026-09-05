# LedgerLite

### ▶ [ledger-lite-amber.vercel.app](https://ledger-lite-amber.vercel.app/)

A private personal expense tracker. Log expenses, set a monthly budget per category,
and see where the money went — a category pie chart, a month-over-month bar chart, and
a budget-remaining gauge. Email/password accounts, so every row belongs to exactly one
user and is invisible to everyone else.

> Sign up with any email — no confirmation step, and the data is yours alone.
> Hosted on free tiers, so the **first request after an idle spell takes 30–60s**
> while the server and database wake. After that it's quick.

Project 2 of 10 in an AI-accelerated full-stack ladder, and the second build of the
**Swarm** multi-agent workflow — two agents working in parallel worktrees against six
contracts frozen before either wrote a line. See **[BUILT-WITH-SWARM.md](BUILT-WITH-SWARM.md)**
for how that went, including the one defect that only surfaced at integration.

---

## What it does

- **Log expenses** — amount, category, date, optional note; edit and delete.
- **Budget per category, per month** — set a limit, watch it burn down.
- **Three visualizations** — where the money goes (pie), how this month compares
  (bar, six months, zero-filled), and how much is left (gauge, with a real
  over-budget state rather than a clamped one).
- **Private by construction** — every query is scoped to the signed-in user, and
  another user's row is indistinguishable from one that doesn't exist.

## Stack

| Layer | Choice |
|---|---|
| Backend | FastAPI · SQLAlchemy 2 (async) · asyncpg |
| Database | Postgres (Neon in production) |
| Auth | argon2 hashing · HS256 access JWT · rotating httpOnly refresh cookie |
| Frontend | React 19 · Vite · TypeScript · react-router · Recharts |
| Tests | pytest + httpx · Vitest + Testing Library |
| Deploy | Vercel (UI) → Render (API) → Neon (Postgres) |

## Running it locally

```bash
# 1. Backend + Postgres
cd backend
cp .env.example .env          # then set a real SECRET_KEY
docker compose up --build     # API on :8000, Postgres on :5432

# 2. Frontend
cd frontend
cp .env.example .env.local    # leave VITE_API_BASE_URL empty for local
npm install && npm run dev    # UI on :5173, /api proxied to :8000
```

The Vite proxy is load-bearing, not a convenience: routing `/api` through the frontend
origin makes auth requests same-origin, which is the only reason the `SameSite=Lax`
development refresh cookie is sent at all.

**No backend at all?** Set `VITE_USE_MOCKS=true` and run only the frontend — the whole
app is served by an in-browser mock backend implementing all six contracts, seeded with
a demo account (`demo@ledgerlite.app` / `demo1234`).

### Tests

```bash
cd backend  && pytest      # 222 tests
cd frontend && npm test    # 117 tests
```

## Authentication, in one paragraph

Passwords are hashed with argon2 and never logged, returned, or stored in any other
form. Sign-in returns a short-lived (15 min) access JWT in the response body, sent
thereafter as `Authorization: Bearer`, plus a 30-day refresh token in an **httpOnly**
cookie scoped to `/api/auth` — so the token that can mint new sessions is unreachable
from JavaScript. The access token is held **in memory only**, never in `localStorage`;
a page reload survives by exchanging the cookie for a new access token at boot. Every
refresh rotates the cookie, and a replayed one is treated as theft unless it arrives
inside a short grace window while the token family is still live — a concession to the
fact that two browser tabs share a cookie jar but not a promise. Login returns an
identical response for an unknown email and a wrong password, in comparable time, so
the endpoint can't be used to enumerate accounts.

## Layout

```
backend/          FastAPI service — owned by Instance 1
  app/            models · schemas · security · deps · crud · analytics · routers
  tests/          222 tests, incl. user-isolation and token-confusion coverage
  db/init.sql     local schema (hosted DBs provision via create_all)
frontend/         React app — owned by Instance 2
  src/api/        contract types, client, and the mock backend
  src/auth/       session state machine, provider, route guards
  src/charts/     the three visualizations
CLAUDE.md         the coordination file: frozen contracts, work logs, Amendment 1
BUILT-WITH-SWARM.md   how the two-agent build actually went
DEPLOY.md         Vercel → Render → Neon runbook
```

## Documentation

- **[BUILT-WITH-SWARM.md](BUILT-WITH-SWARM.md)** — the multi-agent build: the frozen
  contracts, the reconciliation report, and the cross-tab refresh race that neither
  agent could see alone.
- **[DEPLOY.md](DEPLOY.md)** — deploying free and public, including the three cookie
  settings that must agree or sign-in silently fails to persist.
- **[CLAUDE.md](CLAUDE.md)** — the coordination file, kept as the build record.
