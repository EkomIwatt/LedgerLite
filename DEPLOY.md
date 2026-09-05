# Deploying LedgerLite (free, permanent, public)

A portfolio-ready deploy on free tiers — the same three-layer split as Snipp, plus the
parts an authenticated app needs that a stateless one doesn't.

```
  Browser ──> <app>.vercel.app           React/Vite app   (Vercel, free)
                  │
                  │  fetch /api/*   cross-origin → CORS + credentials
                  │  Authorization: Bearer <access token>   (in memory, 15 min)
                  │  Cookie: refresh_token                  (httpOnly, /api/auth only)
                  ▼
            <api>.onrender.com            FastAPI service  (Render, free)
                  │  asyncpg over TLS
                  ▼
            Neon Postgres                 managed database (Neon,   free)
```

**Time:** ~30 minutes the first time. **Cost:** nothing, no card.

---

## Phase 0 — Before you start

**You need:**

- The repo on GitHub — <https://github.com/EkomIwatt/LedgerLite> ✔
- Accounts on [Neon](https://neon.tech), [Render](https://dashboard.render.com),
  [Vercel](https://vercel.com). All three sign in with GitHub; none needs a card.

**Pick both names now** so CORS and the cookie agree from the start. This guide uses:

| | Name | URL |
|---|---|---|
| Render service | `ledgerlite-api` | `https://<your-render-url>.onrender.com` |
| Vercel project | `ledgerlite` | `https://<your-vercel-url>.vercel.app` |

### ⚠ Never assume a URL — copy both from the dashboard

**Both platforms rename you when a name is already taken**, and the names in this guide
*are* taken. Real examples from this project's own deploy:

| You ask for | You actually get |
|---|---|
| `ledgerlite` (Vercel) | `ledger-lite-amber.vercel.app` |
| `snipp` (Vercel, project 1) | `snipp-kappa.vercel.app` |

Render is worse than a rename: `ledgerlite-api.onrender.com` is **an unrelated
stranger's Express service**. Point `VITE_API_BASE_URL` at a hostname you assumed rather
than copied, and your frontend talks to someone else's server. The symptom is a
confusing CORS error blaming a wildcard your app cannot even emit:

```
The value of the 'Access-Control-Allow-Origin' header in the response must not be
the wildcard '*' when the request's credentials mode is 'include'
```

That message means *the thing answering is not this app* — `config.py` refuses to boot
with a wildcard origin, so it can never produce that response. Check
`https://<host>/api/health`: `{"status":"ok"}` is yours, a 404 is not.

**So: deploy each service, then copy its real URL out of the dashboard before wiring
anything to it.** Every `<your-render-url>` / `<your-vercel-url>` below is a placeholder
for a value you paste in, never one you predict.

**Deployment order is forced:** Neon → Render → Vercel → back to Render. Each step needs
the previous one's URL, and the last one closes the loop.

---

## What's different from Snipp — read this first

Snipp had no auth, so its only cross-origin concern was CORS. LedgerLite adds a refresh
cookie that must survive a **cross-origin** hop, and that pulls in three settings that
must be right *together* or sign-in silently fails to persist:

| Setting | Local | Production | Why |
|---|---|---|---|
| `COOKIE_SECURE` | `false` | **`true`** | `SameSite=None` is only honoured over HTTPS |
| `COOKIE_SAMESITE` | `lax` | **`none`** | Vercel and Render are different origins |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | exact Vercel URL | a wildcard is invalid with credentials |

Locally the Vite proxy makes everything same-origin, so `Lax` + insecure works over
plain http. In production nothing proxies, so the cookie is genuinely cross-site.

The failure mode is nasty because it isn't an error: sign-in appears to work, then a
reload signs you out. **The app refuses to boot in production with `SameSite=None` and
`Secure=false`** precisely so this is caught loudly at deploy rather than quietly by a
confused user.

---

## Phase 1 — Neon (managed Postgres)

1. <https://neon.tech> → sign in with GitHub → **New Project**.
2. Name it `ledgerlite`. **Pick the region closest to your Render region** — every API
   request makes at least one round trip, and a transatlantic hop shows up directly in
   response times. (Render's free tier is Oregon or Frankfurt; pair accordingly.)
3. Copy the **connection string** from the dashboard. It looks like:
   ```
   postgresql://user:pass@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```

### ⚠ Use the DIRECT connection string, not the pooled one

Neon offers two endpoints. The pooled one has **`-pooler`** in the hostname:

```
ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech    ← DO NOT USE
ep-cool-name-123456.eu-central-1.aws.neon.tech           ← use this one
```

The pooled endpoint runs PgBouncer in transaction mode, which is incompatible with
asyncpg's prepared-statement cache. `backend/app/database.py` does not set
`statement_cache_size=0`, so the pooled endpoint will fail at runtime with:

```
asyncpg.exceptions.DuplicatePreparedStatementError:
  prepared statement "__asyncpg_stmt_1__" already exists
```

Confusingly this often works for the first few requests and then starts failing, which
makes it look intermittent. It isn't — it's the wrong endpoint. The app's own pool
(`pool_size=5, max_overflow=10, pool_pre_ping=True, pool_recycle=1800`) is sized for
the direct endpoint and is all this app needs.

> **Paste the string verbatim** — including `?sslmode=require&channel_binding=require`.
> `database.py` normalizes it: rewrites `postgres://` → `postgresql://` →
> `postgresql+asyncpg://`, lifts `sslmode` into a real TLS setting, and strips the
> libpq-only query args (`sslmode`, `channel_binding`) that asyncpg rejects outright.
> A hosted host with no `sslmode` at all still gets TLS forced on.

**No schema step.** The app runs `create_all` on startup — idempotent — so a fresh Neon
database provisions `users`, `expenses`, `budgets` and `refresh_tokens` on first boot.
(`backend/db/init.sql` exists for local docker-compose; a hosted database never sees it.
Both paths are verified.)

> **Free-tier note:** the Neon compute suspends after ~5 minutes idle and wakes on the
> next connection. `pool_pre_ping=True` is already set, so a stale pooled connection is
> detected and replaced rather than surfacing as an error.

---

## Phase 2 — Render (FastAPI backend)

1. <https://dashboard.render.com> → **New** → **Web Service** → connect the
   `EkomIwatt/LedgerLite` repo.
2. Settings:

   | Field | Value |
   |---|---|
   | **Name** | `ledgerlite-api` |
   | **Root Directory** | `backend` |
   | **Runtime** | Python 3 |
   | **Build Command** | `pip install -r requirements.txt` |
   | **Start Command** | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
   | **Instance Type** | Free |

   **Root Directory `backend` matters** for more than paths: it's how Render finds
   `backend/.python-version`, which pins **3.12.8**. That pin is Snipp's scar tissue —
   Render otherwise picks a Python with no prebuilt `pydantic-core` wheel and the source
   build dies on a read-only filesystem.

   *Alternative:* set Runtime to **Docker** and Render uses `backend/Dockerfile`, which
   already honours `$PORT` and pins the same Python. Slower to build, more faithful to
   local. Either is fine; native Python is quicker.

3. **Generate a real secret** — do not reuse the placeholder:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```
   Keep it somewhere safe. Changing it later invalidates every issued token, signing
   all users out.

4. **Environment** → add:

   | Key | Value | Notes |
   |---|---|---|
   | `ENVIRONMENT` | `production` | turns on the boot guards |
   | `DATABASE_URL` | *(Neon direct string, Phase 1)* | verbatim, `-pooler`-free |
   | `SECRET_KEY` | *(generated above)* | ≥32 chars, never the placeholder |
   | `COOKIE_SECURE` | `true` | |
   | `COOKIE_SAMESITE` | `none` | moves together with the line above |
   | `FRONTEND_ORIGIN` | `https://<your-vercel-url>.vercel.app` | **provisional** — corrected in Phase 4 |

   Optional, all with working defaults: `ACCESS_TOKEN_TTL_SECONDS` (900),
   `REFRESH_TOKEN_TTL_SECONDS` (2592000), `REFRESH_REPLAY_GRACE_SECONDS` (10),
   `SQL_ECHO` (false).

5. **Create Web Service.** First build takes a few minutes.

6. **Verify:**
   ```bash
   curl https://<your-render-url>.onrender.com/api/health
   # {"status":"ok"}
   ```
   Then check the startup log for the readiness line, which echoes the config back:
   ```
   LedgerLite API ready (env=production, origins=['https://...'], cookie secure=True samesite=none)
   ```
   If those values aren't what you intended, fix them now — this line is the cheapest
   confirmation you'll get.

### If it refuses to boot, read the message

Both guards fail loudly and specifically. This is them working, not breaking:

| Log says | Fix |
|---|---|
| `SECRET_KEY must be set to a strong, non-default value (>= 32 chars)` | You left the placeholder or used something short. Generate one (step 3). |
| `COOKIE_SAMESITE=None requires COOKIE_SECURE=true` | Set `COOKIE_SECURE=true`. |
| `FRONTEND_ORIGIN must be an exact origin; a wildcard is invalid` | Remove the `*`; a wildcard cannot be used with credentialed CORS. |

---

## Phase 3 — Vercel (React/Vite frontend)

1. <https://vercel.com> → **Add New** → **Project** → import `EkomIwatt/LedgerLite`.
2. Settings:

   | Field | Value |
   |---|---|
   | **Root Directory** | `frontend` |
   | **Framework Preset** | Vite (auto-detected) |
   | **Build Command** | `npm run build` (default) |
   | **Output Directory** | `dist` (default) |

   `frontend/vercel.json` supplies the SPA rewrite, so a deep link like `/expenses`
   doesn't 404 on refresh. Nothing to configure for that.

   Note `npm run build` runs `tsc --noEmit && vite build` — a type error fails the
   deploy rather than shipping. That's deliberate.

3. **Environment Variables** → add:

   | Key | Value |
   |---|---|
   | `VITE_API_BASE_URL` | `https://<your-render-url>.onrender.com` |
   | `VITE_USE_MOCKS` | `false` |

   No trailing slash on the API URL. These are baked in at **build** time, not read at
   runtime — changing either requires a redeploy, not just a restart.

   > `VITE_USE_MOCKS=true` serves the entire app from the in-browser mock backend with
   > no API at all, seeded with `demo@ledgerlite.app` / `demo1234`. Useful for a demo
   > link that survives Render's cold starts — but it is not the real thing, and nothing
   > persists. Don't ship it as the main deployment.

4. **Deploy**, then **copy the actual URL Vercel gives you.**

---

## Phase 4 — Close the CORS loop ← the step people skip

Vercel has now told you the real origin. If it differs at all from the provisional value
in Render's `FRONTEND_ORIGIN` — different suffix, extra hyphen, anything — fix it:

1. Render → your service → **Environment** → edit `FRONTEND_ORIGIN` to the exact live
   Vercel origin. No trailing slash, no path, no wildcard.
2. Save. Render redeploys automatically on an env change.
3. Re-check the readiness log line shows the corrected origin.

**To also allow Vercel preview deployments**, comma-separate them:

```
https://<your-vercel-url>.vercel.app,https://ledgerlite-git-main-ekomiwatt.vercel.app
```

Every entry must still be an exact origin. The symptom of getting this wrong is a
misleading "can't reach the API" in the UI, with a blocked cross-origin request in the
browser console — it looks like the backend is down when it's actually refusing the
origin.

---

## Phase 5 — Smoke test the live deployment

Order matters: each step depends on the previous one having genuinely worked. **This is
also where the browser half of the cookie round-trip finally gets proven** — everything
before this was verified over HTTP and in jsdom, neither of which is a browser engine.

**1. Sign up** with a fresh email. You should land on the dashboard.
> First request may take 30–60s while Render wakes. Subsequent ones are fast.

**2. Inspect the cookie.** DevTools → **Application** → **Cookies** → the *API* origin
(`https://<your-render-url>.onrender.com`, not the Vercel one). You should see:

| Attribute | Expected |
|---|---|
| Name | `refresh_token` |
| HttpOnly | ✔ |
| Secure | ✔ |
| SameSite | `None` |
| Path | `/api/auth` |
| Expires | ~30 days out |

*Proves:* the cookie survived a cross-site hop with credentials. If it's absent, CORS or
the cookie flags are wrong — go to Troubleshooting.

**3. Reload the page.** You should stay signed in.
*Proves:* the boot refresh works end to end. The access token lives **only in memory**,
so surviving a reload is only possible by exchanging the cookie for a new one. This is
the single most valuable check on the page.

**4. Use the app.** Add a few expenses across two or three categories, set a budget for
one of them, and confirm all three charts render — pie, month-over-month bar, and the
gauge. Then set a budget *smaller* than what you've spent and confirm the gauge shows a
real over-budget state rather than a clamped one.

**5. Let the access token expire** (15 minutes) then click around. In the **Network**
tab you should see exactly **one** `POST /api/auth/refresh`, followed by your original
request retried and succeeding.
*Proves:* refresh-on-401 with single-flight — one refresh, one retry, no loop.

**6. Open a second tab** and use the app in both. Both stay signed in.
*Proves:* Amendment 1 — the cross-tab refresh fix. Under the pre-amendment code this
exact sequence signed you out on every device. If this fails, check
`REFRESH_REPLAY_GRACE_SECONDS` is not set to `0`.

**7. Sign up a second account** in a private window. Add an expense there. Confirm
neither account sees any trace of the other — list, dashboard totals, or charts.
*Proves:* user isolation through the whole stack, not just at the API.

**8. Sign out**, then press Back. You should not get back in.
*Proves:* logout invalidates the family; the access token dies immediately rather than
living out its 15 minutes.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in works, reload signs you out | Refresh cookie not stored | `COOKIE_SECURE=true` **and** `COOKIE_SAMESITE=none` on Render — both, or neither works |
| No `refresh_token` cookie in DevTools | CORS rejected the credentialed response | `FRONTEND_ORIGIN` must equal the live Vercel origin exactly (Phase 4) |
| "Can't reach the API", console shows blocked origin | Same as above | Same as above — the backend is up, it's refusing the origin |
| `DuplicatePreparedStatementError` / `__asyncpg_stmt_N__ already exists` | Using Neon's **pooled** endpoint | Switch `DATABASE_URL` to the direct one (no `-pooler`) — Phase 1 |
| Boot fails, log mentions `SECRET_KEY` | Placeholder or <32 chars in production | Generate a real one |
| Boot fails, log mentions SameSite | `none` without `Secure` | `COOKIE_SECURE=true` |
| Build fails on `pydantic-core` | Wrong Python | Confirm Root Directory is `backend` so `.python-version` (3.12.8) is found |
| First request after idle takes ~40s | Render free-tier cold start | Expected, not a bug |
| Signed out with two tabs open | `REFRESH_REPLAY_GRACE_SECONDS=0` | Restore the default `10` |
| Charts empty on a new account | Correct behaviour | Add an expense — analytics return zeroed totals, never an error |
| Deep link 404s on refresh | SPA rewrite missing | Confirm Root Directory is `frontend` so `vercel.json` is picked up |
| Type error fails the Vercel build | `npm run build` typechecks first | Fix it — this is the guard working |

---

## Appendix A — Environment variable reference

**Render (backend)**

| Key | Default | Production |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` |
| `DATABASE_URL` | local compose URL | Neon **direct** string |
| `SECRET_KEY` | dev placeholder | generated, ≥32 chars |
| `COOKIE_SECURE` | `false` | `true` |
| `COOKIE_SAMESITE` | `lax` | `none` |
| `COOKIE_DOMAIN` | unset | leave unset |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | exact Vercel origin(s) |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | |
| `REFRESH_TOKEN_TTL_SECONDS` | `2592000` | |
| `REFRESH_REPLAY_GRACE_SECONDS` | `10` | |
| `SQL_ECHO` | `false` | keep `false` — it logs every statement |

**Vercel (frontend)**

| Key | Local | Production |
|---|---|---|
| `VITE_API_BASE_URL` | *(empty — use the proxy)* | Render URL, no trailing slash |
| `VITE_USE_MOCKS` | `false` | `false` |

Full annotated versions: `backend/.env.example`, `frontend/.env.example`.

## Appendix B — Operating it

**Redeploy:** push to `main`. Both platforms auto-deploy. A Render env change also
triggers a rebuild; a Vercel env change needs a manual redeploy, since Vite bakes
`VITE_*` in at build time.

**Rotate `SECRET_KEY`:** change it on Render and redeploy. Every access and refresh
token instantly becomes invalid and every user is signed out — correct behaviour, and
the right response if you suspect the key leaked.

**Wipe all sessions without touching the key:** not exposed as an endpoint. Delete the
`refresh_tokens` rows in Neon; users get signed out as their access tokens expire.

**Cold starts:** Render's free web service sleeps after ~15 min idle; Neon's compute
suspends after ~5. On LedgerLite the wake shows up as a slow first sign-in, because the
boot refresh is the very first call the app makes. If you're demoing it live, load the
page a minute beforehand.

**Logs:** Render → your service → **Logs**. Unhandled errors are logged server-side with
a stack trace; the client only ever receives `{"error": "Something went wrong."}`.

---

## Local development is unchanged

Local uses the Vite dev proxy — no CORS, no cross-site cookie — and git-ignored `.env`
files. Hosted config lives entirely in the Render and Vercel dashboards.

```bash
# Backend + Postgres
cd backend
cp .env.example .env          # set a real SECRET_KEY
docker compose up --build     # API on :8000, Postgres on :5432

# Frontend
cd frontend
cp .env.example .env.local    # leave VITE_API_BASE_URL empty
npm install && npm run dev    # UI on :5173, /api proxied to :8000
```

See `backend/README.md` and `frontend/README.md` for per-side detail.
