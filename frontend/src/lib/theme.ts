import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

/**
 * Theme state, synchronised with the class applied by the inline script in
 * index.html. Reading the class rather than defaulting to "light" is what stops
 * the toggle from showing the wrong icon on first paint.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Follow the OS while the user has not made an explicit choice.
  useEffect(() => {
    if (localStorage.getItem('theme') !== null) return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setTheme(event.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggle };
}
