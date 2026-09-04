import { useEffect, useState } from 'react';
import { CATEGORIES } from '../api/categories';
import { getCategories } from '../api/endpoints';
import type { Category } from '../api/types';

/**
 * The category vocabulary.
 *
 * Contract 2 permits the frontend to hardcode the list as a build-time
 * fallback, and requires the two copies to be identical. So this hook starts
 * from the local copy - no spinner, no empty select on first paint - and then
 * confirms it against GET /api/categories.
 *
 * The mismatch warning is a deliberate contract-drift canary. If Instance 1's
 * real list ever diverges from the frozen text, that shows up in the console
 * the first time the two halves are run together, instead of silently
 * recolouring a chart.
 */
export function useCategories(): readonly Category[] {
  const [categories, setCategories] = useState<readonly Category[]>(CATEGORIES);

  useEffect(() => {
    const controller = new AbortController();

    getCategories(controller.signal).then(
      (response) => {
        if (controller.signal.aborted) return;
        if (JSON.stringify(response.categories) !== JSON.stringify(CATEGORIES)) {
          console.warn(
            'Category vocabulary drift: GET /api/categories does not match the frozen ' +
              'Contract 2 list compiled into this build. Escalate rather than patching around it.',
            { server: response.categories, frozen: CATEGORIES },
          );
        }
        setCategories(response.categories);
      },
      () => {
        // The endpoint is public and static; if it is unreachable the frozen
        // copy is a correct answer, so this is not worth surfacing to the user.
      },
    );

    return () => controller.abort();
  }, []);

  return categories;
}
