import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isAndroidApp } from './lib/platform';
import { initTelegram } from './lib/telegram';
import { initTheme } from './lib/theme';
import { AppProvider } from './state';
import '@fontsource-variable/onest/index.css'; // Onest, served from our own files (latin, latin-ext, cyrillic); the CSP allows font-src 'self'
import './styles.css';

initTelegram();
initTheme(); // sets data-theme and the Telegram header colours
// Android 15+/targetSdk 36 draws web content behind the status bar and the gesture bar (edge-to-edge): styles.css pads the page only in the APK.
if (isAndroidApp) document.documentElement.dataset.app = 'android';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
