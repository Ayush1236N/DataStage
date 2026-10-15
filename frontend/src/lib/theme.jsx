import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/* Palettes are art-directed: mint-led "observatory" default, plus alternates that
   stay inside the same tonal family so decks never look like a rainbow. */
export const PALETTES = {
  observatory: ['#5EE7C6', '#59A5F5', '#B98CF7', '#F5A35E', '#F2718C', '#7DE08A', '#E5D15E', '#6FD3E0'],
  ember: ['#F5A35E', '#F2718C', '#E5D15E', '#B98CF7', '#7DE08A', '#6FD3E0', '#5EE7C6', '#59A5F5'],
  cobalt: ['#59A5F5', '#6FD3E0', '#B98CF7', '#5EE7C6', '#E5D15E', '#F2718C', '#7DE08A', '#F5A35E'],
  mono: ['#5EE7C6', '#4FC9AF', '#41AB98', '#358E80', '#2A7269', '#215951', '#7DE08A', '#A8F0DC'],
};

const ThemeCtx = createContext(null);

export function ThemeProvider({ children }) {
  // The observatory dark theme is the product's identity, so it is the default for
  // everyone; a light theme is one click away and fully tokenised.
  const [mode, setMode] = useState('dark');
  const [palette, setPalette] = useState('observatory');
  const reducedMotion =
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', mode === 'light');
    root.classList.toggle('dark', mode === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      mode === 'light' ? '#f4f5f3' : '#080c0f',
    );
  }, [mode]);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')),
      palette,
      setPalette,
      colors: PALETTES[palette],
      reducedMotion,
      // chart chrome colours resolved from the active theme
      chrome:
        mode === 'dark'
          ? { text: '#8BA0AE', strong: '#E2ECF2', grid: 'rgba(255,255,255,0.07)', surface: '#121B21' }
          : { text: '#54646E', strong: '#0F171C', grid: 'rgba(0,0,0,0.08)', surface: '#FFFFFF' },
    }),
    [mode, palette, reducedMotion],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
