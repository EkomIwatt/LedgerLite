import { useCallback, useMemo, useState } from 'react';
import { deleteBudget, getByCategory, listBudgets, upsertBudget } from '../api/endpoints';
import { errorMessage } from '../api/errors';
import type { CategoryKey, IsoMonth } from '../api/types';
import { MonthNav } from '../components/MonthNav';
import { Banner, SkeletonStack } from '../components/feedback';
import { TrashIcon } from '../components/icons';
import { useAsyncData } from '../hooks/useAsyncData';
import { useCategories } from '../hooks/useCategories';
import { currentMonth, formatMonthLong } from '../lib/dates';
import { formatMoney, minorToInputValue, parseAmountToMinor } from '../lib/money';

/**
 * Per-category monthly limits.
 *
 * Budgets do not carry forward between months (Contract 4), so the month
 * selector is the primary control here, and the page states plainly which
 * month is being edited.
 *
 * PUT is an upsert and DELETE is the only way to remove a limit - the contract
 * is explicit that a limit of 0 is invalid, so an emptied field removes the
 * budget rather than saving a zero.
 */
export function BudgetsPage() {
  const categories = useCategories();
  const [month, setMonth] = useState<IsoMonth>(currentMonth);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<CategoryKey | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const loadBudgets = useCallback((signal: AbortSignal) => listBudgets(month, signal), [month]);
  const loadSpend = useCallback((signal: AbortSignal) => getByCategory(month, signal), [month]);

  const budgets = useAsyncData(loadBudgets);
  const spend = useAsyncData(loadSpend);

  /** Changing month discards half-typed drafts from the month you left. */
  const changeMonth = useCallback((next: IsoMonth) => {
    setMonth(next);
    setDrafts({});
    setRowError(null);
  }, []);

  const limitByCategory = useMemo(() => {
    const map = new Map<CategoryKey, number>();
    for (const budget of budgets.data?.budgets ?? []) map.set(budget.category, budget.limit_minor);
    return map;
  }, [budgets.data]);

  const spentByCategory = useMemo(() => {
    const map = new Map<CategoryKey, number>();
    for (const row of spend.data?.categories ?? []) map.set(row.category, row.spent_minor);
    return map;
  }, [spend.data]);

  function draftFor(key: CategoryKey): string {
    if (key in drafts) return drafts[key] ?? '';
    const limit = limitByCategory.get(key);
    return limit === undefined ? '' : minorToInputValue(limit);
  }

  function isDirty(key: CategoryKey): boolean {
    if (!(key in drafts)) return false;
    const limit = limitByCategory.get(key);
    return (drafts[key] ?? '') !== (limit === undefined ? '' : minorToInputValue(limit));
  }

  async function save(key: CategoryKey) {
    const raw = draftFor(key).trim();
    setRowError(null);
    setBusyKey(key);
    try {
      if (raw === '') {
        // An emptied field means "no budget", which is a DELETE. Nothing to do
        // if there was no budget in the first place.
        if (limitByCategory.has(key)) await deleteBudget(month, key);
      } else {
        const limitMinor = parseAmountToMinor(raw);
        if (limitMinor === null || limitMinor <= 0) {
          setRowError('Enter a limit greater than zero, or clear the field to remove the budget.');
          return;
        }
        await upsertBudget({ month, category: key, limit_minor: limitMinor });
      }
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      budgets.reload();
      spend.reload();
    } catch (cause) {
      setRowError(errorMessage(cause));
    } finally {
      setBusyKey(null);
    }
  }

  async function remove(key: CategoryKey) {
    setRowError(null);
    setBusyKey(key);
    try {
      await deleteBudget(month, key);
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      budgets.reload();
      spend.reload();
    } catch (cause) {
      setRowError(errorMessage(cause));
    } finally {
      setBusyKey(null);
    }
  }

  const loading = budgets.loading && !budgets.data;

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Budgets</h1>
          <p className="page__sub">
            Limits for {formatMonthLong(month)}. Each month is set on its own — nothing carries
            forward.
          </p>
        </div>
        <MonthNav month={month} onChange={changeMonth} />
      </div>

      {budgets.error ? <Banner>{budgets.error}</Banner> : null}
      {rowError ? <Banner>{rowError}</Banner> : null}

      <section className="panel panel--flush">
        {loading ? (
          <div style={{ padding: 'var(--space-5)' }}>
            <SkeletonStack rows={8} height={24} />
          </div>
        ) : (
          <div className="table-scroll">
            <table className="ledger">
              <caption className="sr-only">
                Monthly spending limit for each category in {formatMonthLong(month)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="is-numeric">
                    Spent
                  </th>
                  <th scope="col">Monthly limit</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => {
                  const hasBudget = limitByCategory.has(category.key);
                  const spent = spentByCategory.get(category.key) ?? 0;
                  const busy = busyKey === category.key;
                  const inputId = `limit-${category.key}`;

                  return (
                    <tr key={category.key}>
                      <td>
                        <span className="cat">
                          <span
                            className="cat__tick"
                            style={{ ['--cat-color' as string]: category.color }}
                          />
                          <label className="cat__label" htmlFor={inputId}>
                            {category.label}
                          </label>
                        </span>
                      </td>
                      <td className="is-numeric ledger__amount">
                        {spent > 0 ? (
                          formatMoney(spent)
                        ) : (
                          <span className="faint">{formatMoney(0)}</span>
                        )}
                      </td>
                      <td>
                        <input
                          id={inputId}
                          className="input input--figure"
                          style={{ maxWidth: 160, height: 'var(--control-h-sm)' }}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="No limit"
                          value={draftFor(category.key)}
                          disabled={busy}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [category.key]: event.target.value,
                            }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void save(category.key);
                            }
                          }}
                        />
                      </td>
                      <td>
                        <div className="ledger__actions">
                          {/* Ten buttons all reading "Set" is nothing to a
                              screen reader, so each one names its own row. */}
                          <button
                            type="button"
                            className="btn btn--sm btn--primary"
                            disabled={!isDirty(category.key) || busy}
                            aria-label={`${hasBudget ? 'Update' : 'Set'} the ${category.label} budget`}
                            onClick={() => void save(category.key)}
                          >
                            {busy ? 'Saving…' : hasBudget ? 'Update' : 'Set'}
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn--danger"
                            disabled={!hasBudget || busy}
                            aria-label={`Remove the ${category.label} budget for ${formatMonthLong(month)}`}
                            onClick={() => void remove(category.key)}
                          >
                            <TrashIcon size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
