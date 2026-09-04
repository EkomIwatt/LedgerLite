import { currentMonth, formatMonthLong, shiftMonth } from '../lib/dates';
import type { IsoMonth } from '../api/types';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

interface MonthNavProps {
  month: IsoMonth;
  onChange: (month: IsoMonth) => void;
}

/**
 * The month selector. Stepping forward stops at the current month: there is no
 * future spending to look at, and a series of empty months is a worse answer
 * than a disabled control.
 */
export function MonthNav({ month, onChange }: MonthNavProps) {
  const atCurrentMonth = month >= currentMonth();

  return (
    <div className="month-nav">
      <button
        type="button"
        className="month-nav__btn"
        onClick={() => onChange(shiftMonth(month, -1))}
        aria-label="Previous month"
      >
        <ChevronLeftIcon size={16} />
      </button>
      <span className="month-nav__label" aria-live="polite">
        {formatMonthLong(month)}
      </span>
      <button
        type="button"
        className="month-nav__btn"
        onClick={() => onChange(shiftMonth(month, 1))}
        disabled={atCurrentMonth}
        aria-label="Next month"
      >
        <ChevronRightIcon size={16} />
      </button>
    </div>
  );
}
