import { useEffect, useState } from 'react';

/**
 * Chart colours, read from the live CSS custom properties.
 *
 * Recharts wants concrete colour values for its SVG paint, so rather than
 * duplicating the palette in TypeScript - which would drift from tokens.css the
 * first time either changed - this reads the computed values off the document
 * and re-reads them whenever the theme flips, in either direction: an explicit
 * choice (the data-theme attribute) or the system preference.
 *
 * The category colours are NOT here. Those come from the server on every
 * analytics row (Contract 5b denormalises `color` onto each category) and are
 * used exactly as sent.
 */
const TOKENS = [
  '--ink',
  '--ink-muted',
  '--ink-faint',
  '--rule',
  '--rule-strong',
  '--surface',
  '--surface-sunken',
  '--paper',
  '--accent',
  '--danger',
  '--positive',
] as const;

type TokenName = (typeof TOKENS)[number];
export type ThemeTokens = Record<TokenName, string>;

/** Used in jsdom and before stylesheets resolve, so charts never paint blank. */
const FALLBACK: ThemeTokens = {
  '--ink': '#14161a',
  '--ink-muted': '#565d66',
  '--ink-faint': '#6b7079',
  '--rule': '#e4e0d8',
  '--rule-strong': '#c6c1b5',
  '--surface': '#ffffff',
  '--surface-sunken': '#f4f2ec',
  '--paper': '#fbfaf7',
  '--accent': '#1d3a63',
  '--danger': '#a4291e',
  '--positive': '#2f6b4f',
};

function readTokens(): ThemeTokens {
  if (typeof window === 'undefined') return FALLBACK;
  const computed = getComputedStyle(document.documentElement);
  const entries = TOKENS.map((token) => [
    token,
    computed.getPropertyValue(token).trim() || FALLBACK[token],
  ]);
  return Object.fromEntries(entries) as ThemeTokens;
}

export function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(readTokens);

  useEffect(() => {
    const update = () => setTokens(readTokens());

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener('change', update);

    return () => {
      observer.disconnect();
      query.removeEventListener('change', update);
    };
  }, []);

  return tokens;
}

/**
 * Whether to animate. Recharts animates by default, and a chart that redraws
 * itself is exactly the kind of motion `prefers-reduced-motion` exists to stop.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

/** Shared axis styling, so the three charts read as one system. */
export const AXIS_TICK_STYLE = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.04em',
} as const;
