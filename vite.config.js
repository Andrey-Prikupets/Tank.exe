import { defineConfig } from 'vite';

// Pure static site: no backend. Relative base lets `dist/` be served from any
// web server, sub-path, or CDN (GitHub Pages, S3, Netlify, ...).
export default defineConfig({
  base: './',
});
