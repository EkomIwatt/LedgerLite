/**
 * Calendar helpers.
 *
 * Project convention: an expense `date` is a calendar date "YYYY-MM-DD" with no
 * time and no timezone; a month is "YYYY-MM". Everything here therefore formats
 * through UTC deliberately - parsing "2026-09-04" in a negative-offset timezone
 * and formatting it locally is the classic way to render the 3rd of September.
 *
 * Note what is NOT here: no bucketing of expenses into months, no summing, no
 * zero-filling. Contract 5 puts all of that on the server.
 */
import type { IsoDate, IsoMonth } from '../api/types';

const MONTH_LONG = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Month abbreviations, fixed rather than formatted.
 *
 * `Intl` is locale-dependent here in a way that matters visually: en-GB
 * abbreviates September to "Sept", which makes one bar-chart tick a character
 * wider than the other eleven and breaks the alignment the ruled layout is
 * built on. Three characters, always.
 */
const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });

function monthAbbr(month: IsoMonth): string {
  return MONTH_ABBR[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7);
}

/**
 * The month the dashboard opens on, in UTC.
 *
 * UTC rather than local because Contract 5c defines the last bar of the
 * month-over-month chart as the current month in SERVER UTC. Defaulting the
 * month picker to the local month would, on the handful of hours a month where
 * the two disagree, select a month the chart does not show.
 */
export function currentMonth(): IsoMonth {
  return new Date().toISOString().slice(0, 10).slice(0, 7);
}

/**
 * Today, in the user's LOCAL calendar - the right default for "when did you
 * spend this?", which is a question about the user's day, not the server's.
 */
export function todayIsoDate(): IsoDate {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Move a month by whole months: shiftMonth("2026-01", -1) === "2025-12". */
export function shiftMonth(month: IsoMonth, delta: number): IsoMonth {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  return new Date(Date.UTC(year, index, 1)).toISOString().slice(0, 7);
}

/** The month a calendar date falls in. Display only - never for aggregation. */
export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

/** "2026-09" -> "September 2026". */
export function formatMonthLong(month: IsoMonth): string {
  return MONTH_LONG.format(new Date(`${month}-01T00:00:00Z`));
}

/** "2026-09" -> "Sep". Axis ticks, where the year would be noise. */
export function formatMonthShort(month: IsoMonth): string {
  return monthAbbr(month);
}

/** "2026-09" -> "Sep 2026". Used where a bar tooltip needs the year back. */
export function formatMonthShortWithYear(month: IsoMonth): string {
  return `${monthAbbr(month)} ${month.slice(0, 4)}`;
}

/** "2026-09-04" -> "4 Sep 2026". */
export function formatDateMedium(date: IsoDate): string {
  return `${Number(date.slice(8, 10))} ${monthAbbr(monthOf(date))} ${date.slice(0, 4)}`;
}

/** "2026-09-04" -> "Fri 4 Sep". The ledger's row label. */
export function formatDateDay(date: IsoDate): string {
  const weekday = WEEKDAY_SHORT.format(new Date(`${date}T00:00:00Z`));
  return `${weekday} ${Number(date.slice(8, 10))} ${monthAbbr(monthOf(date))}`;
}

/** True for a well-formed "YYYY-MM". */
export function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/**
 * True for a real calendar date. Rejects "2026-02-31", which matches the
 * pattern but is not a day that exists.
 */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
