import { renderHook } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useHasMounted } from './use-has-mounted';

describe('useHasMounted', () => {
  it('returns true after the component has mounted on the client', () => {
    const { result } = renderHook(() => useHasMounted());

    expect(result.current).toBe(true);
  });

  it('returns false during server rendering (the SSR snapshot)', () => {
    function Probe() {
      return <span>{String(useHasMounted())}</span>;
    }

    const html = renderToStaticMarkup(<Probe />);

    expect(html).toBe('<span>false</span>');
  });
});
