import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from './authContext';

/** Read the session. Throws if used outside <AuthProvider>, which is a bug. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return value;
}
