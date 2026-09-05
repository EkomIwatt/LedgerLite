import type { ReactNode } from 'react';
import { CATEGORIES } from '../api/categories';
import { ThemeToggle } from '../components/ThemeToggle';

/**
 * The shell both auth screens share.
 *
 * The left-hand panel is a type specimen: the wordmark, a line of copy, and
 * the frozen Contract 2 palette printed as a ruled list. It introduces the
 * product's single piece of colour before the user has any data of their own,
 * and it is the same ten colours they will meet in every chart.
 */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth__specimen" aria-hidden="true">
        <div>
          <p className="wordmark" style={{ fontSize: 'var(--text-lg)' }}>
            Ledger<em>Lite</em>
          </p>
          <p className="auth__lede">
            Every naira, <em>ruled</em> and accounted for.
          </p>
        </div>

        <div className="auth__specimen-list">
          {CATEGORIES.map((category) => (
            <div className="auth__specimen-row" key={category.key}>
              <span className="cat__tick" style={{ ['--cat-color' as string]: category.color }} />
              <span>{category.label}</span>
              <span>{category.color}</span>
            </div>
          ))}
        </div>
      </aside>

      <div className="auth__form-side">
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 'var(--space-4)' }}>
            <ThemeToggle />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
