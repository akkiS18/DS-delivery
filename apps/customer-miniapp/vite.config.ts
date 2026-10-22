/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// The backend serves the built app at /app/ (same origin as /api, so no CORS and a single HTTPS URL for Telegram).
// In development the Vite server proxies /api to the backend; Telegram itself needs an HTTPS tunnel (see docs/MINIAPP_LOCAL_DEV.md).
//
// Android APK (Capacitor): `vite build --mode android` (debug) or `--mode android-release` (HTTPS API required). The web build and the
// Telegram Mini App are unchanged. The API origin is a build-time value (DS_API_BASE_URL); localhost on a phone is the phone itself.
const dropTelegramSdk = (): Plugin => ({
  name: 'ds-drop-telegram-sdk',
  transformIndexHtml: html => html.replace(/\s*<!--[^>]*Telegram Mini App SDK[^>]*-->\s*<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"><\/script>/, ''),
});

export default defineConfig(({ mode }) => {
  const android = mode === 'android' || mode === 'android-release';
  const release = mode === 'android-release';
  const apiBase = (process.env.DS_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (android) {
    if (!/^https?:\/\/[^\s/]+/.test(apiBase)) throw new Error('DS_API_BASE_URL must be set to the backend origin, e.g. https://api.example.com (http://10.0.2.2:4000 is allowed for debug builds only)');
    if (release && !apiBase.startsWith('https://')) throw new Error('Release builds require an https:// DS_API_BASE_URL');
  }
  return {
    base: './',
    plugins: [react(), ...(android ? [dropTelegramSdk()] : [])],
    define: {
      __DS_TARGET__: JSON.stringify(android ? 'android' : 'web'),
      __DS_RELEASE__: JSON.stringify(release),
      __DS_API_BASE__: JSON.stringify(android ? apiBase : ''),
    },
    server: { host: true, port: 5173, proxy: { '/api': { target: process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:4000', changeOrigin: false } } },
    build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 600, ...(android ? { outDir: 'dist-android', emptyOutDir: true } : {}) },
    test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
  };
});
