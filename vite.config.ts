import { defineConfig } from 'vite';
import { imageProxy } from './image-proxy';

export default defineConfig({
  base: './',
  plugins: [imageProxy()],
  optimizeDeps: { include: ['hls.js'] },
  esbuild: { jsxFactory: 'h', jsxFragment: 'Fragment' },
  build: {
    target: 'chrome69',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 600,
    rollupOptions: { output: { manualChunks: { hls: ['hls.js'] } } },
  },
  server: { host: '0.0.0.0', port: 3000, strictPort: true },
  preview: { host: '0.0.0.0', port: 3000 },
});
