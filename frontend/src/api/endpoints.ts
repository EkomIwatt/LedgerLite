/**
 * The typed call surface for Contracts 1-5. Every network path in the app goes
 * through exactly one function here, so a contract change has exactly one place
 * to land and components never assemble a URL themselves.
 */
import { apiJson, apiVoid } from './client';
import type {
  AnalyticsByCategory,
  AnalyticsMonthly,
  AnalyticsSummary,
  AuthSession,
  BudgetListResponse,
  BudgetUpsert,
  BudgetUpsertResult,
  CategoriesResponse,
  CategoryKey,
  Credentials,
  Expense,
  ExpenseCreate,
  ExpenseListResponse,
  ExpenseQuery,
  ExpenseUpdate,
  IsoMonth,
  User,
} from './types';

/* -------------------------------------------------------------------------
 * Contract 1 - Authentication
 * ---------------------------------------------------------------------- */

/** 201 + Set-Cookie. 409 if the email is taken, 422 if the password is short. */
export function signup(credentials: Credentials, signal?: AbortSignal): Promise<AuthSession> {
  return apiJson<AuthSession>('/api/auth/signup', {
    method: 'POST',
    body: credentials,
    auth: false,
    ...(signal ? { signal } : {}),
  });
}

/** 200 + Set-Cookie. 401 "Incorrect email or password." for BOTH failure modes. */
export function login(credentials: Credentials, signal?: AbortSignal): Promise<AuthSession> {
  return apiJson<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: credentials,
    auth: false,
    ...(signal ? { signal } : {}),
  });
}

/**
 * 204, idempotent, clears the cookie. The access token is optional here and is
 * attached only if we happen to hold one.
 */
export function logout(): Promise<void> {
  return apiVoid('/api/auth/logout', { method: 'POST' });
}

/**
 * The authenticated user. Called after a boot-time refresh, because
 * POST /api/auth/refresh returns a token only - it carries no `user` object.
 */
export function getMe(signal?: AbortSignal): Promise<User> {
  return apiJson<User>('/api/auth/me', signal ? { signal } : {});
}

/* -------------------------------------------------------------------------
 * Contract 2 - Categories
 * ---------------------------------------------------------------------- */

/** Public, static, cacheable. `src/api/categories.ts` is the local fallback. */
export function getCategories(signal?: AbortSignal): Promise<CategoriesResponse> {
  return apiJson<CategoriesResponse>('/api/categories', {
    auth: false,
    ...(signal ? { signal } : {}),
  });
}

/* -------------------------------------------------------------------------
 * Contract 3 - Expenses
 * ---------------------------------------------------------------------- */

export function listExpenses(
  query: ExpenseQuery = {},
  signal?: AbortSignal,
): Promise<ExpenseListResponse> {
  return apiJson<ExpenseListResponse>('/api/expenses', {
    query: {
      month: query.month,
      category: query.category,
      limit: query.limit,
      offset: query.offset,
    },
    ...(signal ? { signal } : {}),
  });
}

export function createExpense(input: ExpenseCreate): Promise<Expense> {
  return apiJson<Expense>('/api/expenses', { method: 'POST', body: input });
}

export function updateExpense(id: number, patch: ExpenseUpdate): Promise<Expense> {
  return apiJson<Expense>(`/api/expenses/${id}`, { method: 'PATCH', body: patch });
}

/** 204. 404 for an unknown id AND for one owned by another user - by design. */
export function deleteExpense(id: number): Promise<void> {
  return apiVoid(`/api/expenses/${id}`, { method: 'DELETE' });
}

/* -------------------------------------------------------------------------
 * Contract 4 - Budgets
 * ---------------------------------------------------------------------- */

/** `month` is REQUIRED by the contract, so it is a required argument here. */
export function listBudgets(month: IsoMonth, signal?: AbortSignal): Promise<BudgetListResponse> {
  return apiJson<BudgetListResponse>('/api/budgets', {
    query: { month },
    ...(signal ? { signal } : {}),
  });
}

/** Upsert. `limit_minor` must be >= 1 - to remove a budget, DELETE it. */
export function upsertBudget(input: BudgetUpsert): Promise<BudgetUpsertResult> {
  return apiJson<BudgetUpsertResult>('/api/budgets', { method: 'PUT', body: input });
}

export function deleteBudget(month: IsoMonth, category: CategoryKey): Promise<void> {
  return apiVoid(`/api/budgets/${month}/${category}`, { method: 'DELETE' });
}

/* -------------------------------------------------------------------------
 * Contract 5 - Analytics
 *
 * All aggregation happens server-side. Nothing downstream of these three calls
 * sums, buckets, zero-fills or computes a percentage.
 * ---------------------------------------------------------------------- */

export function getSummary(month: IsoMonth, signal?: AbortSignal): Promise<AnalyticsSummary> {
  return apiJson<AnalyticsSummary>('/api/analytics/summary', {
    query: { month },
    ...(signal ? { signal } : {}),
  });
}

export function getByCategory(month: IsoMonth, signal?: AbortSignal): Promise<AnalyticsByCategory> {
  return apiJson<AnalyticsByCategory>('/api/analytics/by-category', {
    query: { month },
    ...(signal ? { signal } : {}),
  });
}

/** `months` is 1..24, default 6. The result is zero-filled and contiguous. */
export function getMonthly(months?: number, signal?: AbortSignal): Promise<AnalyticsMonthly> {
  return apiJson<AnalyticsMonthly>('/api/analytics/monthly', {
    query: { months },
    ...(signal ? { signal } : {}),
  });
}
