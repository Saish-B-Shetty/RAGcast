import { useCallback, useState } from 'react';

const KEY = 'ragcast_panel_w';
const MIN = 264;
const MAX = 560;
const DEFAULT = 344;

// Context-panel width, clamped 264–560px and persisted to localStorage.
export function usePanelWidth() {
  const [width, setWidthRaw] = useState<number>(() => {
    const saved = Number(localStorage.getItem(KEY));
    return saved >= MIN && saved <= MAX ? saved : DEFAULT;
  });

  const setWidth = useCallback((w: number) => {
    const clamped = Math.min(MAX, Math.max(MIN, w));
    setWidthRaw(clamped);
    localStorage.setItem(KEY, String(clamped));
  }, []);

  return { width, setWidth, MIN, MAX };
}
