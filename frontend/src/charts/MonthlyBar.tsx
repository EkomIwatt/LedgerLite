import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsMonthly, MonthlyPoint } from '../api/types';
import { EmptyState } from '../components/feedback';
import { AxesIcon } from '../components/icons';
import { formatMonthShort, formatMonthShortWithYear } from '../lib/dates';
import { formatMoney, formatMoneyCompact } from '../lib/money';
import { ChartFrame } from './ChartFrame';
import { AXIS_TICK_STYLE, usePrefersReducedMotion, useThemeTokens } from './chartTheme';

interface MonthlyBarProps {
  data: AnalyticsMonthly | null;
  loading: boolean;
  error: string | null;
}

interface MonthTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: MonthlyPoint }>;
}

function MonthTooltip({ active, payload }: MonthTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip__title">{formatMonthShortWithYear(point.month)}</p>
      <p className="chart-tooltip__row">
        <span>Spent</span>
        <span className="chart-tooltip__value">{formatMoney(point.total_spent_minor)}</span>
      </p>
      {point.total_budget_minor > 0 ? (
        <p className="chart-tooltip__row">
          <span className="faint">Budget</span>
          <span className="chart-tooltip__value faint">
            {formatMoney(point.total_budget_minor)}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Contract 5c - spending month over month.
 *
 * The array arrives ZERO-FILLED and CONTIGUOUS, oldest first, with the current
 * month last, so it is rendered exactly as received. There is deliberately no
 * gap filling, no sorting and no bucketing here: if a month ever looks missing
 * that is a contract bug to escalate, not something to patch around in the
 * chart.
 *
 * One hue, not ten. This is a time series rather than a set of categories, so
 * borrowing the category palette would imply a relationship that isn't there.
 * The current month is picked out in the accent colour, and the month labels
 * on the axis carry the same information for anyone who cannot see the tint.
 */
export function MonthlyBar({ data, loading, error }: MonthlyBarProps) {
  const tokens = useThemeTokens();
  const reduceMotion = usePrefersReducedMotion();

  const months = data?.months ?? [];
  const lastMonth = months.at(-1)?.month;
  const hasSpending = months.some((point) => point.total_spent_minor > 0);
  const hasBudgets = months.some((point) => point.total_budget_minor > 0);
  const isEmpty = !loading && !error && !hasSpending;

  return (
    <ChartFrame
      title={`Last ${months.length || 6} months`}
      loading={loading && !data}
      error={error}
      empty={
        isEmpty ? (
          <EmptyState
            icon={<AxesIcon />}
            title="No spending history yet"
            body="Once you have logged expenses across a couple of months, this chart will compare them."
          />
        ) : null
      }
    >
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={months} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={tokens['--rule']} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={formatMonthShort}
            tickLine={false}
            axisLine={{ stroke: tokens['--rule-strong'] }}
            tick={{ ...AXIS_TICK_STYLE, fill: tokens['--ink-faint'] }}
            dy={4}
          />
          <YAxis
            tickFormatter={formatMoneyCompact}
            tickLine={false}
            axisLine={false}
            width={64}
            tick={{ ...AXIS_TICK_STYLE, fill: tokens['--ink-faint'] }}
          />
          <Tooltip content={<MonthTooltip />} cursor={{ fill: tokens['--surface-sunken'] }} />
          <Bar dataKey="total_spent_minor" name="Spent" isAnimationActive={!reduceMotion} maxBarSize={46}>
            {months.map((point) => (
              <Cell
                key={point.month}
                fill={point.month === lastMonth ? tokens['--accent'] : tokens['--ink-muted']}
              />
            ))}
          </Bar>
          {/* The budget line only appears once there are budgets to compare
              against; an all-zero reference line is just a rule on the floor. */}
          {hasBudgets ? (
            <Line
              type="stepAfter"
              dataKey="total_budget_minor"
              name="Budget"
              stroke={tokens['--danger']}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={!reduceMotion}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>

      <table className="legend">
        <caption className="sr-only">Total spending for each of the last months.</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Spent</th>
            <th scope="col">Budget</th>
          </tr>
        </thead>
        <tbody className="sr-only">
          {months.map((point) => (
            <tr key={point.month}>
              <td>{formatMonthShortWithYear(point.month)}</td>
              <td>{formatMoney(point.total_spent_minor)}</td>
              <td>{formatMoney(point.total_budget_minor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartFrame>
  );
}
