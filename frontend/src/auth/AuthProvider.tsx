import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onSessionExpired, refreshSession } from '../api/client';
import { getMe, login, logout, signup } from '../api/endpoints';
import { clearAccessToken, setAccessToken } from '../api/tokenStore';
import type { Credentials } from '../api/types';
import { AuthContext, type AuthContextValue, type AuthState } from './authContext';

const SESSION_EXPIRED_NOTICE = 'Session expired. Please sign in again.';

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<AuthState>({ status: 'booting' });

  /**
   * Boot sequence (Contract 1): call POST /api/auth/refresh exactly once.
   *
   *   200 -> we hold a fresh access token, but refresh returns no `user`, so
   *          GET /api/auth/me supplies it. Then render the app.
   *   401 -> no live session. Render the sign-in screen, with NO "expired"
   *          notice: a first-time visitor never had a session to lose.
   *
   * The ref guard keeps this to one run under StrictMode's double-invoked
   * effects. `refreshSession` is single-flight anyway, but /api/auth/me is not,
   * and a duplicate request on every boot is just noise in the network panel.
   */
  const hasBooted = useRef(false);
  useEffect(() => {
    if (hasBooted.current) return;
    hasBooted.current = true;

    let cancelled = false;
    void (async () => {
      const token = await refreshSession();
      if (cancelled) return;
      if (token === null) {
        setState({ status: 'anonymous', notice: null });
        return;
      }
      try {
        const user = await getMe();
        if (!cancelled) setState({ status: 'authenticated', user });
      } catch {
        // A token that refresh just minted should work; if it does not, treat
        // the session as absent rather than leaving the app stuck on booting.
        if (!cancelled) {
          clearAccessToken();
          setState({ status: 'anonymous', notice: null });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The client fires this when a refresh triggered by a 401 fails - the cookie
   * is gone, expired or already rotated. Dropping to `anonymous` is what makes
   * every ProtectedRoute redirect to /login, so no imperative navigation is
   * needed from here.
   */
  useEffect(
    () =>
      onSessionExpired(() => {
        clearAccessToken();
        setState((current) =>
          current.status === 'authenticated'
            ? { status: 'anonymous', notice: SESSION_EXPIRED_NOTICE }
            : current,
        );
      }),
    [],
  );

  const signIn = useCallback(async (credentials: Credentials) => {
    const session = await login(credentials);
    setAccessToken(session.access_token);
    setState({ status: 'authenticated', user: session.user });
  }, []);

  const signUp = useCallback(async (credentials: Credentials) => {
    const session = await signup(credentials);
    setAccessToken(session.access_token);
    setState({ status: 'authenticated', user: session.user });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      // Logout is idempotent and the local session is being discarded either
      // way; a failed call must never strand the user inside the app.
    }
    clearAccessToken();
    setState({ status: 'anonymous', notice: null });
  }, []);

  const clearNotice = useCallback(() => {
    setState((current) =>
      current.status === 'anonymous' && current.notice !== null
        ? { status: 'anonymous', notice: null }
        : current,
    );
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      user: state.status === 'authenticated' ? state.user : null,
      signIn,
      signUp,
      signOut,
      clearNotice,
    }),
    [state, signIn, signUp, signOut, clearNotice],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
