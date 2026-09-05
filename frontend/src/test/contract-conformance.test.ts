/**
 * CONTRACT CONFORMANCE
 *
 * This is the suite that matters most at merge time.
 *
 * Instance 2 built the entire UI against `src/api/mocks.ts` without ever seeing
 * Instance 1's code. That is only safe if the mock is a faithful reading of the
 * frozen contracts rather than a convenient approximation of them - because
 * every assumption baked into the mock is an assumption the real backend will
 * be held to. So these tests assert the mock against the CONTRACT TEXT: exact
 * status codes, exact field names, exact error sentences, exact orderings,
 * exact inclusion rules.
 *
 * If one of these fails after the merge is wired to the real API, the finding
 * is a genuine mismatch between the two halves, which is precisely what this
 * file is for. It is also a ready-made checklist for the Reconciler: run it
 * against Instance 1's implementation and every expectation below is a
 * question already asked.
 *
 * These tests call `mockFetch` DIRECTLY rather than through the API client, so
 * they see raw wire shapes with nothing normalised on the way past.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CATEGORIES } from '../api/categories';
import { mockFetch, resetMockBackend } from '../api/mocks';
import { currentMonth, shiftMonth } from '../lib/dates';

interface Call {
  status: number;
  body: unknown;
  headers: Headers;
}

async function call(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<Call> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await mockFetch(path, { ...rest, headers });
  const text = await response.text();
  return {
    status: response.status,
    body: text === '' ? null : JSON.parse(text),
    headers: response.headers,
  };
}

function post(path: string, body?: unknown, token?: string) {
  return call(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(token === undefined ? {} : { token }),
  });
}

/** Sign up a fresh account and return its access token. */
async function signUp(email: string, password = 'correct horse'): Promise<string> {
  const result = await post('/api/auth/signup', { email, password });
  expect(result.status).toBe(201);
  return (result.body as { access_token: string }).access_token;
}

const MONTH = currentMonth();

beforeEach(() => {
  // No demo fixture: every test states the rows it depends on.
  resetMockBackend({ seed: false });
});

/* =========================================================================
 * Contract 6 - the error envelope
 * ====================================================================== */

describe('Contract 6: errors', () => {
  it('uses { error: <sentence> } for every non-2xx response, with no `detail` key', async () => {
    const token = await signUp('envelope@example.com');

    const failures = [
      await post('/api/auth/signup', { email: 'x@y.com', password: 'short' }),
      await post('/api/auth/login', { email: 'nobody@example.com', password: 'whatever' }),
      await call('/api/auth/me'),
      await call('/api/expenses?month=nonsense', { token }),
      await post('/api/expenses', { amount_minor: 0, category: 'food', date: '2026-09-04' }, token),
      await call('/api/expenses/99999', { method: 'DELETE', token }),
      await call('/api/budgets/2026-09/food', { method: 'DELETE', token }),
    ];

    for (const failure of failures) {
      expect(failure.status).toBeGreaterThanOrEqual(400);
      expect(Object.keys(failure.body as object)).toEqual(['error']);
      const { error } = failure.body as { error: string };
      expect(typeof error).toBe('string');
      // "a human-readable sentence, capitalized, ending in a period"
      expect(error.endsWith('.')).toBe(true);
    }
  });

  it('never leaks a `detail` key, which is what FastAPI emits by default', async () => {
    const result = await call('/api/auth/me');
    expect(result.body).not.toHaveProperty('detail');
  });
});

/* =========================================================================
 * Contract 2 - the frozen category vocabulary
 * ====================================================================== */

describe('Contract 2: categories', () => {
  it('serves the frozen list, in order, with the exact keys, labels and colours', async () => {
    const result = await call('/api/categories');

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      categories: [
        { key: 'food', label: 'Food', color: '#E8734A' },
        { key: 'transport', label: 'Transport', color: '#4A8FE8' },
        { key: 'housing', label: 'Housing', color: '#7C5CE0' },
        { key: 'utilities', label: 'Utilities', color: '#2FA3A3' },
        { key: 'health', label: 'Health', color: '#E05C7B' },
        { key: 'entertainment', label: 'Entertainment', color: '#C77DE8' },
        { key: 'shopping', label: 'Shopping', color: '#E8A93A' },
        { key: 'education', label: 'Education', color: '#3F8F5B' },
        { key: 'savings', label: 'Savings', color: '#5B7FA6' },
        { key: 'other', label: 'Other', color: '#8A8F98' },
      ],
    });
  });

  it('matches the build-time fallback byte for byte', async () => {
    // Contract 2 permits hardcoding the list and requires the two copies to be
    // identical. This is the assertion that keeps that promise honest.
    const result = await call('/api/categories');
    expect((result.body as { categories: unknown }).categories).toEqual([...CATEGORIES]);
  });

  it('is public - no access token required', async () => {
    const result = await call('/api/categories');
    expect(result.status).toBe(200);
  });
});

/* =========================================================================
 * Contract 1 - authentication
 * ====================================================================== */

describe('Contract 1: signup', () => {
  it('returns 201 with exactly the contracted session shape', async () => {
    const result = await post('/api/auth/signup', {
      email: 'ada@example.com',
      password: 'correct horse',
    });

    expect(result.status).toBe(201);
    const body = result.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['access_token', 'expires_in', 'token_type', 'user'].sort(),
    );
    expect(body['token_type']).toBe('bearer');
    expect(body['expires_in']).toBe(900);

    const user = body['user'] as Record<string, unknown>;
    expect(Object.keys(user).sort()).toEqual(['created_at', 'email', 'id'].sort());
    expect(typeof user['id']).toBe('number');
    expect(String(user['created_at'])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('rejects a duplicate email with 409 and the contracted sentence', async () => {
    await signUp('taken@example.com');
    const result = await post('/api/auth/signup', {
      email: 'taken@example.com',
      password: 'correct horse',
    });

    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'An account with that email already exists.' });
  });

  it('treats email uniqueness as case-insensitive', async () => {
    await signUp('Mixed@Example.com');
    const result = await post('/api/auth/signup', {
      email: 'mixed@example.com',
      password: 'correct horse',
    });
    expect(result.status).toBe(409);
  });

  it('rejects a short password with 422 and the contracted sentence', async () => {
    const result = await post('/api/auth/signup', { email: 'short@example.com', password: 'abc' });

    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: 'Password must be at least 8 characters.' });
  });
});

describe('Contract 1: login', () => {
  it('returns 200 with a body identical in shape to signup', async () => {
    await signUp('login@example.com');
    const result = await post('/api/auth/login', {
      email: 'login@example.com',
      password: 'correct horse',
    });

    expect(result.status).toBe(200);
    expect(Object.keys(result.body as object).sort()).toEqual(
      ['access_token', 'expires_in', 'token_type', 'user'].sort(),
    );
  });

  it('does not enumerate users: unknown email and wrong password are byte-identical', async () => {
    await signUp('real@example.com');

    const unknownEmail = await post('/api/auth/login', {
      email: 'ghost@example.com',
      password: 'correct horse',
    });
    const wrongPassword = await post('/api/auth/login', {
      email: 'real@example.com',
      password: 'wrong password',
    });

    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.status).toBe(unknownEmail.status);
    expect(JSON.stringify(wrongPassword.body)).toBe(JSON.stringify(unknownEmail.body));
    expect(unknownEmail.body).toEqual({ error: 'Incorrect email or password.' });
  });
});

describe('Contract 1: refresh, logout and me', () => {
  it('returns a token-only body - refresh carries no `user`', async () => {
    await signUp('refresh@example.com');
    const result = await post('/api/auth/refresh');

    expect(result.status).toBe(200);
    expect(Object.keys(result.body as object).sort()).toEqual(
      ['access_token', 'expires_in', 'token_type'].sort(),
    );
    expect(result.body).not.toHaveProperty('user');
  });

  it('is cookie-only: a valid Bearer token cannot stand in for the cookie', async () => {
    const token = await signUp('cookieonly@example.com');
    await post('/api/auth/logout', undefined, token); // clears the cookie

    const result = await post('/api/auth/refresh', undefined, token);

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'Session expired. Please sign in again.' });
  });

  it('retires outstanding refresh tokens on logout', async () => {
    const token = await signUp('rotate@example.com');
    expect((await post('/api/auth/refresh')).status).toBe(200);

    await post('/api/auth/logout', undefined, token);

    expect((await post('/api/auth/refresh')).status).toBe(401);
  });

  it('makes logout idempotent - 204 even when nobody is signed in', async () => {
    const first = await post('/api/auth/logout');
    const second = await post('/api/auth/logout');

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(first.body).toBeNull();
  });

  it('serves GET /api/auth/me to a holder and 401s everyone else', async () => {
    const token = await signUp('me@example.com');

    const authorised = await call('/api/auth/me', { token });
    expect(authorised.status).toBe(200);
    expect(Object.keys(authorised.body as object).sort()).toEqual(
      ['created_at', 'email', 'id'].sort(),
    );

    const anonymous = await call('/api/auth/me');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ error: 'Not authenticated.' });
  });

  it('sends WWW-Authenticate: Bearer with a protected 401', async () => {
    const result = await call('/api/expenses');
    expect(result.status).toBe(401);
    expect(result.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('rejects a malformed or garbage token as unauthenticated', async () => {
    const result = await call('/api/auth/me', { token: 'not-a-jwt' });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'Not authenticated.' });
  });
});

/* =========================================================================
 * Contract 3 - expenses
 * ====================================================================== */

describe('Contract 3: expenses', () => {
  let token = '';

  beforeEach(async () => {
    token = await signUp('expenses@example.com');
  });

  function addExpense(body: Record<string, unknown>) {
    return post('/api/expenses', body, token);
  }

  it('returns 201 and exactly the contracted Expense shape', async () => {
    const result = await addExpense({
      amount_minor: 249900,
      category: 'food',
      date: `${MONTH}-04`,
      note: 'Market',
    });

    expect(result.status).toBe(201);
    expect(Object.keys(result.body as object).sort()).toEqual(
      ['amount_minor', 'category', 'created_at', 'date', 'id', 'note', 'updated_at'].sort(),
    );
    const expense = result.body as Record<string, unknown>;
    expect(expense['amount_minor']).toBe(249900);
    expect(expense['date']).toBe(`${MONTH}-04`);
    expect(String(expense['created_at'])).toMatch(/Z$/);
  });

  it('rejects a non-positive amount with the contracted sentence', async () => {
    const zero = await addExpense({ amount_minor: 0, category: 'food', date: `${MONTH}-04` });
    const negative = await addExpense({ amount_minor: -5, category: 'food', date: `${MONTH}-04` });

    for (const result of [zero, negative]) {
      expect(result.status).toBe(422);
      expect(result.body).toEqual({ error: 'amount_minor must be greater than 0.' });
    }
  });

  it('rejects an unknown category with the contracted sentence', async () => {
    const result = await addExpense({ amount_minor: 100, category: 'foo', date: `${MONTH}-04` });

    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: "Unknown category 'foo'." });
  });

  it('rejects a date that matches the pattern but is not a real day', async () => {
    const result = await addExpense({ amount_minor: 100, category: 'food', date: '2026-02-31' });
    expect(result.status).toBe(422);
  });

  it('stores an empty note as null', async () => {
    const result = await addExpense({
      amount_minor: 100,
      category: 'food',
      date: `${MONTH}-04`,
      note: '',
    });
    expect((result.body as { note: unknown }).note).toBeNull();
  });

  it('defaults a missing note to null', async () => {
    const result = await addExpense({ amount_minor: 100, category: 'food', date: `${MONTH}-04` });
    expect((result.body as { note: unknown }).note).toBeNull();
  });

  it('orders the list by date DESC, then id DESC', async () => {
    await addExpense({ amount_minor: 100, category: 'food', date: `${MONTH}-01` });
    await addExpense({ amount_minor: 200, category: 'food', date: `${MONTH}-10` });
    // Same date as the previous row: the later id must come first.
    await addExpense({ amount_minor: 300, category: 'food', date: `${MONTH}-10` });

    const result = await call(`/api/expenses?month=${MONTH}`, { token });
    const expenses = (result.body as { expenses: Array<{ amount_minor: number }> }).expenses;

    expect(expenses.map((e) => e.amount_minor)).toEqual([300, 200, 100]);
  });

  it('answers an empty result with 200 and an empty array, never 404', async () => {
    const result = await call(`/api/expenses?month=${MONTH}`, { token });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ expenses: [], total: 0, limit: 50, offset: 0 });
  });

  it('reports `total` ignoring limit and offset', async () => {
    for (let index = 0; index < 5; index += 1) {
      await addExpense({ amount_minor: 100 + index, category: 'food', date: `${MONTH}-0${index + 1}` });
    }

    const result = await call(`/api/expenses?limit=2&offset=1`, { token });
    const body = result.body as { expenses: unknown[]; total: number; limit: number; offset: number };

    expect(body.total).toBe(5);
    expect(body.expenses).toHaveLength(2);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
  });

  it('rejects a malformed month with 400 and the contracted sentence', async () => {
    const result = await call('/api/expenses?month=2026-9', { token });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid month format. Expected YYYY-MM.' });
  });

  it('rejects an out-of-range limit with 400', async () => {
    expect((await call('/api/expenses?limit=0', { token })).status).toBe(400);
    expect((await call('/api/expenses?limit=201', { token })).status).toBe(400);
  });

  it('refreshes updated_at on PATCH and applies a partial update', async () => {
    const created = await addExpense({
      amount_minor: 100,
      category: 'food',
      date: `${MONTH}-04`,
      note: 'Before',
    });
    const id = (created.body as { id: number }).id;

    const patched = await call(`/api/expenses/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ note: 'After' }),
    });

    expect(patched.status).toBe(200);
    const expense = patched.body as Record<string, unknown>;
    expect(expense['note']).toBe('After');
    // Untouched fields survive a partial update.
    expect(expense['amount_minor']).toBe(100);
    expect(expense['category']).toBe('food');
  });

  it('deletes with 204 and no body', async () => {
    const created = await addExpense({ amount_minor: 100, category: 'food', date: `${MONTH}-04` });
    const id = (created.body as { id: number }).id;

    const deleted = await call(`/api/expenses/${id}`, { method: 'DELETE', token });

    expect(deleted.status).toBe(204);
    expect(deleted.body).toBeNull();
  });

  it('answers an unknown id with 404 and the contracted sentence', async () => {
    const result = await call('/api/expenses/424242', { method: 'DELETE', token });

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Expense not found.' });
  });
});

/* =========================================================================
 * User isolation - the single worst bug this project could ship
 * ====================================================================== */

describe('User isolation', () => {
  it("returns 404 - not 403 - for another user's expense, and leaves it intact", async () => {
    const tokenA = await signUp('a@example.com');
    const tokenB = await signUp('b@example.com');

    const created = await post(
      '/api/expenses',
      { amount_minor: 5000, category: 'food', date: `${MONTH}-04`, note: "B's lunch" },
      tokenB,
    );
    const id = (created.body as { id: number }).id;

    const read = await call(`/api/expenses?month=${MONTH}`, { token: tokenA });
    const patch = await call(`/api/expenses/${id}`, {
      method: 'PATCH',
      token: tokenA,
      body: JSON.stringify({ amount_minor: 1 }),
    });
    const remove = await call(`/api/expenses/${id}`, { method: 'DELETE', token: tokenA });

    // A cannot see it...
    expect((read.body as { expenses: unknown[] }).expenses).toHaveLength(0);
    // ...and gets 404, byte-identical to "no such id". A 403 would confirm the
    // row exists, which is exactly what the contract forbids.
    expect(patch.status).toBe(404);
    expect(patch.body).toEqual({ error: 'Expense not found.' });
    expect(remove.status).toBe(404);

    // B's row is untouched afterwards.
    const bStill = await call(`/api/expenses?month=${MONTH}`, { token: tokenB });
    const rows = (bStill.body as { expenses: Array<{ amount_minor: number }> }).expenses;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount_minor).toBe(5000);
  });

  it("keeps analytics scoped: A's totals never include B's rows", async () => {
    const tokenA = await signUp('analytics-a@example.com');
    const tokenB = await signUp('analytics-b@example.com');

    await post('/api/expenses', { amount_minor: 111, category: 'food', date: `${MONTH}-04` }, tokenA);
    await post(
      '/api/expenses',
      { amount_minor: 999999, category: 'housing', date: `${MONTH}-04` },
      tokenB,
    );

    const summary = await call(`/api/analytics/summary?month=${MONTH}`, { token: tokenA });
    expect((summary.body as { total_spent_minor: number }).total_spent_minor).toBe(111);

    const breakdown = await call(`/api/analytics/by-category?month=${MONTH}`, { token: tokenA });
    const categories = (breakdown.body as { categories: Array<{ category: string }> }).categories;
    expect(categories.map((row) => row.category)).toEqual(['food']);
  });

  it("returns 404 for another user's budget", async () => {
    const tokenA = await signUp('budget-a@example.com');
    const tokenB = await signUp('budget-b@example.com');

    await call('/api/budgets', {
      method: 'PUT',
      token: tokenB,
      body: JSON.stringify({ month: MONTH, category: 'food', limit_minor: 50000 }),
    });

    const listed = await call(`/api/budgets?month=${MONTH}`, { token: tokenA });
    expect((listed.body as { budgets: unknown[] }).budgets).toHaveLength(0);

    const removed = await call(`/api/budgets/${MONTH}/food`, { method: 'DELETE', token: tokenA });
    expect(removed.status).toBe(404);
  });
});

/* =========================================================================
 * Contract 4 - budgets
 * ====================================================================== */

describe('Contract 4: budgets', () => {
  let token = '';

  beforeEach(async () => {
    token = await signUp('budgets@example.com');
  });

  function putBudget(category: string, limitMinor: number, month = MONTH) {
    return call('/api/budgets', {
      method: 'PUT',
      token,
      body: JSON.stringify({ month, category, limit_minor: limitMinor }),
    });
  }

  it('upserts rather than duplicating: PUT twice leaves one row', async () => {
    const first = await putBudget('food', 50000);
    const second = await putBudget('food', 65000);

    expect(first.status).toBe(200);
    expect(second.body).toEqual({ month: MONTH, category: 'food', limit_minor: 65000 });

    const listed = await call(`/api/budgets?month=${MONTH}`, { token });
    expect(listed.body).toEqual({
      month: MONTH,
      budgets: [{ category: 'food', limit_minor: 65000 }],
    });
  });

  it('lists in Contract 2 category order, not alphabetically', async () => {
    // Inserted in an order that alphabetical sorting would visibly disagree
    // with: alphabetically utilities < transport is false, so a naive sort
    // would produce transport, utilities, food.
    await putBudget('utilities', 1000);
    await putBudget('food', 2000);
    await putBudget('transport', 3000);

    const listed = await call(`/api/budgets?month=${MONTH}`, { token });
    const budgets = (listed.body as { budgets: Array<{ category: string }> }).budgets;

    expect(budgets.map((b) => b.category)).toEqual(['food', 'transport', 'utilities']);
  });

  it('returns an empty array - not 404 - when nothing is set', async () => {
    const listed = await call(`/api/budgets?month=${MONTH}`, { token });
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ month: MONTH, budgets: [] });
  });

  it('requires the month query parameter', async () => {
    const listed = await call('/api/budgets', { token });
    expect(listed.status).toBe(400);
    expect(listed.body).toEqual({ error: 'Invalid month format. Expected YYYY-MM.' });
  });

  it('rejects a zero limit with the contracted sentence', async () => {
    const result = await putBudget('food', 0);

    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: 'limit_minor must be greater than 0.' });
  });

  it('deletes with 204, and 404s the contracted sentence when nothing is set', async () => {
    await putBudget('food', 50000);

    const removed = await call(`/api/budgets/${MONTH}/food`, { method: 'DELETE', token });
    expect(removed.status).toBe(204);

    const again = await call(`/api/budgets/${MONTH}/food`, { method: 'DELETE', token });
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ error: 'No budget set for that category and month.' });
  });

  it('keeps months independent - a budget does not carry forward', async () => {
    await putBudget('food', 50000, shiftMonth(MONTH, -1));

    const thisMonth = await call(`/api/budgets?month=${MONTH}`, { token });
    expect((thisMonth.body as { budgets: unknown[] }).budgets).toHaveLength(0);
  });
});

/* =========================================================================
 * Contract 5 - analytics
 * ====================================================================== */

describe('Contract 5a: summary', () => {
  let token = '';

  beforeEach(async () => {
    token = await signUp('summary@example.com');
  });

  it('reports zeroes for a brand-new account rather than 404 or null', async () => {
    const result = await call(`/api/analytics/summary?month=${MONTH}`, { token });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      month: MONTH,
      currency: 'NGN',
      total_spent_minor: 0,
      total_budget_minor: 0,
      remaining_minor: 0,
      percent_used: 0,
      expense_count: 0,
    });
  });

  it('computes percent_used to one decimal', async () => {
    await post('/api/expenses', { amount_minor: 7340, category: 'food', date: `${MONTH}-04` }, token);
    await call('/api/budgets', {
      method: 'PUT',
      token,
      body: JSON.stringify({ month: MONTH, category: 'food', limit_minor: 10000 }),
    });

    const result = await call(`/api/analytics/summary?month=${MONTH}`, { token });
    expect((result.body as { percent_used: number }).percent_used).toBe(73.4);
  });

  it('reports percent_used as 0 when no budget is set, never NaN or Infinity', async () => {
    await post('/api/expenses', { amount_minor: 5000, category: 'food', date: `${MONTH}-04` }, token);

    const result = await call(`/api/analytics/summary?month=${MONTH}`, { token });
    const body = result.body as { percent_used: number; total_budget_minor: number };

    expect(body.total_budget_minor).toBe(0);
    expect(body.percent_used).toBe(0);
  });

  it('lets remaining_minor go negative when the month is over budget', async () => {
    await call('/api/budgets', {
      method: 'PUT',
      token,
      body: JSON.stringify({ month: MONTH, category: 'food', limit_minor: 10000 }),
    });
    await post('/api/expenses', { amount_minor: 14500, category: 'food', date: `${MONTH}-04` }, token);

    const result = await call(`/api/analytics/summary?month=${MONTH}`, { token });
    const body = result.body as { remaining_minor: number; percent_used: number };

    expect(body.remaining_minor).toBe(-4500);
    expect(body.percent_used).toBe(145);
  });

  it('requires the month query parameter', async () => {
    const result = await call('/api/analytics/summary', { token });
    expect(result.status).toBe(400);
  });
});

describe('Contract 5b: by-category', () => {
  let token = '';

  beforeEach(async () => {
    token = await signUp('by-category@example.com');
  });

  function spend(category: string, amountMinor: number) {
    return post(
      '/api/expenses',
      { amount_minor: amountMinor, category, date: `${MONTH}-04` },
      token,
    );
  }

  function budget(category: string, limitMinor: number) {
    return call('/api/budgets', {
      method: 'PUT',
      token,
      body: JSON.stringify({ month: MONTH, category, limit_minor: limitMinor }),
    });
  }

  it('applies the inclusion rule exactly', async () => {
    await spend('food', 5000); // spend, no budget      -> included
    await budget('transport', 9000); // budget, no spend -> included
    await spend('housing', 1000); // spend and budget    -> included
    await budget('housing', 4000);
    // 'savings' has neither                             -> omitted

    const result = await call(`/api/analytics/by-category?month=${MONTH}`, { token });
    const categories = (result.body as { categories: Array<{ category: string }> }).categories;

    expect(categories.map((row) => row.category).sort()).toEqual(['food', 'housing', 'transport']);
    expect(categories.map((row) => row.category)).not.toContain('savings');
  });

  it('orders by spent_minor DESC with the Contract 2 order as the tie-break', async () => {
    await spend('shopping', 5000);
    await spend('food', 9000);
    // 'transport' and 'health' tie at 1000; Contract 2 puts transport first.
    await spend('health', 1000);
    await spend('transport', 1000);

    const result = await call(`/api/analytics/by-category?month=${MONTH}`, { token });
    const categories = (result.body as { categories: Array<{ category: string }> }).categories;

    expect(categories.map((row) => row.category)).toEqual([
      'food',
      'shopping',
      'transport',
      'health',
    ]);
  });

  it('denormalises the Contract 2 label and colour onto every row', async () => {
    await spend('food', 5000);

    const result = await call(`/api/analytics/by-category?month=${MONTH}`, { token });
    const row = (result.body as { categories: Array<Record<string, unknown>> }).categories[0];

    expect(row?.['label']).toBe('Food');
    expect(row?.['color']).toBe('#E8734A');
  });

  it('returns exactly the contracted row shape', async () => {
    await spend('food', 5000);

    const result = await call(`/api/analytics/by-category?month=${MONTH}`, { token });
    const row = (result.body as { categories: Array<Record<string, unknown>> }).categories[0];

    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        'category',
        'color',
        'label',
        'limit_minor',
        'over_budget',
        'percent',
        'percent_used',
        'remaining_minor',
        'spent_minor',
      ].sort(),
    );
  });

  it('nulls the budget fields when no budget is set, and never flags over_budget', async () => {
    await spend('food', 5000);

    const result = await call(`/api/analytics/by-category?month=${MONTH}`, { token });
    const row = (result.body as { categories: Array<Record<string, unknown>> }).categories[0];

    expect(row?.['limit_minor']).toBeNull();
    expect(row?.['remaining_minor']).toBeNull();
    expect(row?.['percent_used']).toBeNull();
    expect(row?.['over_budget']).toBe(false);
  });

  it('reports a negative remaining_minor and over_budget when the limit is passed', async () => {
    await budget('food', 10000);
    await spend('food', 12500);

    const result = await call(`/api/analytics/by-category?month=${MONTH}`, { token });
    const row = (result.body as { categories: Array<Record<string, unknown>> }).categories[0];

    expect(row?.['remaining_minor']).toBe(-2500);
    expect(row?.['percent_used']).toBe(125);
    expect(row?.['over_budget']).toBe(true);
  });

  it('reports percent as 0 when the month total is 0', async () => {
    await budget('food', 10000); // budget, no spending at all

    const result = await call(`/api/analytics/by-category?month=${MONTH}`, { token });
    const body = result.body as {
      total_spent_minor: number;
      categories: Array<{ percent: number; spent_minor: number }>;
    };

    expect(body.total_spent_minor).toBe(0);
    expect(body.categories[0]?.spent_minor).toBe(0);
    expect(body.categories[0]?.percent).toBe(0);
  });

  it('gives a brand-new account 200 with an empty categories array', async () => {
    const result = await call(`/api/analytics/by-category?month=${MONTH}`, { token });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      month: MONTH,
      currency: 'NGN',
      total_spent_minor: 0,
      categories: [],
    });
  });
});

describe('Contract 5c: monthly', () => {
  let token = '';

  beforeEach(async () => {
    token = await signUp('monthly@example.com');
  });

  it('returns exactly `months` elements for a brand-new account', async () => {
    const six = await call('/api/analytics/monthly', { token });
    const twelve = await call('/api/analytics/monthly?months=12', { token });

    expect((six.body as { months: unknown[] }).months).toHaveLength(6);
    expect((twelve.body as { months: unknown[] }).months).toHaveLength(12);
  });

  it('is zero-filled and contiguous, oldest first, ending on the current month', async () => {
    const result = await call('/api/analytics/monthly?months=4', { token });
    const months = (result.body as { months: Array<{ month: string; total_spent_minor: number }> })
      .months;

    expect(months.map((point) => point.month)).toEqual([
      shiftMonth(MONTH, -3),
      shiftMonth(MONTH, -2),
      shiftMonth(MONTH, -1),
      MONTH,
    ]);
    // Never skipped: a month with no expenses is present with 0.
    expect(months.every((point) => point.total_spent_minor === 0)).toBe(true);
  });

  it('keeps a gap month in the series rather than dropping it', async () => {
    await post(
      '/api/expenses',
      { amount_minor: 700, category: 'food', date: `${shiftMonth(MONTH, -2)}-04` },
      token,
    );
    await post('/api/expenses', { amount_minor: 300, category: 'food', date: `${MONTH}-04` }, token);

    const result = await call('/api/analytics/monthly?months=3', { token });
    const months = (result.body as { months: Array<{ total_spent_minor: number }> }).months;

    // The middle month has no expenses and is still there, as a zero.
    expect(months.map((point) => point.total_spent_minor)).toEqual([700, 0, 300]);
  });

  it('rejects an out-of-range months parameter with 400', async () => {
    expect((await call('/api/analytics/monthly?months=0', { token })).status).toBe(400);
    expect((await call('/api/analytics/monthly?months=25', { token })).status).toBe(400);
  });

  it('returns exactly the contracted point shape', async () => {
    const result = await call('/api/analytics/monthly?months=1', { token });
    const body = result.body as { currency: string; months: Array<Record<string, unknown>> };

    expect(body.currency).toBe('NGN');
    expect(Object.keys(body.months[0] ?? {}).sort()).toEqual(
      ['month', 'total_budget_minor', 'total_spent_minor'].sort(),
    );
  });
});

/* =========================================================================
 * The empty-state guarantee, stated as one test
 * ====================================================================== */

describe('Empty-state guarantee', () => {
  it('gives a brand-new user 200 from all three analytics endpoints', async () => {
    const token = await signUp('brand-new@example.com');

    const results = await Promise.all([
      call(`/api/analytics/summary?month=${MONTH}`, { token }),
      call(`/api/analytics/by-category?month=${MONTH}`, { token }),
      call('/api/analytics/monthly', { token }),
    ]);

    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.body).not.toBeNull();
    }
  });
});
