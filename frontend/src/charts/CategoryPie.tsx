import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { AnalyticsByCategory, CategoryBreakdown } from '../api/types';
import { EmptyState } from '../components/feedback';
import { SheetIcon } from '../components/icons';
import { formatMoney, formatPercent } from '../lib/money';
import { ChartFrame } from './ChartFrame';
import { usePrefersReducedMotion, useThemeTokens } from './chartTheme';

interface CategoryPieProps {
  data: AnalyticsByCategory | null;
  loading: boolean;
  error: string | null;
}

interface SliceTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CategoryBreakdown }>;
}

function SliceTooltip({ active, payload }: SliceTooltipProps) {
  const slice = payload?.[0]?.payload;
  if (!active || !slice) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip__title">{slice.label}</p>
      <p className="chart-tooltip__row">
        <span className="chart-tooltip__value">{formatMoney(slice.spent_minor)}</span>
        <span className="faint">{formatPercent(slice.percent)}</span>
      </p>
    </div>
  );
}

/**
 * Contract 5b - where the money went this month.
 *
 * Every number shown here arrives computed: `spent_minor` and `percent` come
 * off the wire, and `color` and `label` are denormalised onto each row by the
 * server. Nothing in this file sums, sorts or divides.
 *
 * Two deliberate choices:
 *
 *   - Zero-spend rows are not drawn as slices. Contract 5b includes a category
 *     with a budget but no spending, so the gauge can show an untouched
 *     budget; a zero-area slice is invisible and would only add a legend entry
 *     with nothing behind it. That row is still rendered - as a meter, in the
 *     budget gauge. This is a rendering decision, not a change to the data.
 *
 *   - The legend is a real <table> carrying every figure. A pie is genuinely
 *     hard to read precisely and impossible to read at all with a screen
 *     reader, so the table is the primary artefact and the donut is the
 *     at-a-glance summary of it.
 */
export function CategoryPie({ data, loading, error }: CategoryPieProps) {
  const tokens = useThemeTokens();
  const reduceMotion = usePrefersReducedMotion();

  const slices = useMemo(
    () => (data?.categories ?? []).filter((row) => row.spent_minor > 0),
    [data],
  );

  const isEmpty = !loading && !error && slices.length === 0;

  return (
    <ChartFrame
      title="Where it went"
      loading={loading && !data}
      error={error}
      empty={
        isEmpty ? (
          <EmptyState
            icon={<SheetIcon />}
            title="Nothing logged this month"
            body="Add an expense and this chart will show how the month breaks down by category."
          />
        ) : null
      }
    >
      <div style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={236}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="spent_minor"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1}
              stroke={tokens['--surface']}
              strokeWidth={2}
              isAnimationActive={!reduceMotion}
            >
              {slices.map((slice) => (
                <Cell key={slice.category} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip content={<SliceTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        {/* The donut's hole carries the figure the chart is about. */}
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
          <p className="mono-label">Total</p>
          <p className="figure" style={{ fontSize: 'var(--text-md)' }}>
            {formatMoney(data?.total_spent_minor ?? 0)}
          </p>
        </div>
      </div>

      <table className="legend">
        <caption className="sr-only">
          Spending by category, with the amount and share of the month&rsquo;s total.
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Amount</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((slice) => (
            <tr key={slice.category}>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <span className="legend__swatch" style={{ background: slice.color }} />
                  {slice.label}
                </span>
              </td>
              <td className="legend__figure">{formatMoney(slice.spent_minor)}</td>
              <td className="legend__percent">{formatPercent(slice.percent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartFrame>
  );
}
