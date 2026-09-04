import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="panel">
      <div className="rule-heading">
        <span className="rule-heading__text">404</span>
      </div>
      <h1 className="page__title">No such page.</h1>
      <p className="page__sub">
        That address is not part of LedgerLite. The dashboard has everything.
      </p>
      <div className="form-actions" style={{ marginTop: 'var(--space-6)' }}>
        <Link className="btn btn--primary" to="/">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
