# Built with Swarm — LedgerLite

LedgerLite (a private personal expense tracker) was built as **Project 2 of 10** in an
AI-accelerated full-stack ladder, and as the **second run of the Swarm multi-agent
workflow**. Snipp proved the machinery on the safest possible problem — no auth, no
shared state, one tidy JSON contract. This run deliberately added the two things Snipp
excluded: **an authentication layer** and **user-scoped data**, where a single missing
`WHERE user_id = ...` is a privacy breach rather than a bug.

The question this run was really asking: *Snipp's contracts held on first contact. Was
that the process working, or the problem being easy?*

**Answer: the process worked — and the harder problem found the seam the process
cannot see.** All six contracts held on both real sides with zero mismatches. But the
merged system still had a defect that neither instance could have caught alone,
because **both halves were individually correct and the contract itself was
underspecified.** Catching that is what the reconciliation phase is for, and this time
it earned its keep.

---

## 1. The workflow

| Phase | Role | What happened |
|-------|------|---------------|
| Plan | **Initialiser** | Digested the brief, resolved four foundational unknowns with the human *before* drafting anything, found one seam (server vs. client), chose the **minimum** split — 2 instances — and proposed 6 interface contracts. |
| Freeze | **Human** | Ratified the contracts (`PROPOSED → FROZEN`) and committed them on `main` (`9ebfd09`) *before* any worktree branched, so both instances provably shared identical contract text. |
| Build | **2 Workers** | Each in its own git worktree/branch, writing only to its own `CLAUDE.md` section, building against the frozen contract — the frontend stubbing the backend entirely. |
| Merge | **Reconciler** | Audited the coordination file, merged producer→consumer, proved every contract on both *real* sides, ran both suites plus 51 live checks against real Postgres, and surfaced one defect for the human to rule on. |

The **filesystem was the only shared medium**: one `CLAUDE.md`, one section per instance.

### Asking before assuming

The brief said "same base + a charting lib and a JWT auth layer." The Initialiser
stopped and put four questions to the human rather than guessing, because each one
would have forced a contract rewrite if guessed wrong:

1. **JWT model** — access + httpOnly refresh cookie *(chosen)*, both tokens in the
   body, or access-only.
2. **Categories** — fixed server-side enum *(chosen)*, user CRUD, or seeded-editable.
3. **Money on the wire** — integer minor units *(chosen)* or decimal strings.
4. **Stack** — inherited from Snipp *(chosen)*.

Every one of these reaches into multiple contracts. Deciding them up front is why the
contract text below could be concrete enough to stub from on day one.

## 2. The frozen contracts

Six contracts, frozen before a line of code (full text in `CLAUDE.md`):

| # | Contract | Substance |
|---|----------|-----------|
| 1 | **Auth** | signup/login/refresh/logout/me · access JWT + httpOnly refresh cookie · `typ` claim discipline · cookie attributes per environment · **401 vs 404 rules** |
| 2 | **Categories** | the frozen 10-key vocabulary + the authoritative chart palette |
| 3 | **Expenses** | CRUD + filtered, paginated list · `date DESC, id DESC` |
| 4 | **Budgets** | upsert per (user, category, month) |
| 5 | **Analytics** | the three charts, every aggregate computed backend-side |
| 6 | **Errors/CORS** | `{"error": "<sentence>"}` everywhere · status-code table · exact-origin CORS |

Four decoupling decisions did the heavy lifting — three inherited from Snipp, one new:

- **All aggregation is backend-side.** The frontend does no summing, no bucketing, no
  zero-filling, no percentage math. Chart code stays dumb.
- **`clicks_over_time`'s successor:** `monthly` returns **zero-filled contiguous
  months**, so `months=6` always yields exactly 6 elements — even for an account
  created today. The bar chart handles no gaps.
- **Inclusion rules agreed up front.** A category with spend appears; a category with a
  budget appears *even at zero spend* (the gauge needs it); a category with neither is
  omitted. Both sides depended on this and neither had to guess.
- **New this run — money is an integer of the minor unit, everywhere**, with a `_minor`
  suffix on every wire field so neither side can misread it. No floats, no decimal
  strings, no rounding drift into the charts.

And two decisions that only an authenticated app needs:

- **Cross-user access returns 404, not 403.** A 403 confirms the row exists.
- **Cookie flags are environment-driven**, because local dev is same-origin through the
  Vite proxy (`Lax`, insecure) while production is genuinely cross-site (`None`,
  `Secure`). One codebase, both worlds.

## 3. The split

- **Instance 1 — Backend API & Auth** (`fastapi-expert`, `postgres-pro`, `api-designer`,
  `security-reviewer`, `test-master`): owned `backend/` — 19 modules, ~2,200 lines.
  FastAPI + Postgres, argon2 hashing, JWT issue/rotate, the analytics SQL,
  compose/CORS/Dockerfile. **Produced all six contracts.** 4 commits.
- **Instance 2 — Frontend Dashboard** (`react-expert`, `typescript-pro`, `ui-ux-pro-max`,
  `frontend-design`, `test-master`): owned `frontend/` — 46 modules, ~6,800 lines.
  React 19 + Vite + TypeScript, the auth state machine and route guards, the ledger and
  budget UI, the three Recharts visualizations, and a full mock backend.
  **Consumed all six.** 1 commit.

Cross-cutting glue was *folded, not split*: compose/CORS/Dockerfile into the backend;
Vite proxy, `vercel.json` and env into the frontend; this document, `DEPLOY.md` and the
root README left as the Reconciler's merge-time artifacts. **No third instance** — and
notably, **auth did not get one.** It cannot be separated from the API it protects: the
`current_user` dependency is injected into every route, `users` is the FK target of
every table, and the scoping predicate lives *inside* the aggregation queries. A third
instance would have needed real importable Python, not a stubbable JSON contract —
which is precisely the test for work that must not run in parallel.

## 4. Reconciliation

**Pre-merge audit:** both sections `DONE`; **zero escalations raised during the entire
build**; the frozen contract block **byte-identical** across `main` and both branches
(`sha256 62de89ed…`); paths fully disjoint.

**Merge:** producer first. `instance/backend` (`ed6cc39`) → `main`, then
`instance/frontend` (`6af2a9f`). Both **clean, zero conflicts** — disjoint `backend/`
vs `frontend/` trees, and `CLAUDE.md` auto-merged because each instance had written
only to its own section.

**Contract conformance — every contract proven on both *real* sides:**

| # | Contract | Producer (real code) | Consumer (real code) | Verdict |
|---|----------|----------------------|----------------------|---------|
| 1 | Auth | `routers/auth.py:80-212`, `deps.py:39-61` | `api/client.ts`, `auth/AuthProvider.tsx` | ✅ PASS |
| 2 | Categories | `routers/categories.py`, `categories.py` | `api/categories.ts`, `api/types.ts:71` | ✅ PASS |
| 3 | Expenses | `routers/expenses.py:34-90`, `schemas.py` | `api/types.ts:86-119`, `api/endpoints.ts` | ✅ PASS |
| 4 | Budgets | `routers/budgets.py:24-59` | `api/types.ts:129-147` | ✅ PASS |
| 5 | Analytics | `analytics.py:48-167` | `api/types.ts:156-209`, `charts/` | ✅ PASS |
| 6 | Errors/CORS | `errors.py:110-134`, `main.py:50-56` | `api/errors.ts`, `client.ts` | ✅ PASS |

Field names, types and nullability matched one-for-one between `schemas.py` and
`types.ts`. Routes matched exactly — including the *absence* of `GET /api/expenses/{id}`,
which the contract never defined and neither side invented. Both mismatch candidates the
instances had flagged for the merger (`WWW-Authenticate: Bearer`; whether `/api/auth/me`
was served) came back PASS.

## 5. The finding — what a frozen contract cannot protect you from

**Every contract passed on both sides, and the merged system still signed users out.**

- **Instance 1** implemented refresh rotation with **theft detection**: replaying an
  already-rotated cookie revokes the entire token family and bumps `token_version`.
  Defensible, security-positive, and *beyond* what the contract asked for. It flagged
  the dependency in its work log as the top merge risk.
- **Instance 2** implemented **single-flight refresh** exactly as Contract 1 required —
  N concurrent 401s share one in-flight promise — and proved it with 14 tests.

Both correct. But the in-flight promise is a **module variable**, so it is single-flight
per JavaScript realm — **per tab** — while two tabs share one **cookie jar**.

Reproduced live against the real API and real Postgres:

```
tab A refresh (cookie C1) ......... 200, new access token
tab B refresh (same cookie C1) .... 401   ← read as theft, family revoked
tab A's brand-new access token .... 401   ← tab A signed out too
```

Two tabs open, both tokens expire, and the user is signed out **on every device** for
doing nothing wrong. Because `token_version` is asserted on access tokens too, the
lockout is immediate rather than waiting out the 15-minute TTL.

**Why nothing caught it earlier.** Instance 2's mock models the refresh cookie as a
**single mutable slot** — `store.refreshCookie` is simply overwritten, with no
per-token record, no `revoked_at`, no replay concept. The stub **structurally could not
represent this failure.** That is why 117 green frontend tests sat on top of a system
that locks users out. The stub was faithful to the contract; the contract never
mentioned theft detection, and said "concurrent 401s" without contemplating more than
one document.

**So neither instance diverged. The contract was underspecified** — which made this a
human-gated amendment, not a bug to assign to either side.

**Amendment 1, ratified, fixed on both sides deliberately:**

- *Backend:* a **replay grace window** (`REFRESH_REPLAY_GRACE_SECONDS`, default 10s),
  gated on the family still being live. Outside the window, or once the family is dead,
  a replay is still treated as theft.
- *Frontend:* **`navigator.locks`** around `refreshSession()`, serialising refreshes
  across every tab of the origin. It needs no cross-tab messaging: the losing tab runs
  only after the winner's `Set-Cookie` has landed in the shared jar, so it sends the
  *current* cookie and rotates normally.

Belt-and-braces on purpose: the lock closes the race where the API exists, and the grace
window covers browsers that lack it plus any future client — a mobile app, a script —
that never implements single-flight at all.

> **The lesson worth keeping.** A frozen contract guarantees that two halves *fit*. It
> cannot guarantee that what they fit into behaves — especially where one side
> implements something stronger than the contract asked for, and the other side's stub
> cannot model the difference. On Snipp the stub matched the backend byte-for-byte
> because there was no hidden state to model. Add stateful auth and that stops being
> free. **The place to look is wherever an implementation exceeded its contract.**

## 6. Verification

| Layer | Result |
|---|---|
| Backend suite | **222 passed** — real ASGI app over in-memory SQLite |
| Frontend suite | **117 passed** — including 61 contract-conformance tests asserting the mock against the contract *text* |
| TypeScript | clean under `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` |
| Live integration | **51 checks passed** against the real API + **real Postgres** |

The live sweep covered every contract over HTTP: cookie attributes, no-user-enumeration
byte-identity, refresh-token-as-Bearer rejection, the error envelope, exact-origin CORS,
the 5b inclusion rule and its ordering, 5c's zero-filled contiguous months (exercising
`to_char` on Postgres, the one Postgres-only runtime branch), and — with two real
accounts — **user isolation end to end**: 404-not-403 on cross-user PATCH and DELETE,
the victim's row verifiably intact, and the attacker's list, summary and charts all
empty of the other user's data.

Postgres was tested via `create_all` rather than `init.sql`, which exercises the
**hosted-database path** — how Neon actually comes up.

**Closed on the live deployment.** Everything above was verified at the HTTP level and
in jsdom — neither of which is a browser engine — so the browser half of the cookie
round-trip stayed open until deploy. It has since been walked end to end against the
live stack (`DEPLOY.md` Phase 5), all green:

- the real `Set-Cookie` arrives cross-origin with `HttpOnly`, `Secure`, `SameSite=None`,
  `Path=/api/auth`;
- a page reload silently re-authenticates — the access token is memory-only, so this is
  only possible via the cookie;
- an expired token produces exactly one refresh and one retry;
- **two tabs stay signed in** — Amendment 1 holding in a real browser, the sequence that
  signed the user out on every device before the fix;
- a second account sees no trace of the first, through the whole stack.

Nothing about this run is now unverified.

**Live:** <https://ledger-lite-amber.vercel.app/>

## 7. Also fixed during reconciliation

Four issues found while integrating — none of them contract problems, all recorded
because each will recur on the next project in the ladder:

- **Compose project-name collision.** `docker-compose.yml` had no top-level `name:`, so
  Compose derived it from the parent directory — `backend` — which *every* project in
  this ladder shares. An unpinned build here re-tagged Snipp's `backend-api:latest` and
  recreated its `db` container. (Snipp's data survived in its volume.) Now pinned to
  `name: ledgerlite`; **worth adding to every project in the ladder.**
- **A ~300MB C toolchain for nothing.** The Dockerfile installed `build-essential` +
  `libpq-dev` "in case a transitive dependency ever needs to compile" — one apt layer,
  ~33 minutes. Verified every dependency installs from wheels on `python:3.12.8-slim`
  with **no compiler present**, and removed it.
- **No `.dockerignore`.** `COPY . .` swept a local `.venv` into the image — 71MB of the
  72MB under `/app`. Added.
- **Test-runner flakiness, not product flakiness.** Three failures in the parallel
  frontend run, all in one file, none reproducible in isolation: concurrent transforms
  of the lazy Recharts chunk blew the timeout. Pinned `fileParallelism: false` and
  raised `testTimeout`.

---

*Coordination file: `CLAUDE.md` — frozen contracts, both work logs, and the full
Amendment 1 record. Deployment runbook: `DEPLOY.md`. Branches preserved:
`instance/backend`, `instance/frontend` — kept reversible until the integration is
accepted.*
