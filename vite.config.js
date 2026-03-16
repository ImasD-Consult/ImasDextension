import { defineConfig } from 'vite';

const TRIMBLE_HOSTS = {
  na: 'https://app.connect.trimble.com',
  eu: 'https://app21.connect.trimble.com',
  asia: 'https://app31.connect.trimble.com',
};

export default defineConfig({
  root: '.',
  server: {
    port: 3000,
    cors: true,
    proxy: {
      '/tc-api-na': {
        target: TRIMBLE_HOSTS.na,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tc-api-na/, '/tc/api/2.0'),
      },
      '/tc-api-eu': {
        target: TRIMBLE_HOSTS.eu,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tc-api-eu/, '/tc/api/2.0'),
      },
      '/tc-api-asia': {
        target: TRIMBLE_HOSTS.asia,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tc-api-asia/, '/tc/api/2.0'),
      },
    },
  },
  preview: {
    proxy: {
      '/tc-api-na': {
        target: TRIMBLE_HOSTS.na,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tc-api-na/, '/tc/api/2.0'),
      },
      '/tc-api-eu': {
        target: TRIMBLE_HOSTS.eu,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tc-api-eu/, '/tc/api/2.0'),
      },
      '/tc-api-asia': {
        target: TRIMBLE_HOSTS.asia,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tc-api-asia/, '/tc/api/2.0'),
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
