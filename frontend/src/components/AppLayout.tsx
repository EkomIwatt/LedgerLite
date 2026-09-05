import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { SignOutIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/expenses', label: 'Expenses', end: false },
  { to: '/budgets', label: 'Budgets', end: false },
] as const;

/**
 * The masthead and page frame.
 *
 * Set as a newspaper masthead rather than an app bar - wordmark, double rule,
 * small-caps navigation - which is the through-line for the whole interface:
 * this is a ledger, and it should read like one.
 */
export function AppLayout() {
  const { user, signOut } = useAuth();

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="masthead">
        <div className="masthead__inner">
          <NavLink to="/" className="wordmark">
            Ledger<em>Lite</em>
          </NavLink>

          <nav className="nav" aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="nav__link">
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="masthead__tools">
            {user ? (
              <span className="masthead__email" title={user.email}>
                {user.email}
              </span>
            ) : null}
            <ThemeToggle />
            <button
              type="button"
              className="icon-btn"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
            >
              <SignOutIcon />
            </button>
          </div>
        </div>
      </header>

      <main className="shell" id="main">
        <Outlet />
      </main>
    </>
  );
}
