/**
 * Money.
 *
 * Project convention: money is ALWAYS an integer number of minor units (kobo).
 * Never a float, never a string. Every sum, difference and percentage happens
 * in minor units; formatting to "N2,499.00" is the last step before render.
 *
 * These helpers are therefore the only place a minor-unit integer is allowed to
 * become text, and the only place text is allowed to become a minor-unit
 * integer. Nothing in the app does arithmetic on a formatted string.
 */

const NAIRA = '₦';

const WHOLE_FORMATTER = new Intl.NumberFormat('en-NG', {
  maximumFractionDigits: 0,
});

/**
 * The canonical display form: `formatMoney(249900) === "N2,499.00"`.
 *
 * Negative values keep the sign OUTSIDE the symbol ("-N400.00") because
 * `remaining_minor` is allowed to go negative and that state must read as a
 * deficit at a glance, not as an odd-looking currency string.
 */
export function formatMoney(minor: number): string {
  const negative = minor < 0;
  const magnitude = Math.abs(minor);
  // The naira part is grouped as an integer and the kobo part is appended as
  // two literal digits, so no division result is ever handed to a formatter.
  const major = Math.trunc(magnitude / 100);
  const kobo = String(magnitude % 100).padStart(2, '0');
  const text = `${NAIRA}${WHOLE_FORMATTER.format(major)}.${kobo}`;
  return negative ? `-${text}` : text;
}

/**
 * A short form for axis ticks and dense chart labels, where two decimals and a
 * thousands separator would collide: 145_000_00 -> "N145k".
 */
export function formatMoneyCompact(minor: number): string {
  const negative = minor < 0;
  const major = Math.abs(minor) / 100;
  let text: string;
  if (major >= 1_000_000) text = `${WHOLE_FORMATTER.format(Math.round(major / 100_000) / 10)}m`;
  else if (major >= 1_000) text = `${WHOLE_FORMATTER.format(Math.round(major / 100) / 10)}k`;
  else text = WHOLE_FORMATTER.format(Math.round(major));
  return `${negative ? '-' : ''}${NAIRA}${text}`;
}

/** The bare major-unit value for a number input: 249900 -> "2499.00". */
export function minorToInputValue(minor: number): string {
  const negative = minor < 0;
  const magnitude = Math.abs(minor);
  const body = `${Math.trunc(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Parse what a user typed into minor units, or null if it is not a usable
 * amount. Done with string surgery rather than `parseFloat(x) * 100`, because
 * that multiplication is exactly where a rounding error would silently enter
 * the ledger: `parseFloat("8.29") * 100` is 828.9999999999999.
 */
export function parseAmountToMinor(input: string): number | null {
  const cleaned = input.trim().replace(/[\s,]/g, '').replace(NAIRA, '');
  if (cleaned === '' || !/^\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '.') return null;

  const [wholePart = '', fractionPart = ''] = cleaned.split('.');
  const whole = wholePart === '' ? 0 : Number(wholePart);
  const fraction = Number(fractionPart.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(whole) || !Number.isFinite(fraction)) return null;

  return whole * 100 + fraction;
}

/** A percentage rendered the way the server sends it: one decimal, no padding. */
export function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
