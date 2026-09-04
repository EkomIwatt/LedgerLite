/**
 * Contract 2 — the FROZEN category vocabulary, transcribed verbatim.
 *
 * The server owns this list; `GET /api/categories` is the authority. This copy
 * exists only as the build-time fallback the contract explicitly permits, so
 * the app can render before (or without) that request resolving. The contract
 * requires the two copies to be IDENTICAL — key, label, colour and order.
 * `src/test/contract-conformance.test.ts` asserts exactly that.
 */
import type { Category, CategoryKey } from './types';

export const CATEGORIES: readonly Category[] = [
  { key: 'food', label: 'Food', color: '#E8734A' },
  { key: 'transport', label: 'Transport', color: '#4A8FE8' },
  { key: 'housing', label: 'Housing', color: '#7C5CE0' },
  { key: 'utilities', label: 'Utilities', color: '#2FA3A3' },
  { key: 'health', label: 'Health', color: '#E05C7B' },
  { key: 'entertainment', label: 'Entertainment', color: '#C77DE8' },
  { key: 'shopping', label: 'Shopping', color: '#E8A93A' },
  { key: 'education', label: 'Education', color: '#3F8F5B' },
  { key: 'savings', label: 'Savings', color: '#5B7FA6' },
  { key: 'other', label: 'Other', color: '#8A8F98' },
] as const;

/** Contract 2 order, used as the tie-break for several orderings. */
export const CATEGORY_ORDER: readonly CategoryKey[] = CATEGORIES.map((c) => c.key);

const BY_KEY = new Map<CategoryKey, Category>(CATEGORIES.map((c) => [c.key, c]));

/** Look up a category, or `undefined` for a key this build does not know. */
export function findCategory(key: CategoryKey): Category | undefined {
  return BY_KEY.get(key);
}

/**
 * The colour for a key, falling back to the neutral "other" swatch. Used only
 * where the server has not already denormalised a colour onto the payload —
 * analytics rows carry their own `color` and that one always wins.
 */
export function categoryColor(key: CategoryKey): string {
  return BY_KEY.get(key)?.color ?? '#8A8F98';
}

/** The human label for a key, falling back to the key itself. */
export function categoryLabel(key: CategoryKey): string {
  return BY_KEY.get(key)?.label ?? key;
}

/** Position in the Contract 2 order; unknown keys sort last. */
export function categoryRank(key: CategoryKey): number {
  const i = CATEGORY_ORDER.indexOf(key);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}
