import { useState, type FormEvent } from 'react';
import type { Expense, ExpenseCreate } from '../../api/types';
import { Field } from '../../components/Field';
import { Banner } from '../../components/feedback';
import { isValidDate, todayIsoDate } from '../../lib/dates';
import { minorToInputValue, parseAmountToMinor } from '../../lib/money';
import { useCategories } from '../../hooks/useCategories';

interface ExpenseFormProps {
  /** Present when editing; absent when adding. */
  expense?: Expense;
  /** Pre-selects a month's first day when adding from a past month's view. */
  defaultDate?: string;
  onSubmit: (input: ExpenseCreate) => Promise<void>;
  onCancel: () => void;
  /** A Contract 6 sentence from a failed save, shown above the fields. */
  submitError?: string | null;
}

const MAX_NOTE_LENGTH = 500;

export function ExpenseForm({
  expense,
  defaultDate,
  onSubmit,
  onCancel,
  submitError = null,
}: ExpenseFormProps) {
  const categories = useCategories();

  const [amount, setAmount] = useState(() =>
    expense ? minorToInputValue(expense.amount_minor) : '',
  );
  const [category, setCategory] = useState(() => expense?.category ?? categories[0]?.key ?? 'food');
  const [date, setDate] = useState(() => expense?.date ?? defaultDate ?? todayIsoDate());
  const [note, setNote] = useState(() => expense?.note ?? '');

  const [errors, setErrors] = useState<{ amount?: string; date?: string; note?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    // Amounts are parsed straight to minor units with string arithmetic; a
    // float never enters the ledger. See src/lib/money.ts.
    const amountMinor = parseAmountToMinor(amount);
    const nextErrors: typeof errors = {};

    if (amountMinor === null || amountMinor <= 0) {
      nextErrors.amount = 'Enter an amount greater than zero.';
    }
    if (!isValidDate(date)) {
      nextErrors.date = 'Enter a valid date.';
    }
    if (note.trim().length > MAX_NOTE_LENGTH) {
      nextErrors.note = `Keep the note to ${MAX_NOTE_LENGTH} characters or fewer.`;
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || amountMinor === null) return;

    setSubmitting(true);
    try {
      await onSubmit({
        amount_minor: amountMinor,
        category,
        date,
        // Contract 3: an empty string is stored as null, so send null outright.
        note: note.trim() === '' ? null : note.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="modal__body" onSubmit={handleSubmit} noValidate>
      {submitError ? <Banner>{submitError}</Banner> : null}

      <div className="field-row">
        <Field label="Amount" error={errors.amount ?? null} hint="Naira and kobo, e.g. 2499.00">
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input input--figure"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>

        <Field label="Category">
          {({ id, describedBy }) => (
            <select
              id={id}
              className="select"
              value={category}
              aria-describedby={describedBy}
              onChange={(event) => setCategory(event.target.value)}
            >
              {categories.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <Field label="Date" error={errors.date ?? null}>
        {({ id, describedBy, invalid }) => (
          <input
            id={id}
            className="input input--figure"
            type="date"
            value={date}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(event) => setDate(event.target.value)}
          />
        )}
      </Field>

      <Field
        label="Note"
        error={errors.note ?? null}
        hint={`Optional. ${MAX_NOTE_LENGTH - note.trim().length} characters left.`}
      >
        {({ id, describedBy, invalid }) => (
          <textarea
            id={id}
            className="textarea"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            placeholder="What was it for?"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>

      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Saving…' : expense ? 'Save changes' : 'Add expense'}
        </button>
      </div>
    </form>
  );
}
