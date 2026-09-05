/**
 * Wire types transcribed from the FROZEN interface contracts in the root
 * CLAUDE.md. This file is the frontend's only description of the backend.
 *
 * Rules that these types encode, and that the rest of the app relies on:
 *   - Money is ALWAYS an integer number of minor units (kobo). Never a float,
 *     never a string. Every such field carries a `_minor` suffix.
 *   - A calendar date is "YYYY-MM-DD"; a month is "YYYY-MM"; server timestamps
 *     are ISO-8601 UTC with a trailing "Z".
 *   - The client never sends a user id. Ownership comes from the access token.
 *
 * Instance 2 produces none of these shapes — do not "improve" them here.
 * A mismatch with the real backend is an escalation, not a local edit.
 */

/** A calendar date with no time and no timezone, e.g. "2026-09-04". */
export type IsoDate = string;
/** A calendar month, e.g. "2026-09". */
export type IsoMonth = string;
/** An ISO-8601 UTC instant with a trailing Z, e.g. "2026-09-04T10:00:00Z". */
export type IsoDateTime = string;

/** Contract 2 category key, e.g. "food". Kept as a string, not a union: the */
/** server owns this vocabulary and may only change it via an amendment.     */
export type CategoryKey = string;

/* -------------------------------------------------------------------------
 * Contract 6 — the error envelope
 * ---------------------------------------------------------------------- */

/** EVERY non-2xx response from EVERY endpoint has exactly this body. */
export interface ApiErrorBody {
  error: string;
}

/* -------------------------------------------------------------------------
 * Contract 1 — Authentication
 * ---------------------------------------------------------------------- */

export interface User {
  id: number;
  email: string;
  created_at: IsoDateTime;
}

/** Body of POST /api/auth/signup (201) and POST /api/auth/login (200). */
export interface AuthSession {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: User;
}

/** Body of POST /api/auth/refresh (200). Note: no `user` — refresh returns */
/** the token only, so the session's user is carried over or re-fetched.    */
export interface RefreshResult {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
}

export interface Credentials {
  email: string;
  password: string;
}

/* -------------------------------------------------------------------------
 * Contract 2 — Category vocabulary
 * ---------------------------------------------------------------------- */

export interface Category {
  key: CategoryKey;
  label: string;
  /** "#RRGGBB". The authoritative chart palette — never invent a colour. */
  color: string;
}

export interface CategoriesResponse {
  categories: Category[];
}

/* -------------------------------------------------------------------------
 * Contract 3 — Expenses
 * ---------------------------------------------------------------------- */

export interface Expense {
  id: number;
  /** > 0, minor units. */
  amount_minor: number;
  category: CategoryKey;
  date: IsoDate;
  /** <= 500 chars; an empty string is stored as null. */
  note: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ExpenseListResponse {
  expenses: Expense[];
  /** Total matching rows, ignoring limit/offset. */
  total: number;
  limit: number;
  offset: number;
}

export interface ExpenseQuery {
  month?: IsoMonth;
  category?: CategoryKey;
  /** 1..200, default 50. */
  limit?: number;
  /** >= 0, default 0. */
  offset?: number;
}

export interface ExpenseCreate {
  amount_minor: number;
  category: CategoryKey;
  date: IsoDate;
  note?: string | null;
}

/** Any subset of the writable fields. */
export type ExpenseUpdate = Partial<ExpenseCreate>;

/* -------------------------------------------------------------------------
 * Contract 4 — Budgets
 * ---------------------------------------------------------------------- */

export interface Budget {
  category: CategoryKey;
  /** >= 1. To remove a budget use DELETE — never PUT 0. */
  limit_minor: number;
}

export interface BudgetListResponse {
  month: IsoMonth;
  budgets: Budget[];
}

export interface BudgetUpsert {
  month: IsoMonth;
  category: CategoryKey;
  limit_minor: number;
}

/** Body of PUT /api/budgets (200). */
export interface BudgetUpsertResult extends Budget {
  month: IsoMonth;
}

/* -------------------------------------------------------------------------
 * Contract 5 — Analytics
 * ---------------------------------------------------------------------- */

/** 5a — headline numbers: the summary row and the gauge total. */
export interface AnalyticsSummary {
  month: IsoMonth;
  currency: string;
  total_spent_minor: number;
  /** Sum of budgets set for that month; 0 if none. */
  total_budget_minor: number;
  /** total_budget_minor - total_spent_minor. MAY BE NEGATIVE. */
  remaining_minor: number;
  /** One decimal, e.g. 73.4. 0 when total_budget_minor is 0. */
  percent_used: number;
  expense_count: number;
}

/** 5b — one row of the category breakdown. Drives the pie and the gauges. */
export interface CategoryBreakdown {
  category: CategoryKey;
  /** Denormalised from Contract 2 — the frontend need not join. */
  label: string;
  /** Denormalised from Contract 2 — "#RRGGBB". */
  color: string;
  spent_minor: number;
  /** Share of total_spent_minor, one decimal; 0 when the total is 0. */
  percent: number;
  /** null when no budget is set for this category/month. */
  limit_minor: number | null;
  /** limit_minor - spent_minor; null when no budget. MAY BE NEGATIVE. */
  remaining_minor: number | null;
  /** One decimal; null when no budget. May exceed 100. */
  percent_used: number | null;
  /** false when no budget. */
  over_budget: boolean;
}

export interface AnalyticsByCategory {
  month: IsoMonth;
  currency: string;
  total_spent_minor: number;
  categories: CategoryBreakdown[];
}

/** 5c — one bar of the month-over-month chart. */
export interface MonthlyPoint {
  month: IsoMonth;
  total_spent_minor: number;
  total_budget_minor: number;
}

/**
 * The `months` array is ZERO-FILLED and CONTIGUOUS, oldest first, the last
 * element being the current month. Never add client-side gap filling: if a
 * month looks missing that is a contract bug to escalate, not to patch around.
 */
export interface AnalyticsMonthly {
  currency: string;
  months: MonthlyPoint[];
}
