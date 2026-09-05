import { useId, type ReactNode } from 'react';
import { AlertIcon } from './icons';

interface FieldProps {
  label: string;
  /** Rendered under the control; also announced via aria-describedby. */
  hint?: string;
  error?: string | null;
  /** Receives the generated ids so the control is properly labelled. */
  children: (ids: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ReactNode;
}

/**
 * A labelled form control.
 *
 * The label is a real <label for>, the hint and error are wired through
 * aria-describedby, and the invalid state is exposed with aria-invalid rather
 * than colour alone - a red border is invisible to anyone who cannot see it.
 */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        describedBy: describedBy === '' ? undefined : describedBy,
        invalid: Boolean(error),
      })}
      {hint && !error ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field__error" id={errorId}>
          <AlertIcon size={14} />
          {error}
        </span>
      ) : null}
    </div>
  );
}
