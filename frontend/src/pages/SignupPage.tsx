import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/errors';
import { useAuth } from '../auth/useAuth';
import { Field } from '../components/Field';
import { Banner } from '../components/feedback';
import { AuthScreen } from './AuthScreen';

const MIN_PASSWORD_LENGTH = 8;

export function SignupPage() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    // A local check purely so the user is not made to wait for a round trip to
    // learn something we already know. The server remains the authority: its
    // 422 is what gets displayed if the two ever disagree.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setPasswordError(null);
    setError(null);
    setSubmitting(true);
    try {
      await signUp({ email: email.trim(), password });
    } catch (cause) {
      setError(errorMessage(cause));
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen>
      <form className="auth__form" onSubmit={handleSubmit} noValidate>
        <div>
          <h1 className="auth__title">Create an account</h1>
          <p className="page__sub">Takes a moment. No card, no import, no sharing.</p>
        </div>

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

        <Field
          label="Password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={passwordError}
        >
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input"
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => {
                setPassword(event.target.value);
                if (passwordError) setPasswordError(null);
              }}
            />
          )}
        </Field>

        <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <p className="auth__switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthScreen>
  );
}
