import { categoryColor, categoryLabel } from '../api/categories';
import type { CategoryKey } from '../api/types';

interface CategoryTickProps {
  category: CategoryKey;
  /** Prefer the colour and label the server denormalised onto the payload. */
  color?: string;
  label?: string;
}

/**
 * A category, shown as a short colour rule plus its label.
 *
 * The colour always comes from Contract 2 - from the server's denormalised
 * field where there is one, otherwise from the frozen local copy. The UI never
 * invents a palette, which is what keeps a category the same colour in the
 * pie, the bars, the meters and the ledger rows.
 *
 * Colour is never the only signal: the label is always present beside it.
 */
export function CategoryTick({ category, color, label }: CategoryTickProps) {
  return (
    <span className="cat">
      <span
        className="cat__tick"
        style={{ '--cat-color': color ?? categoryColor(category) } as React.CSSProperties}
      />
      <span className="cat__label">{label ?? categoryLabel(category)}</span>
    </span>
  );
}
