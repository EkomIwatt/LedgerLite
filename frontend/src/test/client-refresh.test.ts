/**
 * The Contract 1 refresh dance.
 *
 * This is the part of the frontend that cannot be eyeballed: it is timing and
 * bookkeeping, and every failure mode it guards against looks fine until a
 * token expires in production. Each test below is one clause of the contract:
 *
 *   - one refresh, one retry, never a loop
 *   - concurrent 401s share a SINGLE in-flight refresh
 *   - a failed refresh clears state and notifies, so the app routes to /login
 *   - /api/auth/* is sent with credentials: "include"
 *   - a 401 from /api/auth/* never triggers an automatic refresh
 *
 * The transport is stubbed rather than mocked at the module level, so the real
 * client code - headers, credentials, refresh, Contract 6 error parsing - is
 * the code under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiJson,
  apiVoid,
  onSessionExpired,
  refreshSession,
  resetRefreshState,
  setTransport,
} from '../api/client';
import { ApiError, NetworkError } from '../api/errors';
import { clearAccessToken, getAccessToken, setAccessToken } from '../api/tokenStore';

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  credentials: RequestCredentials | undefined;
}

let recorded: Recorded[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Yield to the microtask queue so overlapping requests really do overlap. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function install(handler: (request: Recorded) => Promise<Response> | Response) {
  setTransport(async (input, init) => {
    const request: Recorded = {
      url: input,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      credentials: init.credentials,
    };
    recorded.push(request);
    return handler(request);
  });
}

const refreshCalls = () => recorded.filter((r) => r.url.includes('/api/auth/refresh')).length;

beforeEach(() => {
  recorded = [];
  resetRefreshState();
  clearAccessToken();
});

afterEach(() => {
  setTransport(null);
  resetRefreshState();
  clearAccessToken();
});

describe('refresh on 401', () => {
  it('refreshes once and retries the original request once', async () => {
    setAccessToken('stale');
    install(async (request) => {
      if (request.url.includes('/api/auth/refresh')) {
        return json(200, { access_token: 'fresh', token_type: 'bearer', expires_in: 900 });
      }
      return request.headers.get('Authorization') === 'Bearer fresh'
        ? json(200, { expenses: [], total: 0, limit: 50, offset: 0 })
        : json(401, { error: 'Not authenticated.' });
    });

    const result = await apiJson<{ total: number }>('/api/expenses');

    expect(result.total).toBe(0);
    expect(recorded.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /api/expenses',
      'POST /api/auth/refresh',
      'GET /api/expenses',
    ]);
    expect(getAccessToken()).toBe('fresh');
  });

  it('shares ONE in-flight refresh across concurrent 401s', async () => {
    // The dashboard fires four requests at once. Four parallel refreshes would
    // rotate the cookie out from under each other and end the session.
    setAccessToken('stale');
    install(async (request) => {
      if (request.url.includes('/api/auth/refresh')) {
        await tick();
        return json(200, { access_token: 'fresh', token_type: 'bearer', expires_in: 900 });
      }
      await tick();
      return request.headers.get('Authorization') === 'Bearer fresh'
        ? json(200, { path: request.url })
        : json(401, { error: 'Not authenticated.' });
    });

    const results = await Promise.all([
      apiJson<{ path: string }>('/api/analytics/summary', { query: { month: '2026-09' } }),
      apiJson<{ path: string }>('/api/analytics/by-category', { query: { month: '2026-09' } }),
      apiJson<{ path: string }>('/api/analytics/monthly'),
      apiJson<{ path: string }>('/api/expenses'),
    ]);

    expect(results).toHaveLength(4);
    expect(refreshCalls()).toBe(1);
    // Four originals + one refresh + four retries.
    expect(recorded).toHaveLength(9);
  });

  it('never loops: a 401 on the retry gives up instead of refreshing again', async () => {
    setAccessToken('stale');
    install(async (request) =>
      request.url.includes('/api/auth/refresh')
        ? json(200, { access_token: 'fresh', token_type: 'bearer', expires_in: 900 })
        : json(401, { error: 'Not authenticated.' }),
    );

    await expect(apiJson('/api/expenses')).rejects.toBeInstanceOf(ApiError);

    expect(refreshCalls()).toBe(1);
    expect(recorded).toHaveLength(3);
  });

  it('clears the token and notifies listeners when the refresh itself 401s', async () => {
    setAccessToken('stale');
    install(async (request) =>
      request.url.includes('/api/auth/refresh')
        ? json(401, { error: 'Session expired. Please sign in again.' })
        : json(401, { error: 'Not authenticated.' }),
    );

    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);

    await expect(apiJson('/api/expenses')).rejects.toMatchObject({
      status: 401,
      // The sentence shown is the ORIGINAL request's, not the refresh's.
      message: 'Not authenticated.',
    });

    expect(expired).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    // The original request is not retried after a failed refresh.
    expect(recorded).toHaveLength(2);

    unsubscribe();
  });

  it('does not auto-refresh a 401 from /api/auth/*', async () => {
    // Refreshing in response to a failed login is the loop the contract forbids.
    install(async () => json(401, { error: 'Incorrect email or password.' }));

    await expect(
      apiJson('/api/auth/login', { method: 'POST', body: { email: 'a@b.c', password: 'x' } }),
    ).rejects.toMatchObject({ message: 'Incorrect email or password.' });

    expect(refreshCalls()).toBe(0);
    expect(recorded).toHaveLength(1);
  });

  it('lets a later request refresh again once the first refresh has settled', async () => {
    // Single-flight must not become "one refresh per page load".
    setAccessToken('stale');
    install(async (request) =>
      request.url.includes('/api/auth/refresh')
        ? json(200, { access_token: 'stale', token_type: 'bearer', expires_in: 900 })
        : json(401, { error: 'Not authenticated.' }),
    );

    await expect(apiJson('/api/expenses')).rejects.toBeInstanceOf(ApiError);
    await expect(apiJson('/api/expenses')).rejects.toBeInstanceOf(ApiError);

    expect(refreshCalls()).toBe(2);
  });
});

describe('credentials and headers', () => {
  it('sends credentials: "include" on /api/auth/* and only there', async () => {
    setAccessToken('token');
    install(async () => json(200, {}));

    await apiJson('/api/auth/me');
    await apiJson('/api/expenses');
    await refreshSession();

    const byUrl = new Map(recorded.map((r) => [r.url, r.credentials]));
    expect(byUrl.get('/api/auth/me')).toBe('include');
    expect(byUrl.get('/api/auth/refresh')).toBe('include');
    // The cookie has Path=/api/auth, so anything else has no business asking.
    expect(byUrl.get('/api/expenses')).toBe('same-origin');
  });

  it('attaches the in-memory access token as a Bearer credential', async () => {
    setAccessToken('abc123');
    install(async () => json(200, {}));

    await apiJson('/api/expenses');

    expect(recorded[0]?.headers.get('Authorization')).toBe('Bearer abc123');
  });

  it('omits the Bearer header where the contract says the endpoint is cookie-only', async () => {
    setAccessToken('abc123');
    install(async () => json(200, { access_token: 'x', token_type: 'bearer', expires_in: 900 }));

    await refreshSession();

    expect(recorded[0]?.headers.get('Authorization')).toBeNull();
  });

  it('builds a query string from defined values only', async () => {
    install(async () => json(200, {}));

    await apiJson('/api/expenses', {
      query: { month: '2026-09', category: undefined, limit: 25, offset: 0 },
    });

    expect(recorded[0]?.url).toBe('/api/expenses?month=2026-09&limit=25&offset=0');
  });
});

describe('Contract 6 error handling', () => {
  it('surfaces the server sentence, never a raw object', async () => {
    install(async () => json(422, { error: 'amount_minor must be greater than 0.' }));

    await expect(apiJson('/api/expenses', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 422,
      message: 'amount_minor must be greater than 0.',
    });
  });

  it('falls back to a readable sentence when the body is not the contracted envelope', async () => {
    // A proxy returning HTML, or a backend that has not installed its handlers.
    setTransport(async () => new Response('<html>502 Bad Gateway</html>', { status: 500 }));

    await expect(apiJson('/api/expenses')).rejects.toMatchObject({
      status: 500,
      message: 'Something went wrong.',
    });
  });

  it('reports a transport failure as a NetworkError, not a crash', async () => {
    setTransport(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(apiJson('/api/expenses')).rejects.toBeInstanceOf(NetworkError);
  });

  it('accepts a 204 with no body from a delete', async () => {
    setAccessToken('token');
    install(async () => new Response(null, { status: 204 }));

    await expect(apiVoid('/api/expenses/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
