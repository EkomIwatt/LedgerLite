import { useCallback, useMemo, useState } from 'react';
import { createExpense, deleteExpense, listExpenses, updateExpense } from '../api/endpoints';
import { errorMessage } from '../api/errors';
import type { Expense, ExpenseCreate, IsoMonth } from '../api/types';
import { CategoryTick } from '../components/CategoryTick';
import { Modal } from '../components/Modal';
import { MonthNav } from '../components/MonthNav';
import { Banner, EmptyState, SkeletonStack } from '../components/feedback';
import { PencilIcon, PlusIcon, SheetIcon, TrashIcon } from '../components/icons';
import { ExpenseForm } from '../features/expenses/ExpenseForm';
import { useCategories } from '../hooks/useCategories';
import { useAsyncData } from '../hooks/useAsyncData';
import { currentMonth, formatDateDay, formatMonthLong } from '../lib/dates';
import { formatMoney } from '../lib/money';

const PAGE_SIZE = 25;

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; expense: Expense }
  | { kind: 'delete'; expense: Expense }
  | null;

export function ExpensesPage() {
  const categories = useCategories();

  const [month, setMonth] = useState<IsoMonth>(currentMonth);
  const [allMonths, setAllMonths] = useState(false);
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(
    (signal: AbortSignal) =>
      listExpenses(
        {
          ...(allMonths ? {} : { month }),
          ...(category === '' ? {} : { category }),
          limit: PAGE_SIZE,
          offset,
        },
        signal,
      ),
    [allMonths, month, category, offset],
  );

  const { data, error, loading, reload } = useAsyncData(load);

  const rows = data?.expenses ?? [];
  const total = data?.total ?? 0;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + PAGE_SIZE, total);

  /** Any filter change starts again from the first page. */
  const resetPage = useCallback(() => setOffset(0), []);

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
  }

  async function handleCreate(input: ExpenseCreate) {
    setDialogError(null);
    try {
      await createExpense(input);
      closeDialog();
      reload();
    } catch (cause) {
      setDialogError(errorMessage(cause));
    }
  }

  async function handleUpdate(expense: Expense, input: ExpenseCreate) {
    setDialogError(null);
    try {
      await updateExpense(expense.id, input);
      closeDialog();
      reload();
    } catch (cause) {
      setDialogError(errorMessage(cause));
    }
  }

  async function handleDelete(expense: Expense) {
    setDialogError(null);
    try {
      await deleteExpense(expense.id);
      closeDialog();
      // Deleting the only row of the last page would otherwise strand the user
      // on an empty page with no way back.
      if (rows.length === 1 && offset > 0) setOffset(Math.max(0, offset - PAGE_SIZE));
      else reload();
    } catch (cause) {
      setDialogError(errorMessage(cause));
    }
  }

  const scopeLabel = useMemo(
    () => (allMonths ? 'All months' : formatMonthLong(month)),
    [allMonths, month],
  );

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Expenses</h1>
          <p className="page__sub">{scopeLabel}</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setDialog({ kind: 'add' })}>
          <PlusIcon size={16} />
          Add expense
        </button>
      </div>

      <div className="filters">
        <div className="field" style={{ minWidth: 'auto' }}>
          <span className="field__label" id="month-filter-label">
            Period
          </span>
          <div className="row" aria-labelledby="month-filter-label">
            {allMonths ? null : (
              <MonthNav
                month={month}
                onChange={(next) => {
                  setMonth(next);
                  resetPage();
                }}
              />
            )}
            <button
              type="button"
              className="btn btn--sm"
              aria-pressed={allMonths}
              onClick={() => {
                setAllMonths((value) => !value);
                resetPage();
              }}
            >
              {allMonths ? 'Filter by month' : 'All months'}
            </button>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="category-filter">
            Category
          </label>
          <select
            id="category-filter"
            className="select"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              resetPage();
            }}
          >
            <option value="">All categories</option>
            {categories.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <Banner>{error}</Banner> : null}

      <section className="panel panel--flush">
        {loading && !data ? (
          <div style={{ padding: 'var(--space-5)' }}>
            <SkeletonStack rows={6} height={22} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<SheetIcon />}
            title="No expenses here"
            body={
              category !== ''
                ? 'Nothing matches these filters. Try a different month or category.'
                : allMonths
                  ? 'Your ledger is empty. Add the first expense to get started.'
                  : `Nothing logged in ${formatMonthLong(month)}. Try another month, or add one here.`
            }
            action={
              <button
                type="button"
                className="btn btn--sm btn--primary"
                onClick={() => setDialog({ kind: 'add' })}
              >
                Add an expense
              </button>
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="ledger">
                <caption className="sr-only">Expenses for {scopeLabel}</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Category</th>
                    <th scope="col">Note</th>
                    <th scope="col" className="is-numeric">
                      Amount
                    </th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((expense) => (
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
                      <td>
                        <div className="ledger__actions">
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Edit expense of ${formatMoney(expense.amount_minor)} on ${formatDateDay(expense.date)}`}
                            onClick={() => setDialog({ kind: 'edit', expense })}
                          >
                            <PencilIcon size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn--danger"
                            aria-label={`Delete expense of ${formatMoney(expense.amount_minor)} on ${formatDateDay(expense.date)}`}
                            onClick={() => setDialog({ kind: 'delete', expense })}
                          >
                            <TrashIcon size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-foot">
              <span>
                {showingFrom}&ndash;{showingTo} of {total}
              </span>
              <div className="row">
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={showingTo >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {dialog?.kind === 'add' ? (
        <Modal title="Add an expense" onClose={closeDialog}>
          <ExpenseForm
            {...(allMonths ? {} : { defaultDate: `${month}-01` })}
            onSubmit={handleCreate}
            onCancel={closeDialog}
            submitError={dialogError}
          />
        </Modal>
      ) : null}

      {dialog?.kind === 'edit' ? (
        <Modal title="Edit expense" onClose={closeDialog}>
          <ExpenseForm
            expense={dialog.expense}
            onSubmit={(input) => handleUpdate(dialog.expense, input)}
            onCancel={closeDialog}
            submitError={dialogError}
          />
        </Modal>
      ) : null}

      {dialog?.kind === 'delete' ? (
        <Modal title="Delete this expense?" onClose={closeDialog}>
          <div className="modal__body">
            {dialogError ? <Banner>{dialogError}</Banner> : null}
            <p className="muted">
              {formatMoney(dialog.expense.amount_minor)} on {formatDateDay(dialog.expense.date)}
              {dialog.expense.note ? ` — ${dialog.expense.note}` : ''}. This cannot be undone.
            </p>
            <div className="form-actions">
              <button type="button" className="btn" onClick={closeDialog}>
                Keep it
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleDelete(dialog.expense)}
              >
                Delete expense
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
