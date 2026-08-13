import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vite reads .env from its own root by default, which would silently ignore the
  // repository-root .env that everything else in this project uses.
  envDir: '..',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Proxying /api in development means the browser makes same-origin requests,
    // so CORS is exercised only in the deployed configuration.
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:5000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Charts are the heaviest dependency and are not needed to render the
        // call list, so they get their own chunk.
        manualChunks: {
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
