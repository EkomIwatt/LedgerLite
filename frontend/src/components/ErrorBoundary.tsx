import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  crashed: boolean;
}

/**
 * The last line of defence. A render-time throw anywhere below this boundary
 * becomes a page the user can act on instead of a blank white screen.
 *
 * It deliberately does NOT print the error text: an exception message is an
 * internal detail, and Contract 6 already gives every expected failure a
 * human-readable sentence that is shown much closer to where it happened.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('LedgerLite crashed while rendering.', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children;

    return (
      <div className="shell">
        <div className="panel">
          <div className="rule-heading">
            <span className="rule-heading__text">Error</span>
          </div>
          <h1 className="page__title">Something went wrong.</h1>
          <p className="page__sub">
            The page could not be displayed. Reloading usually clears it; your data is untouched.
          </p>
          <div className="form-actions" style={{ marginTop: 'var(--space-6)' }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => window.location.reload()}
            >
              Reload LedgerLite
            </button>
          </div>
        </div>
      </div>
    );
  }
}
