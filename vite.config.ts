import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { imageProxy } from './image-proxy';

const sdk = fileURLToPath(new URL('../zapkit-tv', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [imageProxy()],
  resolve: {
    alias: [
      { find: 'zapkit-tv/player', replacement: sdk + '/src/player/index.ts' },
      { find: 'zapkit-tv/styles.css', replacement: sdk + '/styles/zapkit-tv.css' },
      { find: /^zapkit-tv$/, replacement: sdk + '/src/index.ts' },
    ],
    // The SDK sources import incremental-dom too; use one copy.
    dedupe: ['incremental-dom'],
  },
  optimizeDeps: { include: ['incremental-dom', 'hls.js'] },
  esbuild: { jsxFactory: 'h', jsxFragment: 'Fragment' },
  build: {
    target: 'chrome69',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 600,
    rollupOptions: { output: { manualChunks: { hls: ['hls.js'] } } },
  },
  server: { host: '0.0.0.0', port: 3000, strictPort: true, fs: { allow: ['.', sdk] } },
  preview: { host: '0.0.0.0', port: 3000 },
});
