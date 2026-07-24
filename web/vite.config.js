import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // I utvecklingsläge skickas /api vidare till backend, så att appen
    // använder samma relativa adresser som i produktion.
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Vite lägger annars in ett litet inline-skript i index.html. Det blockeras
    // av säkerhetsreglerna (CSP) i produktion och ger en helvit sida, trots att
    // allt fungerar lokalt. Polyfillen behövs inte i webbläsare som stöder moduler.
    modulePreload: { polyfill: false },
  },
});
