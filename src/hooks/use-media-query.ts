'use client';

import { useLayoutEffect, useEffect, useState } from 'react';

/**
 * `useLayoutEffect` warns when it runs during SSR because effects never fire
 * on the server. Falling back to `useEffect` on the server keeps the warning
 * away while still applying the measurement before paint in the browser.
 */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Tracks whether a CSS media query currently matches, kept in sync with the
 * viewport.
 *
 * The initial value is always `false` so the server render and the first
 * client render agree (avoiding hydration mismatches). The real match is
 * applied in a layout effect — before the browser paints — so breakpoint
 * driven layout (e.g. collapsing a sidebar on tablet) lands without a
 * visible flash.
 *
 * @param query - A media query string, e.g. `'(max-width: 767px)'`.
 * @returns `true` when the query matches the current viewport.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    setMatches(mediaQueryList.matches);

    const handleChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mediaQueryList.addEventListener('change', handleChange);
    return () => mediaQueryList.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
