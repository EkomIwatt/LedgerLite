/**
 * The API client: the one place that knows about base URLs, the Contract 6
 * error envelope, credentials, and the Contract 1 refresh dance.
 *
 * The behaviour this file exists to guarantee (Contract 1, frontend obligations):
 *
 *   - A 401 from a NON-/api/auth endpoint triggers exactly ONE refresh attempt,
 *     then exactly ONE retry of the original request. Never more. Never a loop.
 *   - Concurrent 401s share a SINGLE in-flight refresh promise. The dashboard
 *     fires three analytics calls at once; three parallel refreshes would
 *     rotate the cookie out from under one another and log the user out.
 *   - A failed refresh clears the in-memory token and notifies listeners, which
 *     is how the auth context knows to route to /login.
 *   - Every /api/auth/* request is sent with `credentials: "include"`, or the
 *     refresh cookie is neither sent nor stored.
 */
import { toApiError, NetworkError, ApiError } from './errors';
import { getAccessToken, setAccessToken, clearAccessToken } from './tokenStore';
import type { RefreshResult } from './types';

const AUTH_PREFIX = '/api/auth';

/** "" in local dev - requests go to the Vite proxy and stay same-origin. */
const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

const USE_MOCKS: boolean = import.meta.env.VITE_USE_MOCKS === 'true';

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Serialised as JSON. Omit for a bodyless request. */
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /**
   * Attach the in-memory access token as `Authorization: Bearer`.
   * Default true. Signup / login / refresh set this false - a bearer header on
   * those is meaningless, and refresh is explicitly cookie-only.
   */
  auth?: boolean;
  /**
   * On a 401, refresh once and retry once. Defaults to true for every endpoint
   * outside /api/auth. The auth endpoints opt out: refreshing in response to a
   * failed refresh is precisely the loop the contract forbids.
   */
  refreshOn401?: boolean;
}

/* -------------------------------------------------------------------------
 * Transport
 * ---------------------------------------------------------------------- */

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

let transportOverride: Fetcher | null = null;
let transportPromise: Promise<Fetcher> | null = null;

/**
 * Swap the transport. Used by the mock toggle and by tests. Everything above
 * it - headers, credentials, refresh, error parsing - is identical in every
 * mode, which is what makes the mock a real rehearsal for the backend rather
 * than a parallel code path that can drift.
 */
export function setTransport(fetcher: Fetcher | null): void {
  transportOverride = fetcher;
  transportPromise = null;
}

function resolveTransport(): Promise<Fetcher> {
  if (transportOverride) return Promise.resolve(transportOverride);
  if (!transportPromise) {
    transportPromise = USE_MOCKS
      ? // Dynamic so the mock backend is code-split out of a real build.
        import('./mocks').then((m) => m.mockFetch)
      : Promise.resolve((input, init) => fetch(input, init));
  }
  return transportPromise;
}

/* -------------------------------------------------------------------------
 * Session-expiry notification
 * ---------------------------------------------------------------------- */

type Listener = () => void;
const sessionExpiredListeners = new Set<Listener>();

/**
 * Fired when a refresh prompted by a 401 fails - i.e. the refresh cookie is
 * gone, expired or already rotated. Deliberately NOT fired by the boot-time
 * refresh: a first-time visitor has no session to expire and should simply see
 * the sign-in screen, not an error about a session they never had.
 */
export function onSessionExpired(listener: Listener): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function notifySessionExpired(): void {
  for (const listener of sessionExpiredListeners) listener();
}

/* -------------------------------------------------------------------------
 * Request plumbing
 * ---------------------------------------------------------------------- */

export function isAuthEndpoint(path: string): boolean {
  return path === AUTH_PREFIX || path.startsWith(`${AUTH_PREFIX}/`);
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return `${API_BASE_URL}${path}${qs ? `?${qs}` : ''}`;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');

  if (options.auth !== false) {
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    // The refresh cookie has Path=/api/auth, so only these requests can carry
    // it - but without `include` a cross-origin production build would neither
    // send nor store it, and the whole session model would silently collapse.
    credentials: isAuthEndpoint(path) ? 'include' : 'same-origin',
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;

  const transport = await resolveTransport();
  try {
    return await transport(buildUrl(path, options.query), init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new NetworkError();
  }
}

/* -------------------------------------------------------------------------
 * Single-flight refresh
 * ---------------------------------------------------------------------- */

let inFlightRefresh: Promise<string | null> | null = null;

/** Web Locks name. Scoped per origin, which is exactly the cookie's scope. */
const REFRESH_LOCK = 'ledgerlite-refresh';

/**
 * Serialise refreshes across every tab of this origin.
 *
 * `inFlightRefresh` below is a module variable, so it is single-flight per
 * JavaScript realm - per TAB. Two tabs share one cookie jar but not one
 * promise, so both can post the same refresh cookie at once; the backend
 * rotates on the first and reads the second as a replayed token. A lock fixes
 * this without any cross-tab messaging: by the time the second tab runs, the
 * first tab's `Set-Cookie` has already landed in the shared jar, so it sends
 * the CURRENT cookie and rotates normally.
 *
 * Falls through uncontended where the API is absent (Safari < 15.4, jsdom,
 * non-secure contexts). The backend's replay grace window is the safety net
 * there - the two fixes are deliberately belt-and-braces.
 */
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return fn();
  return locks.request(REFRESH_LOCK, fn);
}

async function performRefresh(): Promise<string | null> {
  try {
    const response = await send('/api/auth/refresh', {
      method: 'POST',
      auth: false,
      refreshOn401: false,
    });
    if (!response.ok) {
      clearAccessToken();
      return null;
    }
    const body = (await response.json()) as RefreshResult;
    setAccessToken(body.access_token);
    return body.access_token;
  } catch {
    clearAccessToken();
    return null;
  }
}

/**
 * Exchange the httpOnly refresh cookie for a fresh access token.
 *
 * Single-flight on two levels: within this tab every caller that arrives while
 * a refresh is outstanding gets the SAME promise, and across tabs the Web Lock
 * serialises those promises, so N concurrent 401s anywhere in this browser
 * produce one rotation at a time. Resolves to the new token, or null if the
 * session is over.
 */
export function refreshSession(): Promise<string | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = withRefreshLock(performRefresh).finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

/** Test seam: forget any outstanding refresh between cases. */
export function resetRefreshState(): void {
  inFlightRefresh = null;
}

/* -------------------------------------------------------------------------
 * Public request API
 * ---------------------------------------------------------------------- */

async function request(path: string, options: RequestOptions): Promise<Response> {
  const mayRefresh = options.refreshOn401 ?? !isAuthEndpoint(path);

  const response = await send(path, options);
  if (response.status !== 401 || !mayRefresh) return response;

  // One refresh. One retry. Then give up - no second chance, no loop.
  const token = await refreshSession();
  if (token === null) {
    notifySessionExpired();
    return response;
  }
  return send(path, { ...options, refreshOn401: false });
}

/** Perform a request and decode its JSON body, or throw a Contract 6 ApiError. */
export async function apiJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options);
  if (!response.ok) throw await toApiError(response, path);
  return (await response.json()) as T;
}

/** Perform a request that answers 204 with no body (deletes, logout). */
export async function apiVoid(path: string, options: RequestOptions = {}): Promise<void> {
  const response = await request(path, options);
  if (!response.ok) throw await toApiError(response, path);
}

export { ApiError };
