import type { ReactNode } from 'react';
import { AlertIcon } from './icons';

/* -------------------------------------------------------------------------
 * Banner
 * ---------------------------------------------------------------------- */

interface BannerProps {
  tone?: 'error' | 'notice';
  children: ReactNode;
}

/**
 * An inline message. Errors are announced assertively because they always
 * follow an action the user just took and they always carry the sentence the
 * server sent (Contract 6) - never a raw object, never a status code.
 */
export function Banner({ tone = 'error', children }: BannerProps) {
  return (
    <div
      className={`banner banner--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      {tone === 'error' ? <AlertIcon size={16} className="banner__icon" /> : null}
      <span>{children}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Empty state
 * ---------------------------------------------------------------------- */

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}

/**
 * A designed empty state, which Contract 5 makes a hard requirement rather
 * than a nicety: a brand-new account gets 200s with zeroed totals and an empty
 * `categories` array from all three analytics endpoints, so every chart must
 * have something considered to show on day one.
 */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="empty">
      {icon ? <div className="empty__mark">{icon}</div> : null}
      <p className="empty__title">{title}</p>
      <p className="empty__body">{body}</p>
      {action ? <div style={{ marginTop: 'var(--space-3)' }}>{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Skeletons
 * ---------------------------------------------------------------------- */

/** A placeholder block. Reserves the height its content will need, so the
 *  page does not jump when the real data lands. */
export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

export function SkeletonStack({ rows = 4, height = 16 }: { rows?: number; height?: number }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={height} width={index % 3 === 2 ? '70%' : '100%'} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Boot screen
 * ---------------------------------------------------------------------- */

/**
 * Shown while the boot-time POST /api/auth/refresh is in flight. Its whole job
 * is to stop an already-signed-in user seeing a flash of the login screen on
 * every page reload.
 */
export function BootScreen() {
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot__rule" />
      <p className="boot__label">Restoring session</p>
    </div>
  );
}
