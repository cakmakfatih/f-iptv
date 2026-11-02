/**
 * Poster grid of the Series and Movies screens. Change `COLUMNS` to switch between the presets
 * (4 big cards per row, or the older 6 smaller ones); sizes are design pixels.
 */
const PRESETS = {
  4: { columns: 4, columnSize: 300, itemSize: 540, gap: 24, viewportSize: 700 },
  6: { columns: 6, columnSize: 208, itemSize: 360, gap: 20, viewportSize: 700 },
} as const;

export const COLUMNS: keyof typeof PRESETS = 4;

/** Spread onto the grid's VirtualList. */
export const GRID = PRESETS[COLUMNS];

/** Class for the grid element (the card text is larger when there are fewer columns). */
export const GRID_CLASS = ['catalog-grid', 'catalog-grid--c' + COLUMNS];
