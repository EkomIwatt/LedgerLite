# Deploying LedgerLite (free, permanent, public)

A portfolio-ready deploy on free tiers — the same three-layer split as Snipp, plus
the parts an authenticated app needs that a stateless one doesn't.

```
  Browser ──> <app>.vercel.app           React/Vite app   (Vercel, free)
                  │
                  │  fetch /api/*   cross-origin → CORS + credentials
                  │  Authorization: Bearer <access token>   (in memory)
                  │  Cookie: refresh_token                  (httpOnly, /api/auth only)
                  ▼
            <api>.onrender.com            FastAPI service  (Render, free)
                  │
                  ▼
            Neon Postgres                 managed database (Neon,   free)
```

> **Cold starts:** Render's free web service sleeps after ~15 min idle. The first
> request after a nap takes ~30–60s to wake. On LedgerLite that shows up as a slow
> first sign-in, because the boot refresh is the very first call the app makes.

Pick both names up front so CORS and the cookie agree from the start. This guide uses:

- Render service `ledgerlite-api` → `https://ledgerlite-api.onrender.com`
- Vercel project `ledgerlite` → `https://ledgerlite.vercel.app`

Substitute your own and keep them consistent everywhere below.

---

## What's different from Snipp — read this first

Snipp had no auth, so its only cross-origin concern was CORS. LedgerLite adds a
refresh cookie that must survive a **cross-origin** hop, and that pulls in three
settings that must be right *together* or sign-in silently fails to persist:

| Setting | Local | Production | Why |
|---|---|---|---|
| `COOKIE_SECURE` | `false` | **`true`** | `SameSite=None` is only honoured over HTTPS |
| `COOKIE_SAMESITE` | `lax` | **`none`** | Vercel and Render are different origins |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | exact Vercel URL | a wildcard is invalid with credentials |

Locally the Vite proxy makes everything same-origin, so `Lax` + insecure works over
plain http. In production nothing proxies, so the cookie is genuinely cross-site.
**The app refuses to boot in production with `SameSite=None` and `Secure=false`** —
that guard exists because the failure is otherwise silent and looks like "sign-in
just doesn't stick."

---

## Phase 1 — Neon (managed Postgres)

1. Sign up at <https://neon.tech> (no card) and create a project.
2. Copy the **connection string**:
   ```
   postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require&channel_binding=require
   ```
   Paste it verbatim. `backend/app/database.py` normalizes it for the async driver —
   forces `+asyncpg`, enables SSL, and strips the libpq-only query args
   (`sslmode`, `channel_binding`) that asyncpg rejects outright.

No schema step is needed. The app runs `create_all` on startup, which is idempotent,
so a fresh Neon database provisions `users` / `expenses` / `budgets` /
`refresh_tokens` on first boot. (`backend/db/init.sql` exists for local
docker-compose; a hosted database never sees it. Both paths are verified.)

## Phase 2 — Render (FastAPI backend)

1. <https://dashboard.render.com> → **New** → **Web Service** → connect this repo.
2. Settings:
   - **Root Directory:** `backend`
   - **Runtime:** Python 3 (or let Render use the Dockerfile — it honours `$PORT`)
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** Free
3. **Generate a real secret** — do not reuse the placeholder:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
4. **Environment** → add:

   | Key | Value |
   |---|---|
   | `ENVIRONMENT` | `production` |
   | `DATABASE_URL` | *(the Neon string from Phase 1)* |
   | `SECRET_KEY` | *(the generated value — never the placeholder)* |
   | `COOKIE_SECURE` | `true` |
   | `COOKIE_SAMESITE` | `none` |
   | `FRONTEND_ORIGIN` | `https://ledgerlite.vercel.app` |

   Optional, all with working defaults: `ACCESS_TOKEN_TTL_SECONDS` (900),
   `REFRESH_TOKEN_TTL_SECONDS` (2592000), `REFRESH_REPLAY_GRACE_SECONDS` (10),
   `SQL_ECHO` (false).

   `FRONTEND_ORIGIN` accepts a **comma-separated list**, so to also allow Vercel
   preview deployments:
   `https://ledgerlite.vercel.app,https://ledgerlite-git-main-<you>.vercel.app`

5. Create the service. Verify: `https://ledgerlite-api.onrender.com/api/health`
   → `{"status":"ok"}`.

> With `ENVIRONMENT=production` the app **refuses to start** if `SECRET_KEY` is
> missing, still the placeholder, or under 32 characters — and if
> `COOKIE_SAMESITE=none` is set without `COOKIE_SECURE=true`. A boot failure here is
> the guard doing its job; read the log line, fix the variable, redeploy.

## Phase 3 — Vercel (React/Vite frontend)

1. <https://vercel.com> → **Add New** → **Project** → import this repo.
2. Settings:
   - **Root Directory:** `frontend`
   - Framework preset **Vite** is auto-detected (Build `npm run build`, Output `dist`).
     `frontend/vercel.json` supplies the SPA rewrite so a deep link like
     `/expenses` doesn't 404 on refresh.
3. **Environment Variables** → add:

   | Key | Value |
   |---|---|
   | `VITE_API_BASE_URL` | `https://ledgerlite-api.onrender.com` |
   | `VITE_USE_MOCKS` | `false` |

   `VITE_USE_MOCKS=true` serves the whole app from the in-browser mock backend with
   no API at all — useful for a demo link, but it is not the real thing.

4. Deploy, then **go back and confirm the real Vercel URL.** Vercel often appends a
   suffix (Snipp's was `snipp-kappa.vercel.app`, not the bare project name). If it
   differs from what you put in Render's `FRONTEND_ORIGIN`, fix it there and
   redeploy — an env change triggers a rebuild.

## Phase 4 — Smoke test the live deployment

Order matters: each step depends on the previous one actually having worked.

1. **Sign up** with a fresh email. You should land on the dashboard.
2. **Open DevTools → Application → Cookies** on the API origin. There should be a
   `refresh_token` cookie marked **HttpOnly**, **Secure**, **SameSite=None**, with
   `Path=/api/auth`. If it's missing, CORS or the cookie flags are wrong — see
   Troubleshooting.
3. **Reload the page.** You should stay signed in. This is the boot refresh working:
   the access token lives only in memory, so surviving a reload proves the cookie
   round-trip end to end.
4. **Add an expense**, set a **budget** for that category, and confirm the pie, bar
   and gauge all render.
5. **Wait out the access token** (15 min) or force a 401, then click around. Exactly
   one refresh should fire in the Network tab, and your request should succeed.
6. **Open a second tab** and use both. You should stay signed in in both — that is
   the cross-tab refresh fix (Amendment 1) holding.
7. **Sign up a second account** in a private window and confirm it sees none of the
   first account's expenses, budgets, or charts.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in works but a reload signs you out | The refresh cookie isn't being stored | Check `COOKIE_SECURE=true` **and** `COOKIE_SAMESITE=none` on Render; both, or neither works |
| "Can't reach the API" / console CORS error | `FRONTEND_ORIGIN` ≠ the actual Vercel origin | Copy the exact live URL (no trailing slash) into Render and redeploy |
| Service won't boot, log mentions `SECRET_KEY` | Placeholder or short secret in production | Generate a real one (Phase 2 step 3) |
| Service won't boot, log mentions SameSite | `none` without `Secure` | Set `COOKIE_SECURE=true` |
| First request after idle takes ~40s | Render free-tier cold start | Expected; not a bug |
| Signed out unexpectedly with two tabs open | `REFRESH_REPLAY_GRACE_SECONDS=0` | Restore the default of `10` |
| Charts empty for a brand-new account | Correct behaviour | Add an expense; every analytics endpoint returns zeroed totals, never an error |

## Local development is unchanged

Local still uses the Vite dev proxy (no CORS, no cross-site cookie) and git-ignored
`.env` files in `backend/` and `frontend/`. Hosted config lives entirely in the
Render and Vercel dashboards.

```bash
# Backend + Postgres
cd backend && docker compose up --build      # API on :8000, Postgres on :5432

# Frontend
cd frontend && cp .env.example .env.local    # leave VITE_API_BASE_URL empty
npm install && npm run dev                   # UI on :5173, /api proxied to :8000
```

See `backend/README.md` and `frontend/README.md` for the per-side detail.
