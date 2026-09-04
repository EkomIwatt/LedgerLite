import { describe, expect, it } from 'vitest';
import {
  formatDateDay,
  formatDateMedium,
  formatMonthLong,
  formatMonthShort,
  isValidDate,
  isValidMonth,
  monthOf,
  shiftMonth,
} from '../lib/dates';
import {
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  minorToInputValue,
  parseAmountToMinor,
} from '../lib/money';

describe('formatMoney', () => {
  it('renders minor units as naira and kobo', () => {
    expect(formatMoney(249900)).toBe('₦2,499.00');
    expect(formatMoney(0)).toBe('₦0.00');
    expect(formatMoney(5)).toBe('₦0.05');
    expect(formatMoney(99)).toBe('₦0.99');
    expect(formatMoney(100)).toBe('₦1.00');
  });

  it('keeps the sign outside the symbol, because remaining_minor may be negative', () => {
    expect(formatMoney(-45000)).toBe('-₦450.00');
    expect(formatMoney(-1)).toBe('-₦0.01');
  });

  it('groups thousands without losing kobo to floating point', () => {
    expect(formatMoney(123456789)).toBe('₦1,234,567.89');
    // 8.29 is the classic float trap: 8.29 * 100 is 828.9999999999999.
    expect(formatMoney(829)).toBe('₦8.29');
  });
});

describe('parseAmountToMinor', () => {
  it('parses through string arithmetic, so no float error can enter the ledger', () => {
    expect(parseAmountToMinor('8.29')).toBe(829);
    expect(parseAmountToMinor('2499.00')).toBe(249900);
    expect(parseAmountToMinor('0.05')).toBe(5);
    expect(parseAmountToMinor('7')).toBe(700);
    expect(parseAmountToMinor('7.5')).toBe(750);
  });

  it('tolerates the separators people actually type', () => {
    expect(parseAmountToMinor(' 2,499.00 ')).toBe(249900);
    expect(parseAmountToMinor('₦1,000')).toBe(100000);
  });

  it('rejects anything that is not a usable amount', () => {
    expect(parseAmountToMinor('')).toBeNull();
    expect(parseAmountToMinor('.')).toBeNull();
    expect(parseAmountToMinor('abc')).toBeNull();
    expect(parseAmountToMinor('-5')).toBeNull();
    // Three decimal places is not a kobo amount.
    expect(parseAmountToMinor('1.234')).toBeNull();
  });

  it('round-trips with minorToInputValue', () => {
    for (const minor of [1, 99, 100, 829, 249900, 123456789]) {
      expect(parseAmountToMinor(minorToInputValue(minor))).toBe(minor);
    }
  });
});

describe('compact and percent formatting', () => {
  it('shortens axis figures without lying about the magnitude', () => {
    expect(formatMoneyCompact(14500000)).toBe('₦145k');
    expect(formatMoneyCompact(50000)).toBe('₦500');
    expect(formatMoneyCompact(0)).toBe('₦0');
  });

  it('prints percentages the way the server sends them: one decimal, no padding', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(73.4)).toBe('73.4%');
    // percent_used is allowed to exceed 100 and must not be clamped.
    expect(formatPercent(145)).toBe('145%');
  });
});

describe('calendar helpers', () => {
  it('shifts months across a year boundary', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-09', -6)).toBe('2026-03');
  });

  it('formats dates through UTC, so a calendar date never slips a day', () => {
    expect(formatMonthLong('2026-09')).toBe('September 2026');
    expect(formatMonthShort('2026-09')).toBe('Sep');
    expect(formatDateMedium('2026-09-04')).toBe('4 Sep 2026');
    expect(formatDateDay('2026-09-04')).toBe('Fri 4 Sep');
  });

  it('reads the month off a calendar date', () => {
    expect(monthOf('2026-09-04')).toBe('2026-09');
  });

  it('rejects dates that match the pattern but are not real days', () => {
    expect(isValidDate('2026-09-04')).toBe(true);
    expect(isValidDate('2026-02-31')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('04-09-2026')).toBe(false);
  });

  it('validates month strings', () => {
    expect(isValidMonth('2026-09')).toBe(true);
    expect(isValidMonth('2026-9')).toBe(false);
    expect(isValidMonth('2026-13')).toBe(false);
  });
});
