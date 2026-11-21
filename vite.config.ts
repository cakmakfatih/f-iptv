import { defineConfig } from 'vite';
import { imageProxy } from './image-proxy';

export default defineConfig({
  base: './',
  plugins: [imageProxy()],
  esbuild: { jsxFactory: 'h', jsxFragment: 'Fragment' },
  build: {
    target: 'chrome67',
    cssTarget: 'chrome67',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 600,
  },
  server: { host: '0.0.0.0', port: 3000, strictPort: true },
  preview: { host: '0.0.0.0', port: 3000 },
});
