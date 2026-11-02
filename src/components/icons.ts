import { registerIcons } from 'zapkit-tv';

/*
 * App icons as SVG paths (24x24). TV fonts often lack symbol glyphs such as
 * ⌕ or ❏, which then render as empty boxes, so icons never rely on text.
 */
registerIcons({
  search: 'M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  server: 'M4 4h16v6H4zm2 2v2h2V6zM4 14h16v6H4zm2 2v2h2v-2z',
  user: 'M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 11c4.4 0 8 2 8 4.5V21H4v-2.5C4 16 7.6 14 12 14z',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0zm3 4a1.5 1.5 0 0 0-1 2.6V18h2v-1.4a1.5 1.5 0 0 0-1-2.6z',
  tv: 'M3 5h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v9h16V7z',
  series: 'M4 6h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm6 4v6l5-3zM7 2h13a1 1 0 0 1 1 1v13h-2V4H7z',
  history: 'M13 3a9 9 0 1 1-8.5 12h2.1A7 7 0 1 0 6 9.5L8.5 12H2V5.5l2.6 2.6A9 9 0 0 1 13 3zm-1 4h2v5.2l3.6 2.1-1 1.7L12 13.4z',
  alert: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 5v7h2V7zm0 9v2h2v-2z',
  empty: 'M3 7l3-4h12l3 4v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm2.5 0h13l-1.5-2H7zM5 9v10h14V9zm4 2h6v2H9z',
});
