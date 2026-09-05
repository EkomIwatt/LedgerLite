import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { BootScreen } from '../components/feedback';
import { useAuth } from './useAuth';

/** Where an unauthenticated visitor was heading before being sent to /login. */
interface RedirectState {
  from?: string;
}

function intendedDestination(state: unknown): string {
  const from = (state as RedirectState | null)?.from;
  // Only ever trust an in-app path, so a crafted history entry cannot turn the
  // post-login redirect into an open redirect to another origin.
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

/**
 * Gate for the app itself.
 *
 * While the boot refresh is in flight the answer is "not yet" rather than "no"
 * - redirecting during `booting` is what makes a signed-in user flash past the
 * login screen on every reload. The intended destination rides along in
 * history state so a deep link survives the round trip.
 */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'booting') return <BootScreen />;
  if (state.status === 'anonymous') {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }
  return <Outlet />;
}

/** Gate for /login and /signup: an authenticated user has no business here. */
export function RequireAnonymous() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'booting') return <BootScreen />;
  if (state.status === 'authenticated') {
    return <Navigate to={intendedDestination(location.state)} replace />;
  }
  return <Outlet />;
}
