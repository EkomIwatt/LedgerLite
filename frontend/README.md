# LedgerLite — frontend

React 19 + Vite + TypeScript. The signup/login screens, the expense ledger, the
per-category budget settings, and the three visualisations.

Built by **Instance 2** of a two-instance parallel run, against the frozen
interface contracts in the repository-root `CLAUDE.md`. This half consumes
Contracts 1–6 and produces none of them.

---

## Running it

```bash
npm install

# Against the in-browser mock backend — no API, no database, no setup.
npm run dev            # with VITE_USE_MOCKS=true in .env.local

# Against a real backend on http://localhost:8000
npm run dev            # with VITE_USE_MOCKS=false (the default)
```

Copy `.env.example` to `.env.local` and adjust. Both variables are documented
there.

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server on :5173, proxying `/api` → `:8000` |
| `npm run build` | Typecheck, then production build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | The full Vitest suite, once |
| `npm run test:watch` | Vitest in watch mode |

### The demo account

With `VITE_USE_MOCKS=true`, sign in as `demo@ledgerlite.app` / `demo1234` for
six months of seeded spending, a blown budget and an untouched one — enough to
see every chart state. Or create any account you like; it lives in the tab and
disappears on reload.

---

## The mock backend

`src/api/mocks.ts` is a `fetch`-shaped implementation of Contracts 1–6: the same
paths, status codes, field names, error envelope, orderings and inclusion rules.
`VITE_USE_MOCKS=true` swaps it in as the client's transport, so **the client
code above it is unchanged** — the same refresh logic, credential handling and
error parsing run in mocked and real mode alike.

The whole UI was built and tested against it without ever seeing the backend's
code. `src/test/contract-conformance.test.ts` is what keeps that honest: it
asserts the mock against the contract *text*, so every assumption baked into the
mock is one the real API is held to.

**One thing a mock structurally cannot prove.** JavaScript can neither set nor
read an httpOnly cookie — that is the point of one. So the mock rehearses the
refresh *responses* and the rotation semantics using a module variable in place
of the cookie jar, but the genuine `Set-Cookie` round trip is a check-at-merge
item for the Reconciler, recorded as such in the root `CLAUDE.md`.

---

## How the session works

Contract 1, in three rules:

1. **The access token lives in memory only** (`src/api/tokenStore.ts`) — never
   localStorage, never sessionStorage. Session survival across a reload comes
   from the httpOnly refresh cookie.
2. **On boot**, `POST /api/auth/refresh` runs exactly once. 200 → fetch
   `/api/auth/me` and render the app. 401 → render the sign-in screen. A
   loading state covers the gap so an authenticated user never sees a flash of
   the login page.
3. **A 401 from any non-`/api/auth` endpoint** triggers one refresh and one
   retry. Never more, never a loop. Concurrent 401s share a **single in-flight
   refresh promise** — the dashboard fires four requests at once, and four
   parallel refreshes would rotate the cookie out from under each other.

All of it lives in `src/api/client.ts`, and all of it is tested in
`src/test/client-refresh.test.ts`.

---

## How the charts work

Contract 5 puts every aggregate on the server. Nothing in `src/charts/` sums,
buckets, zero-fills or computes a percentage — the components render what they
are given.

- **`CategoryPie`** ← 5b. Uses the `color` the server denormalises onto each
  row. Its legend is a real `<table>` carrying every figure, because a donut is
  hard to read precisely and impossible to read with a screen reader.
- **`MonthlyBar`** ← 5c. The series arrives zero-filled and contiguous and is
  rendered as received. There is deliberately no client-side gap filling: a
  missing month would be a contract bug to escalate, not to patch around.
- **`BudgetGauge`** ← 5a for the headline, 5b for the per-category meters.
  `remaining_minor` may be negative and `percent_used` may exceed 100, so the
  over-budget state is designed rather than clamped: the dial turns red, the
  true percentage is printed, the overspend is stated as a figure, and each
  category meter scales its track to `max(limit, spent)` so the limit marker
  moves *inside* the bar and you can see how far past the line you went.

Every chart has a designed empty state, because a brand-new account gets zeroed
totals and an empty `categories` array from all three endpoints.

---

## Money

One rule, enforced in `src/lib/money.ts`: money is always an integer number of
minor units (kobo). Amounts are parsed from user input with string arithmetic
rather than `parseFloat(x) * 100`, because that multiplication is exactly where
a rounding error would enter the ledger — `parseFloat("8.29") * 100` is
`828.9999999999999`.

---

## Layout

```
src/
  api/         types (transcribed from the contracts), client, endpoints,
               the frozen category list, the mock backend
  auth/        session state machine, provider, route guards
  charts/      the three visualisations + shared frame and theme
  components/  layout, form field, modal, icons, feedback states
  features/    the expense form
  hooks/       async data loading, category vocabulary
  lib/         money and calendar helpers
  pages/       dashboard, expenses, budgets, auth screens
  styles/      design tokens, base, components
  test/        contract conformance, refresh logic, charts, app integration
```

## Design

The interface is a ledger: ruled paper, hairline rules instead of shadows,
right-aligned tabular figures, near-rectilinear corners, a newspaper masthead.
The chrome is deliberately achromatic so that the ten frozen Contract 2 category
colours are the **only** saturated colour in the product — which is what makes a
category instantly recognisable in the pie, the bars, the meters and the ledger
rows at once.

Type: *Instrument Serif* for display figures, *Archivo* for UI text, *IBM Plex
Mono* for anything that lives in a column. Light and dark are both first-class;
every text colour is checked at 4.5:1 or better against its own background.

## Deploying

Vercel, with the project root set to `frontend/`. `vercel.json` carries the SPA
rewrite so a deep link like `/budgets` does not 404 on refresh. Set
`VITE_API_BASE_URL` to the deployed API origin — no trailing slash — and leave
`VITE_USE_MOCKS` unset or `false`.

In production the UI and API are different origins, so the backend must send the
refresh cookie with `SameSite=None; Secure` and set `FRONTEND_ORIGIN` to the
exact Vercel origin. That origin is often not the bare project name; confirm it
at deploy time. The full runbook is `DEPLOY.md` at the repository root.
