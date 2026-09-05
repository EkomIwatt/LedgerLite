import { createContext } from 'react';
import type { Credentials, User } from '../api/types';

/**
 * The session, as a state machine rather than a pair of booleans.
 *
 * `booting` is a real, distinct state and not a detail: Contract 1 requires the
 * app to call POST /api/auth/refresh once on boot and to show a loading state
 * while it is in flight, so that an already-authenticated user reloading the
 * page never gets a flash of the sign-in screen. Collapsing this into
 * `user === null` is exactly the bug that produces that flash.
 */
export type AuthState =
  | { status: 'booting' }
  | { status: 'anonymous'; notice: string | null }
  | { status: 'authenticated'; user: User };

export interface AuthContextValue {
  state: AuthState;
  /** Convenience view of `state`; null unless authenticated. */
  user: User | null;
  signIn: (credentials: Credentials) => Promise<void>;
  signUp: (credentials: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
  /** Dismiss the "your session expired" notice on the sign-in screen. */
  clearNotice: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
