import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest: we write our own src/sw.ts which imports Workbox helpers.
      // This preserves all existing offline caching while allowing us to add
      // push and notificationclick handlers that GenerateSW cannot include.
      strategies:   'injectManifest',
      srcDir:       'src',
      filename:     'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      includeAssets: ['favicon.ico', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'NutriSmart — Indian Nutrition Tracker',
        short_name: 'NutriSmart',
        description: "India's first nutrition app with Kitchen Intelligence",
        theme_color: '#C8F75E',
        background_color: '#111113',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        categories: ['health', 'fitness'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          { name: 'Log Food', url: '/app/log', description: 'Quickly log a meal' },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': '/src' } },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react:    ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          dexie:    ['dexie'],
        },
      },
    },
  },
});
