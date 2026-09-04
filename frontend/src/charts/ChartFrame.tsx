import type { ReactNode } from 'react';
import { Banner, SkeletonStack } from '../components/feedback';

interface ChartFrameProps {
  title: string;
  action?: ReactNode;
  loading?: boolean;
  error?: string | null;
  /** Rendered instead of `children` when there is nothing to plot. */
  empty?: ReactNode;
  children: ReactNode;
}

/**
 * The frame every chart sits in: a ruled heading, and one consistent answer
 * for each of the four states a chart can be in - loading, failed, empty and
 * populated. Putting them here rather than in each chart is what stops the
 * empty states from being an afterthought in two charts out of three.
 */
export function ChartFrame({
  title,
  action,
  loading = false,
  error = null,
  empty,
  children,
}: ChartFrameProps) {
  return (
    <section className="panel chart-frame">
      <div className="rule-heading">
        <span className="rule-heading__text">{title}</span>
        {action ? <span className="rule-heading__action">{action}</span> : null}
      </div>

      <div className="chart-frame__body">
        {error ? (
          <Banner>{error}</Banner>
        ) : loading ? (
          <SkeletonStack rows={5} height={20} />
        ) : empty ? (
          empty
        ) : (
          children
        )}
      </div>
    </section>
  );
}
