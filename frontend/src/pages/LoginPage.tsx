import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { useAuth } from '../auth/useAuth';
import { Field } from '../components/Field';
import { Banner } from '../components/feedback';
import { AuthScreen } from './AuthScreen';

const USING_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';

export function LoginPage() {
  const { state, signIn, clearNotice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const notice = state.status === 'anonymous' ? state.notice : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    clearNotice();
    setSubmitting(true);
    try {
      await signIn({ email: email.trim(), password });
      // On success the auth state flips to `authenticated` and RequireAnonymous
      // redirects to wherever the user was originally heading.
    } catch (cause) {
      // Contract 1 returns the SAME 401 sentence for an unknown email and a
      // wrong password. Showing exactly what the server said is what keeps the
      // UI from re-introducing the user enumeration the API avoids.
      setError(errorMessage(cause));
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen>
      <form className="auth__form" onSubmit={handleSubmit} noValidate>
        <div>
          <h1 className="auth__title">Sign in</h1>
          <p className="page__sub">Your ledger, and nobody else&rsquo;s.</p>
        </div>

        {notice ? <Banner tone="notice">{notice}</Banner> : null}
        {error ? <Banner>{error}</Banner> : null}

        <Field label="Email">
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>

        <Field label="Password">
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="auth__switch">
          No account yet? <Link to="/signup">Create one</Link>
        </p>

        {USING_MOCKS ? (
          <p className="auth__demo">
            Running on the mock API. Sign in with <code>demo@ledgerlite.app</code> /{' '}
            <code>demo1234</code>, or create any account you like — it lives in this tab only.
          </p>
        ) : null}
      </form>
    </AuthScreen>
  );
}
