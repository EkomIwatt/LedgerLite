import { useCallback, useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../api/errors';

export interface AsyncData<T> {
  /** The last successful value. Kept during a reload so the page does not
   *  collapse to skeletons every time the month changes. */
  data: T | null;
  /** A Contract 6 sentence, ready to render. Never a raw error object. */
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Load something from the API, with cancellation.
 *
 * `load` must be stable - wrap it in useCallback at the call site - because it
 * is the effect's dependency. Every in-flight request is aborted when the
 * inputs change or the component unmounts, so a slow response for September
 * can never overwrite a fast one for October.
 */
export function useAsyncData<T>(load: (signal: AbortSignal) => Promise<T>): AsyncData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    load(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError(null);
        setLoading(false);
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        // A 401 that survives the client's refresh-and-retry means the session
        // is over. The auth context has already been notified and is routing to
        // /login, so a "Not authenticated." banner would flash on the way out
        // and tell the user nothing they are not about to be shown anyway.
        setError(cause instanceof ApiError && cause.isAuth ? null : errorMessage(cause));
        setLoading(false);
      },
    );

    return () => controller.abort();
  }, [load, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, error, loading, reload };
}
