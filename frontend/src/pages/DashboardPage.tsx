import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { getByCategory, getMonthly, getSummary, listExpenses } from '../api/endpoints';
import type { IsoMonth } from '../api/types';
import { BudgetGauge } from '../charts/BudgetGauge';
import { CategoryPie } from '../charts/CategoryPie';
import { MonthlyBar } from '../charts/MonthlyBar';
import { CategoryTick } from '../components/CategoryTick';
import { MonthNav } from '../components/MonthNav';
import { EmptyState, Skeleton } from '../components/feedback';
import { SheetIcon } from '../components/icons';
import { useAsyncData } from '../hooks/useAsyncData';
import { currentMonth, formatDateDay, formatMonthLong } from '../lib/dates';
import { formatMoney, formatPercent } from '../lib/money';

const MONTHS_OF_HISTORY = 6;
const RECENT_COUNT = 5;

/**
 * The dashboard.
 *
 * It fires four requests at once, and that is deliberate rather than
 * incidental: it is precisely the situation Contract 1's single-flight rule
 * exists for. If the access token has expired, all four come back 401 together
 * and the client must perform exactly ONE refresh - four parallel refreshes
 * would rotate the cookie out from under each other and end the session.
 *
 * Every figure on this page arrives pre-computed from Contract 5. There is no
 * summing, bucketing, zero-filling or percentage maths anywhere below.
 */
export function DashboardPage() {
  const [month, setMonth] = useState<IsoMonth>(currentMonth);

  const loadSummary = useCallback((signal: AbortSignal) => getSummary(month, signal), [month]);
  const loadBreakdown = useCallback(
    (signal: AbortSignal) => getByCategory(month, signal),
    [month],
  );
  const loadMonthly = useCallback(
    (signal: AbortSignal) => getMonthly(MONTHS_OF_HISTORY, signal),
    [],
  );
  const loadRecent = useCallback(
    (signal: AbortSignal) => listExpenses({ month, limit: RECENT_COUNT }, signal),
    [month],
  );

  const summary = useAsyncData(loadSummary);
  const breakdown = useAsyncData(loadBreakdown);
  const monthly = useAsyncData(loadMonthly);
  const recent = useAsyncData(loadRecent);

  const totals = summary.data;

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">{formatMonthLong(month)}</h1>
          <p className="page__sub">
            {totals ? `${totals.expense_count} ${totals.expense_count === 1 ? 'entry' : 'entries'} recorded` : 'Loading the month…'}
          </p>
        </div>
        <MonthNav month={month} onChange={setMonth} />
      </div>

      <div className="grid grid--dashboard stagger">
        {/* --- Headline (Contract 5a) --- */}
        <section className="panel span-12">
          <div className="rule-heading">
            <span className="rule-heading__text">Total spent</span>
          </div>

          <div className="headline">
            <div>
              {summary.loading && !totals ? (
                <Skeleton height={64} width="280px" />
              ) : (
                <p className="headline__figure">{formatMoney(totals?.total_spent_minor ?? 0)}</p>
              )}
            </div>

            <div className="stat-row" style={{ flex: '1 1 420px' }}>
              <div className="stat">
                <p className="stat__label">Budgeted</p>
                <p className="stat__value">{formatMoney(totals?.total_budget_minor ?? 0)}</p>
              </div>
              <div className="stat">
                <p className="stat__label">Remaining</p>
                <p
                  className={`stat__value ${
                    (totals?.remaining_minor ?? 0) < 0
                      ? 'stat__value--negative'
                      : 'stat__value--positive'
                  }`}
                >
                  {formatMoney(totals?.remaining_minor ?? 0)}
                </p>
              </div>
              <div className="stat">
                <p className="stat__label">Used</p>
                <p className="stat__value">{formatPercent(totals?.percent_used ?? 0)}</p>
              </div>
              <div className="stat">
                <p className="stat__label">Entries</p>
                <p className="stat__value">{totals?.expense_count ?? 0}</p>
              </div>
            </div>
          </div>
        </section>

        {/* --- Month over month (Contract 5c) --- */}
        <div className="span-12">
          <MonthlyBar data={monthly.data} loading={monthly.loading} error={monthly.error} />
        </div>

        {/* --- Category breakdown (Contract 5b) --- */}
        <div className="span-7">
          <CategoryPie data={breakdown.data} loading={breakdown.loading} error={breakdown.error} />
        </div>

        {/* --- Budget remaining (Contract 5a headline + 5b per category) --- */}
        <div className="span-5">
          <BudgetGauge
            summary={summary.data}
            breakdown={breakdown.data}
            loading={summary.loading || breakdown.loading}
            error={summary.error ?? breakdown.error}
          />
        </div>

        {/* --- Latest entries (Contract 3) --- */}
        <section className="panel span-12">
          <div className="rule-heading">
            <span className="rule-heading__text">Latest entries</span>
            <Link className="rule-heading__action btn btn--sm btn--ghost" to="/expenses">
              View all
            </Link>
          </div>

          {recent.data && recent.data.expenses.length === 0 ? (
            <EmptyState
              icon={<SheetIcon />}
              title="Nothing logged this month"
              body="Expenses you add will appear here, newest first."
              action={
                <Link className="btn btn--sm btn--primary" to="/expenses">
                  Add an expense
                </Link>
              }
            />
          ) : (
            <div className="table-scroll">
              <table className="ledger">
                <caption className="sr-only">
                  The most recent entries for {formatMonthLong(month)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Category</th>
                    <th scope="col">Note</th>
                    <th scope="col" className="is-numeric">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(recent.data?.expenses ?? []).map((expense) => (
                    <tr key={expense.id}>
                      <td className="ledger__date">{formatDateDay(expense.date)}</td>
                      <td>
                        <CategoryTick category={expense.category} />
                      </td>
                      <td className="ledger__note">
                        {expense.note ?? <span className="faint">&mdash;</span>}
                      </td>
                      <td className="is-numeric ledger__amount">
                        {formatMoney(expense.amount_minor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
