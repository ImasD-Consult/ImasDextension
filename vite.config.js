import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 3000,
    cors: true,
  },
  build: {
    outDir: 'dist',
  },
});
