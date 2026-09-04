import { Link } from 'react-router-dom';
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';
import type { AnalyticsByCategory, AnalyticsSummary, CategoryBreakdown } from '../api/types';
import { EmptyState } from '../components/feedback';
import { TargetIcon } from '../components/icons';
import { formatMoney, formatPercent } from '../lib/money';
import { ChartFrame } from './ChartFrame';
import { usePrefersReducedMotion, useThemeTokens } from './chartTheme';

interface BudgetGaugeProps {
  summary: AnalyticsSummary | null;
  breakdown: AnalyticsByCategory | null;
  loading: boolean;
  error: string | null;
}

/**
 * One category's budget, drawn as a bullet chart.
 *
 * The track is scaled to whichever is larger, the limit or the spend, and the
 * limit is marked with a rule. Under budget, the marker sits at the right edge
 * and the fill stops short of it. Over budget, the marker moves INSIDE the bar
 * and the overshoot is hatched in ledger red - so "how far past the line" is
 * legible, instead of every blown budget looking identically full.
 *
 * The ratios below are layout geometry. Every number the user reads -
 * `spent_minor`, `limit_minor`, `remaining_minor`, `percent_used` - arrives
 * already computed from Contract 5b.
 */
function BudgetMeter({ row }: { row: CategoryBreakdown }) {
  const limit = row.limit_minor ?? 0;
  const scaleMax = Math.max(limit, row.spent_minor, 1);
  const fillPercent = (row.spent_minor / scaleMax) * 100;
  const markerPercent = (limit / scaleMax) * 100;
  const remaining = row.remaining_minor ?? 0;

  return (
    <div>
      <div className="meter__head">
        <span className="meter__label">
          <span
            className="legend__swatch"
            style={{ background: row.color }}
            aria-hidden="true"
          />
          {row.label}
          {row.over_budget ? <span className="badge badge--over">Over</span> : null}
        </span>
        <span className="meter__figures">
          {formatMoney(row.spent_minor)} / {formatMoney(limit)}
        </span>
      </div>

      <div
        className="meter__track"
        role="meter"
        aria-valuenow={row.percent_used ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${row.label}: ${formatPercent(row.percent_used ?? 0)} of budget used, ${
          remaining < 0
            ? `${formatMoney(Math.abs(remaining))} over`
            : `${formatMoney(remaining)} remaining`
        }`}
      >
        <div
          className={`meter__fill${row.over_budget ? ' meter__fill--over' : ''}`}
          style={{
            width: `${fillPercent}%`,
            ...(row.over_budget ? {} : { ['--cat-color' as string]: row.color }),
          }}
        />
        <span className="meter__limit" style={{ left: `${markerPercent}%` }} aria-hidden="true" />
      </div>

      <p className="meter__figures" style={{ marginTop: 'var(--space-2)' }}>
        {remaining < 0 ? (
          <span className="negative">{formatMoney(Math.abs(remaining))} over budget</span>
        ) : (
          <span className="faint">{formatMoney(remaining)} left</span>
        )}
        <span className="faint"> · {formatPercent(row.percent_used ?? 0)} used</span>
      </p>
    </div>
  );
}

/**
 * Contract 5a for the headline, 5b for the per-category breakdown.
 *
 * `remaining_minor` is allowed to be negative and `percent_used` is allowed to
 * exceed 100. The radial arc is geometrically full at 100% - a circle cannot
 * show 140% - but nothing is clamped away: the arc switches to ledger red, the
 * true percentage is printed in the middle, and the overspend is stated as a
 * figure. Over budget looks like a different state, not like a finished one.
 */
export function BudgetGauge({ summary, breakdown, loading, error }: BudgetGaugeProps) {
  const tokens = useThemeTokens();
  const reduceMotion = usePrefersReducedMotion();

  const percentUsed = summary?.percent_used ?? 0;
  const remaining = summary?.remaining_minor ?? 0;
  const overBudget = remaining < 0;
  const hasBudget = (summary?.total_budget_minor ?? 0) > 0;

  const budgeted = (breakdown?.categories ?? []).filter((row) => row.limit_minor !== null);
  const unbudgetedSpend = (breakdown?.categories ?? []).filter(
    (row) => row.limit_minor === null && row.spent_minor > 0,
  );

  const isEmpty = !loading && !error && !hasBudget;

  return (
    <ChartFrame
      title="Budget remaining"
      loading={loading && !summary}
      error={error}
      empty={
        isEmpty ? (
          <EmptyState
            icon={<TargetIcon />}
            title="No budgets set for this month"
            body="Set a monthly limit per category and this gauge will track what is left of it."
            action={
              <Link className="btn btn--sm" to="/budgets">
                Set budgets
              </Link>
            }
          />
        ) : null
      }
    >
      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={188}>
          <RadialBarChart
            data={[{ value: Math.min(percentUsed, 100) }]}
            startAngle={90}
            endAngle={-270}
            innerRadius="76%"
            outerRadius="100%"
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar
              dataKey="value"
              angleAxisId={0}
              cornerRadius={0}
              background={{ fill: tokens['--surface-sunken'] }}
              fill={overBudget ? tokens['--danger'] : tokens['--accent']}
              isAnimationActive={!reduceMotion}
            />
          </RadialBarChart>
        </ResponsiveContainer>

        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeContent: 'center',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <p className="figure" style={{ fontSize: 'var(--text-lg)' }}>
            {formatPercent(percentUsed)}
          </p>
          <p className="mono-label">of budget</p>
        </div>
      </div>

      <p
        style={{
          textAlign: 'center',
          fontSize: 'var(--text-sm)',
          marginTop: 'var(--space-2)',
        }}
      >
        {overBudget ? (
          <span className="negative figure">{formatMoney(Math.abs(remaining))} over budget</span>
        ) : (
          <span className="figure">{formatMoney(remaining)} left to spend</span>
        )}
      </p>

      {budgeted.length > 0 ? (
        <div className="meters" style={{ marginTop: 'var(--space-6)' }}>
          {budgeted.map((row) => (
            <BudgetMeter key={row.category} row={row} />
          ))}
        </div>
      ) : null}

      {unbudgetedSpend.length > 0 ? (
        <p className="meter__unbudgeted" style={{ marginTop: 'var(--space-5)' }}>
          Not budgeted:{' '}
          {unbudgetedSpend.map((row) => `${row.label} ${formatMoney(row.spent_minor)}`).join(' · ')}
        </p>
      ) : null}
    </ChartFrame>
  );
}
