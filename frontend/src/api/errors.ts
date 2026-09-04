/**
 * Contract 6 — error handling.
 *
 * Every non-2xx response carries `{ "error": "<sentence>" }`. The UI must never
 * render a raw error object: it reads `body.error` and shows that sentence.
 * This module is the single place that turns a Response into something
 * renderable, so no component ever has to think about it.
 */
import type { ApiErrorBody } from './types';

/** A non-2xx response from the API, already reduced to its Contract 6 sentence. */
export class ApiError extends Error {
  readonly status: number;
  /** The request path that failed, for logging — never shown to the user. */
  readonly path: string;

  constructor(status: number, message: string, path: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
  }

  /** True when the failure was an authentication problem (Contract 6). */
  get isAuth(): boolean {
    return this.status === 401;
  }

  /** True when the resource does not exist — or belongs to another user. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** A network-level failure: the request never produced an HTTP response. */
export class NetworkError extends Error {
  constructor(message = 'Could not reach the server. Check your connection and try again.') {
    super(message);
    this.name = 'NetworkError';
  }
}

const FALLBACK_BY_STATUS: Record<number, string> = {
  400: 'That request could not be understood.',
  401: 'Not authenticated.',
  403: 'You do not have access to that.',
  404: 'That could not be found.',
  409: 'That conflicts with something that already exists.',
  422: 'Some of that information is not valid.',
  500: 'Something went wrong.',
};

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  );
}

/**
 * Build an ApiError from a failed Response. Defensive by design: a backend
 * that has not (yet) installed its Contract 6 handlers, a proxy returning HTML,
 * or an empty body must all still produce a readable sentence rather than
 * "[object Object]" on screen.
 */
export async function toApiError(response: Response, path: string): Promise<ApiError> {
  let message = FALLBACK_BY_STATUS[response.status] ?? 'Something went wrong.';
  try {
    const body: unknown = await response.json();
    if (isErrorBody(body)) message = body.error;
  } catch {
    // Not JSON, or an empty body. Keep the status-based fallback.
  }
  return new ApiError(response.status, message, path);
}

/**
 * The sentence to show a user for any thrown value. Components call this
 * instead of touching `error.message` directly, so an unexpected throw can
 * never leak an internal string into the interface.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message;
  return 'Something went wrong.';
}
