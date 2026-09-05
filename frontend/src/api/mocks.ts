/**
 * The mock backend.
 *
 * This is a stand-in for Instance 1's API that implements Contracts 1-6
 * verbatim: the same paths, the same status codes, the same field names, the
 * same `{ "error": "..." }` envelope, the same orderings and the same
 * inclusion rules. It is a `fetch`-shaped function, so the real client sits on
 * top of it unchanged - the refresh dance, the credential handling and the
 * error parsing are all exercised exactly as they will be in production.
 *
 * TWO THINGS TO KNOW WHEN READING THIS FILE
 *
 * 1. All the aggregation lives HERE, and only here. Contract 5 says the server
 *    computes the charts and the frontend renders what it is given. That rule
 *    holds for the app; this file is playing the server, so it does the SUMs,
 *    the bucketing, the zero-filling and the percentages that the app is
 *    forbidden to do. Nothing outside `src/api/mocks.ts` may do the same.
 *
 * 2. The refresh cookie is simulated by a module variable. JavaScript cannot
 *    set - or read - an httpOnly cookie, which is the entire point of one.
 *    So this file can rehearse the refresh *responses* and the rotation
 *    semantics, but it cannot prove the genuine `Set-Cookie` round trip. That
 *    is the known check-at-merge item recorded in CLAUDE.md, and it is the one
 *    boundary a mock is structurally unable to close.
 *
 * The mock is never security-relevant: it holds fixture passwords in plain
 * memory, its "JWTs" are unsigned base64, and it is code-split out of a real
 * build. The real backend hashes with argon2 and signs HS256.
 */
import { CATEGORIES, categoryRank } from './categories';
import type {
  AnalyticsByCategory,
  AnalyticsMonthly,
  AnalyticsSummary,
  AuthSession,
  Budget,
  BudgetListResponse,
  BudgetUpsertResult,
  CategoriesResponse,
  CategoryBreakdown,
  CategoryKey,
  Expense,
  ExpenseListResponse,
  IsoDate,
  IsoMonth,
  MonthlyPoint,
  RefreshResult,
  User,
} from './types';

/* -------------------------------------------------------------------------
 * Store
 * ---------------------------------------------------------------------- */

interface MockUser {
  id: number;
  email: string;
  /** Fixture only. The real backend stores an argon2 hash and nothing else. */
  password: string;
  created_at: string;
  /** Bumped on logout, which retires every outstanding refresh token. */
  token_version: number;
}

interface MockExpense extends Expense {
  user_id: number;
}

interface MockBudget {
  user_id: number;
  month: IsoMonth;
  category: CategoryKey;
  limit_minor: number;
}

interface Store {
  users: MockUser[];
  expenses: MockExpense[];
  budgets: MockBudget[];
  nextUserId: number;
  nextExpenseId: number;
  /**
   * The httpOnly refresh cookie, simulated. A real browser would hold this and
   * we would never see it. Only the most recently issued token is accepted,
   * which is how rotation is modelled: an already-used cookie is dead.
   */
  refreshCookie: string | null;
}

const ACCESS_TOKEN_TTL_SECONDS = 900;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

let store: Store = emptyStore();
let latencyMs = 0;
let jtiCounter = 0;

function emptyStore(): Store {
  return {
    users: [],
    expenses: [],
    budgets: [],
    nextUserId: 1,
    nextExpenseId: 1,
    refreshCookie: null,
  };
}

/** Wipe every mock row and re-seed. Tests call this between cases. */
export function resetMockBackend(options: { seed?: boolean } = {}): void {
  store = emptyStore();
  jtiCounter = 0;
  if (options.seed !== false) seedDemoAccount();
}

/** Artificial delay, so loading states are visible when demoing on mocks. */
export function setMockLatency(ms: number): void {
  latencyMs = Math.max(0, ms);
}

/** Test seam: kill the current access token without touching the cookie. */
export function expireMockAccessTokens(): void {
  accessTokenClockSkewSeconds = ACCESS_TOKEN_TTL_SECONDS + 1;
}

let accessTokenClockSkewSeconds = 0;

/* -------------------------------------------------------------------------
 * Tokens
 *
 * Unsigned, but shaped like the real thing so the `typ` discipline in
 * Contract 1 can actually be rehearsed: a refresh token presented as a Bearer
 * credential is rejected, and vice versa.
 * ---------------------------------------------------------------------- */

interface TokenClaims {
  sub: string;
  typ: 'access' | 'refresh';
  iat: number;
  exp: number;
  jti: string;
  ver: number;
}

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function issueToken(user: MockUser, typ: 'access' | 'refresh'): string {
  const iat = nowSeconds();
  const claims: TokenClaims = {
    sub: String(user.id),
    typ,
    iat,
    exp: iat + (typ === 'access' ? ACCESS_TOKEN_TTL_SECONDS : REFRESH_TOKEN_TTL_SECONDS),
    jti: `mock-${++jtiCounter}`,
    ver: user.token_version,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  return `${header}.${base64UrlEncode(JSON.stringify(claims))}.mock`;
}

function readToken(token: string): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as TokenClaims;
  } catch {
    return null;
  }
}

/**
 * Resolve a Bearer credential to a user. Returns null for a missing,
 * malformed, expired, retired or WRONG-TYPE token - all of which the contract
 * collapses into a single 401 "Not authenticated."
 */
function userFromAccessToken(token: string | null): MockUser | null {
  if (!token) return null;
  const claims = readToken(token);
  if (!claims || claims.typ !== 'access') return null;
  if (claims.exp <= nowSeconds() + accessTokenClockSkewSeconds) return null;
  const user = store.users.find((u) => String(u.id) === claims.sub);
  if (!user || user.token_version !== claims.ver) return null;
  return user;
}

/* -------------------------------------------------------------------------
 * Responses
 * ---------------------------------------------------------------------- */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** Contract 6: every non-2xx body is exactly `{ "error": "<sentence>" }`. */
function fail(status: number, message: string): Response {
  return json(status, { error: message });
}

const NOT_AUTHENTICATED = 'Not authenticated.';
const EXPENSE_NOT_FOUND = 'Expense not found.';
const SESSION_EXPIRED = 'Session expired. Please sign in again.';

/* -------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------- */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT_MINOR = 1_000_000_000_000;
const MAX_NOTE_LENGTH = 500;
const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

function isValidMonth(value: unknown): value is IsoMonth {
  return typeof value === 'string' && MONTH_RE.test(value);
}

function isValidDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  // Reject "2026-02-31": round-tripping through Date must give back the input.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** A validated `note`: an empty string is stored as null, per Contract 3. */
function normaliseNote(value: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, note: null };
  if (typeof value !== 'string') return { ok: false, error: 'note must be a string.' };
  const trimmed = value.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `note must be ${MAX_NOTE_LENGTH} characters or fewer.` };
  }
  return { ok: true, note: trimmed === '' ? null : trimmed };
}

/* -------------------------------------------------------------------------
 * Date helpers (mock-internal; the app never buckets months itself)
 * ---------------------------------------------------------------------- */

function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

function currentMonthUtc(): IsoMonth {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month: IsoMonth, delta: number): IsoMonth {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1 + delta;
  const shifted = new Date(Date.UTC(year, monthIndex, 1));
  return shifted.toISOString().slice(0, 7);
}

function isoNow(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

/* -------------------------------------------------------------------------
 * Aggregation - Contract 5. Nowhere else in the app may do any of this.
 * ---------------------------------------------------------------------- */

function expensesFor(userId: number, month?: IsoMonth): MockExpense[] {
  return store.expenses.filter(
    (e) => e.user_id === userId && (month === undefined || monthOf(e.date) === month),
  );
}

function budgetsFor(userId: number, month: IsoMonth): MockBudget[] {
  return store.budgets.filter((b) => b.user_id === userId && b.month === month);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** One decimal place, as every `percent*` field in Contract 5 requires. */
function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildSummary(userId: number, month: IsoMonth): AnalyticsSummary {
  const rows = expensesFor(userId, month);
  const totalSpent = sum(rows.map((e) => e.amount_minor));
  const totalBudget = sum(budgetsFor(userId, month).map((b) => b.limit_minor));
  return {
    month,
    currency: 'NGN',
    total_spent_minor: totalSpent,
    total_budget_minor: totalBudget,
    // MAY BE NEGATIVE - the UI is required to design that state, not clamp it.
    remaining_minor: totalBudget - totalSpent,
    percent_used: totalBudget === 0 ? 0 : oneDecimal((totalSpent / totalBudget) * 100),
    expense_count: rows.length,
  };
}

function buildByCategory(userId: number, month: IsoMonth): AnalyticsByCategory {
  const rows = expensesFor(userId, month);
  const budgets = budgetsFor(userId, month);
  const totalSpent = sum(rows.map((e) => e.amount_minor));

  const spentByCategory = new Map<CategoryKey, number>();
  for (const row of rows) {
    spentByCategory.set(row.category, (spentByCategory.get(row.category) ?? 0) + row.amount_minor);
  }
  const limitByCategory = new Map<CategoryKey, number>(
    budgets.map((b) => [b.category, b.limit_minor]),
  );

  // INCLUSION RULE: spent > 0 OR a budget is set. Neither -> omitted entirely.
  const keys = new Set<CategoryKey>([...spentByCategory.keys(), ...limitByCategory.keys()]);

  const categories: CategoryBreakdown[] = [...keys].map((key) => {
    const spent = spentByCategory.get(key) ?? 0;
    const limit = limitByCategory.get(key) ?? null;
    const meta = CATEGORIES.find((c) => c.key === key);
    return {
      category: key,
      label: meta?.label ?? key,
      color: meta?.color ?? '#8A8F98',
      spent_minor: spent,
      percent: totalSpent === 0 ? 0 : oneDecimal((spent / totalSpent) * 100),
      limit_minor: limit,
      remaining_minor: limit === null ? null : limit - spent,
      percent_used: limit === null ? null : oneDecimal((spent / limit) * 100),
      over_budget: limit === null ? false : spent > limit,
    };
  });

  // ORDERING: spent_minor DESC, Contract 2 category order as the tie-break.
  categories.sort(
    (a, b) => b.spent_minor - a.spent_minor || categoryRank(a.category) - categoryRank(b.category),
  );

  return { month, currency: 'NGN', total_spent_minor: totalSpent, categories };
}

function buildMonthly(userId: number, months: number): AnalyticsMonthly {
  const current = currentMonthUtc();
  const points: MonthlyPoint[] = [];
  // ZERO-FILLED and CONTIGUOUS, oldest first, last element = the current month.
  // A month with no expenses appears with 0 - it is never skipped, so the bar
  // chart can render the array directly with no gap handling at all.
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const month = shiftMonth(current, -offset);
    points.push({
      month,
      total_spent_minor: sum(expensesFor(userId, month).map((e) => e.amount_minor)),
      total_budget_minor: sum(budgetsFor(userId, month).map((b) => b.limit_minor)),
    });
  }
  return { currency: 'NGN', months: points };
}

/* -------------------------------------------------------------------------
 * Serialisation
 * ---------------------------------------------------------------------- */

function publicUser(user: MockUser): User {
  return { id: user.id, email: user.email, created_at: user.created_at };
}

function publicExpense(expense: MockExpense): Expense {
  const { user_id: _userId, ...rest } = expense;
  return rest;
}

function sessionFor(user: MockUser): AuthSession {
  store.refreshCookie = issueToken(user, 'refresh');
  return {
    access_token: issueToken(user, 'access'),
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    user: publicUser(user),
  };
}

/* -------------------------------------------------------------------------
 * Route handlers
 * ---------------------------------------------------------------------- */

interface RequestContext {
  url: URL;
  method: string;
  body: Record<string, unknown>;
  bearer: string | null;
}

/**
 * Contract 1, protected-endpoint semantics: a missing, malformed, expired or
 * wrong-`typ` token all get the same 401 body AND the `WWW-Authenticate: Bearer`
 * header. The header is easy to forget and is asserted by the conformance
 * suite, so the real backend has to carry it too.
 */
function unauthenticated(): Response {
  return new Response(JSON.stringify({ error: NOT_AUTHENTICATED }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
  });
}

function requireUser(ctx: RequestContext): MockUser | Response {
  const user = userFromAccessToken(ctx.bearer);
  if (!user) return unauthenticated();
  return user;
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/** The `month` query parameter, which Contracts 4 and 5 make REQUIRED. */
function requiredMonth(ctx: RequestContext): IsoMonth | Response {
  const month = ctx.url.searchParams.get('month');
  if (month === null) return fail(400, 'Invalid month format. Expected YYYY-MM.');
  if (!isValidMonth(month)) return fail(400, 'Invalid month format. Expected YYYY-MM.');
  return month;
}

function handleSignup(ctx: RequestContext): Response {
  const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim() : '';
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';

  if (!email.includes('@')) return fail(422, 'Enter a valid email address.');
  if (password.length < 8) return fail(422, 'Password must be at least 8 characters.');

  // Email uniqueness is case-insensitive, matching `unique on lower(email)`.
  const existing = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) return fail(409, 'An account with that email already exists.');

  const user: MockUser = {
    id: store.nextUserId++,
    email: email.toLowerCase(),
    password,
    created_at: isoNow(),
    token_version: 1,
  };
  store.users.push(user);
  return json(201, sessionFor(user));
}

function handleLogin(ctx: RequestContext): Response {
  const email = typeof ctx.body.email === 'string' ? ctx.body.email.trim().toLowerCase() : '';
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  const user = store.users.find((u) => u.email === email);

  // NO USER ENUMERATION: an unknown email and a wrong password produce a
  // byte-identical response. The real backend also equalises the timing with a
  // dummy hash verification; there is nothing to equalise here.
  if (!user || user.password !== password) {
    return fail(401, 'Incorrect email or password.');
  }
  return json(200, sessionFor(user));
}

function handleRefresh(): Response {
  const cookie = store.refreshCookie;
  if (!cookie) return fail(401, SESSION_EXPIRED);

  const claims = readToken(cookie);
  if (!claims || claims.typ !== 'refresh' || claims.exp <= nowSeconds()) {
    return fail(401, SESSION_EXPIRED);
  }
  const user = store.users.find((u) => String(u.id) === claims.sub);
  if (!user || user.token_version !== claims.ver) return fail(401, SESSION_EXPIRED);

  // ROTATION: issuing a new cookie retires the one just presented.
  store.refreshCookie = issueToken(user, 'refresh');
  accessTokenClockSkewSeconds = 0;
  const body: RefreshResult = {
    access_token: issueToken(user, 'access'),
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
  };
  return json(200, body);
}

function handleLogout(): Response {
  // Idempotent: 204 even when nobody is signed in.
  const cookie = store.refreshCookie;
  if (cookie) {
    const claims = readToken(cookie);
    const user = claims ? store.users.find((u) => String(u.id) === claims.sub) : undefined;
    // Bumping token_version retires every outstanding refresh token at once.
    if (user) user.token_version += 1;
  }
  store.refreshCookie = null;
  return noContent();
}

function handleListExpenses(ctx: RequestContext, user: MockUser): Response {
  const monthParam = ctx.url.searchParams.get('month');
  if (monthParam !== null && !isValidMonth(monthParam)) {
    return fail(400, 'Invalid month format. Expected YYYY-MM.');
  }
  const categoryParam = ctx.url.searchParams.get('category');
  if (categoryParam !== null && !CATEGORY_KEYS.has(categoryParam)) {
    return fail(422, `Unknown category '${categoryParam}'.`);
  }

  const limitParam = ctx.url.searchParams.get('limit');
  const limit = limitParam === null ? 50 : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return fail(400, 'limit must be between 1 and 200.');
  }
  const offsetParam = ctx.url.searchParams.get('offset');
  const offset = offsetParam === null ? 0 : Number(offsetParam);
  if (!Number.isInteger(offset) || offset < 0) {
    return fail(400, 'offset must be 0 or greater.');
  }

  const matched = store.expenses
    .filter((e) => e.user_id === user.id)
    .filter((e) => monthParam === null || monthOf(e.date) === monthParam)
    .filter((e) => categoryParam === null || e.category === categoryParam)
    // Ordering: date DESC, then id DESC. Stable and mandatory.
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));

  const body: ExpenseListResponse = {
    expenses: matched.slice(offset, offset + limit).map(publicExpense),
    total: matched.length,
    limit,
    offset,
  };
  return json(200, body);
}

function handleCreateExpense(ctx: RequestContext, user: MockUser): Response {
  const { amount_minor: amount, category, date } = ctx.body;

  if (!isPositiveInteger(amount)) return fail(422, 'amount_minor must be greater than 0.');
  if (amount > MAX_AMOUNT_MINOR) return fail(422, 'amount_minor is too large.');
  if (typeof category !== 'string' || !CATEGORY_KEYS.has(category)) {
    return fail(422, `Unknown category '${String(category)}'.`);
  }
  if (!isValidDate(date)) return fail(422, 'date must be a valid calendar date (YYYY-MM-DD).');
  const note = normaliseNote(ctx.body.note);
  if (!note.ok) return fail(422, note.error);

  const timestamp = isoNow();
  const expense: MockExpense = {
    id: store.nextExpenseId++,
    user_id: user.id,
    amount_minor: amount,
    category,
    date,
    note: note.note,
    created_at: timestamp,
    updated_at: timestamp,
  };
  store.expenses.push(expense);
  return json(201, publicExpense(expense));
}

function handlePatchExpense(ctx: RequestContext, user: MockUser, id: number): Response {
  // Ownership is part of the lookup, so another user's row is indistinguishable
  // from a row that does not exist: 404, never 403.
  const expense = store.expenses.find((e) => e.id === id && e.user_id === user.id);
  if (!expense) return fail(404, EXPENSE_NOT_FOUND);

  if ('amount_minor' in ctx.body) {
    const amount = ctx.body.amount_minor;
    if (!isPositiveInteger(amount)) return fail(422, 'amount_minor must be greater than 0.');
    if (amount > MAX_AMOUNT_MINOR) return fail(422, 'amount_minor is too large.');
    expense.amount_minor = amount;
  }
  if ('category' in ctx.body) {
    const category = ctx.body.category;
    if (typeof category !== 'string' || !CATEGORY_KEYS.has(category)) {
      return fail(422, `Unknown category '${String(category)}'.`);
    }
    expense.category = category;
  }
  if ('date' in ctx.body) {
    const date = ctx.body.date;
    if (!isValidDate(date)) return fail(422, 'date must be a valid calendar date (YYYY-MM-DD).');
    expense.date = date;
  }
  if ('note' in ctx.body) {
    const note = normaliseNote(ctx.body.note);
    if (!note.ok) return fail(422, note.error);
    expense.note = note.note;
  }

  expense.updated_at = isoNow();
  return json(200, publicExpense(expense));
}

function handleDeleteExpense(user: MockUser, id: number): Response {
  const index = store.expenses.findIndex((e) => e.id === id && e.user_id === user.id);
  if (index === -1) return fail(404, EXPENSE_NOT_FOUND);
  store.expenses.splice(index, 1);
  return noContent();
}

function handleListBudgets(month: IsoMonth, user: MockUser): Response {
  const budgets: Budget[] = budgetsFor(user.id, month)
    // Contract 2 order, not alphabetical, so the settings UI is stable.
    .sort((a, b) => categoryRank(a.category) - categoryRank(b.category))
    .map((b) => ({ category: b.category, limit_minor: b.limit_minor }));
  const body: BudgetListResponse = { month, budgets };
  return json(200, body);
}

function handleUpsertBudget(ctx: RequestContext, user: MockUser): Response {
  const { month, category, limit_minor: limit } = ctx.body;

  if (!isValidMonth(month)) return fail(400, 'Invalid month format. Expected YYYY-MM.');
  if (typeof category !== 'string' || !CATEGORY_KEYS.has(category)) {
    return fail(422, `Unknown category '${String(category)}'.`);
  }
  if (!isPositiveInteger(limit)) return fail(422, 'limit_minor must be greater than 0.');
  if (limit > MAX_AMOUNT_MINOR) return fail(422, 'limit_minor is too large.');

  // UNIQUE (user_id, category, month) is what makes this a real upsert.
  const existing = store.budgets.find(
    (b) => b.user_id === user.id && b.month === month && b.category === category,
  );
  if (existing) existing.limit_minor = limit;
  else store.budgets.push({ user_id: user.id, month, category, limit_minor: limit });

  const body: BudgetUpsertResult = { month, category, limit_minor: limit };
  return json(200, body);
}

function handleDeleteBudget(user: MockUser, month: string, category: string): Response {
  const index = store.budgets.findIndex(
    (b) => b.user_id === user.id && b.month === month && b.category === category,
  );
  if (index === -1) return fail(404, 'No budget set for that category and month.');
  store.budgets.splice(index, 1);
  return noContent();
}

function handleMonthly(ctx: RequestContext, user: MockUser): Response {
  const monthsParam = ctx.url.searchParams.get('months');
  const months = monthsParam === null ? 6 : Number(monthsParam);
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    return fail(400, 'months must be between 1 and 24.');
  }
  return json(200, buildMonthly(user.id, months));
}

/* -------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------- */

const EXPENSE_ID_RE = /^\/api\/expenses\/(\d+)$/;
const BUDGET_KEY_RE = /^\/api\/budgets\/([^/]+)\/([^/]+)$/;

function route(ctx: RequestContext): Response {
  const { pathname } = ctx.url;
  const { method } = ctx;

  /* --- Contract 2: public, static --- */
  if (pathname === '/api/categories' && method === 'GET') {
    const body: CategoriesResponse = { categories: [...CATEGORIES] };
    return json(200, body);
  }

  /* --- Contract 1: public auth --- */
  if (pathname === '/api/auth/signup' && method === 'POST') return handleSignup(ctx);
  if (pathname === '/api/auth/login' && method === 'POST') return handleLogin(ctx);
  if (pathname === '/api/auth/refresh' && method === 'POST') return handleRefresh();
  if (pathname === '/api/auth/logout' && method === 'POST') return handleLogout();

  /* --- Everything below is protected --- */
  const user = requireUser(ctx);
  if (isResponse(user)) return user;

  if (pathname === '/api/auth/me' && method === 'GET') return json(200, publicUser(user));

  if (pathname === '/api/expenses') {
    if (method === 'GET') return handleListExpenses(ctx, user);
    if (method === 'POST') return handleCreateExpense(ctx, user);
  }
  const expenseMatch = EXPENSE_ID_RE.exec(pathname);
  if (expenseMatch?.[1]) {
    const id = Number(expenseMatch[1]);
    if (method === 'PATCH') return handlePatchExpense(ctx, user, id);
    if (method === 'DELETE') return handleDeleteExpense(user, id);
  }

  if (pathname === '/api/budgets') {
    if (method === 'GET') {
      const month = requiredMonth(ctx);
      return isResponse(month) ? month : handleListBudgets(month, user);
    }
    if (method === 'PUT') return handleUpsertBudget(ctx, user);
  }
  const budgetMatch = BUDGET_KEY_RE.exec(pathname);
  if (budgetMatch?.[1] && budgetMatch[2] && method === 'DELETE') {
    return handleDeleteBudget(user, budgetMatch[1], budgetMatch[2]);
  }

  if (pathname === '/api/analytics/summary' && method === 'GET') {
    const month = requiredMonth(ctx);
    return isResponse(month) ? month : json(200, buildSummary(user.id, month));
  }
  if (pathname === '/api/analytics/by-category' && method === 'GET') {
    const month = requiredMonth(ctx);
    return isResponse(month) ? month : json(200, buildByCategory(user.id, month));
  }
  if (pathname === '/api/analytics/monthly' && method === 'GET') return handleMonthly(ctx, user);

  return fail(404, 'That endpoint does not exist.');
}

/* -------------------------------------------------------------------------
 * The fetch-shaped entry point
 * ---------------------------------------------------------------------- */

function readBearer(init: RequestInit): string | null {
  const headers = new Headers(init.headers);
  const value = headers.get('Authorization');
  if (!value?.startsWith('Bearer ')) return null;
  return value.slice('Bearer '.length);
}

function readBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(init.body);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * A drop-in replacement for `fetch`, wired in by `setTransport` when
 * VITE_USE_MOCKS is "true". Everything above it in the client is untouched.
 */
export async function mockFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
  // A relative path is normal here; the base is only needed to parse it.
  const url = new URL(input, 'http://mock.ledgerlite.local');
  return route({
    url,
    method: (init.method ?? 'GET').toUpperCase(),
    body: readBody(init),
    bearer: readBearer(init),
  });
}

/* -------------------------------------------------------------------------
 * Demo fixture
 * ---------------------------------------------------------------------- */

export const DEMO_EMAIL = 'demo@ledgerlite.app';
export const DEMO_PASSWORD = 'demo1234';

/**
 * A believable six months of spending, so the mocked app demonstrates real
 * charts rather than three empty states. Deterministic: no randomness, so the
 * same build always renders the same dashboard.
 */
function seedDemoAccount(): void {
  const user: MockUser = {
    id: store.nextUserId++,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    created_at: isoNow(),
    token_version: 1,
  };
  store.users.push(user);

  const current = currentMonthUtc();
  // [month offset, category, amount in naira, day of month, note]
  const rows: Array<[number, CategoryKey, number, number, string | null]> = [
    [0, 'food', 18500, 2, 'Weekly market run'],
    [0, 'food', 6200, 9, 'Groceries'],
    [0, 'food', 4750, 16, null],
    [0, 'transport', 12000, 3, 'Fuel'],
    [0, 'transport', 3500, 11, 'Ride to the office'],
    [0, 'housing', 145000, 1, 'Rent instalment'],
    [0, 'utilities', 21000, 5, 'Electricity units'],
    [0, 'utilities', 15500, 6, 'Internet'],
    [0, 'health', 9800, 12, 'Pharmacy'],
    [0, 'entertainment', 7500, 14, 'Cinema'],
    [0, 'shopping', 34000, 8, 'Running shoes'],
    [0, 'education', 25000, 4, 'Course fee'],
    [0, 'savings', 50000, 1, 'Monthly transfer'],
    [1, 'food', 29400, 6, null],
    [1, 'transport', 14200, 9, null],
    [1, 'housing', 145000, 1, 'Rent instalment'],
    [1, 'utilities', 19800, 5, null],
    [1, 'entertainment', 12400, 21, 'Concert'],
    [1, 'shopping', 8900, 17, null],
    [1, 'savings', 50000, 1, 'Monthly transfer'],
    [2, 'food', 31200, 7, null],
    [2, 'transport', 9100, 12, null],
    [2, 'housing', 145000, 1, 'Rent instalment'],
    [2, 'utilities', 22600, 5, null],
    [2, 'health', 42000, 19, 'Dental'],
    [2, 'savings', 40000, 1, 'Monthly transfer'],
    [3, 'food', 26800, 4, null],
    [3, 'transport', 11500, 8, null],
    [3, 'housing', 140000, 1, 'Rent instalment'],
    [3, 'utilities', 18300, 5, null],
    [3, 'education', 60000, 15, 'Certification'],
    [4, 'food', 24100, 3, null],
    [4, 'transport', 10400, 10, null],
    [4, 'housing', 140000, 1, 'Rent instalment'],
    [4, 'shopping', 15600, 22, null],
    [5, 'food', 22900, 5, null],
    [5, 'housing', 140000, 1, 'Rent instalment'],
    [5, 'entertainment', 6800, 18, null],
  ];

  for (const [offset, category, naira, day, note] of rows) {
    const month = shiftMonth(current, -offset);
    store.expenses.push({
      id: store.nextExpenseId++,
      user_id: user.id,
      amount_minor: naira * 100,
      category,
      date: `${month}-${String(day).padStart(2, '0')}`,
      note,
      created_at: isoNow(),
      updated_at: isoNow(),
    });
  }

  // Current-month budgets, deliberately including one untouched category
  // ("other", zero spend) and one blown budget ("shopping"), so the inclusion
  // rule and the over-budget state are both visible on first load.
  const budgets: Array<[CategoryKey, number]> = [
    ['food', 35000],
    ['transport', 18000],
    ['housing', 150000],
    ['utilities', 30000],
    ['health', 20000],
    ['entertainment', 15000],
    ['shopping', 25000],
    ['other', 10000],
  ];
  for (const [category, naira] of budgets) {
    store.budgets.push({
      user_id: user.id,
      month: current,
      category,
      limit_minor: naira * 100,
    });
  }
  for (const [category, naira] of budgets.slice(0, 5)) {
    store.budgets.push({
      user_id: user.id,
      month: shiftMonth(current, -1),
      category,
      limit_minor: naira * 100,
    });
  }
}

resetMockBackend();
