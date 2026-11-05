import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from './i18n';
import '@fontsource/jost/700.css';
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/600.css';
import './app.css';
// Screen styles load after app.css so they can override it.
import { App } from './App';

document.documentElement.lang = t.locale.slice(0, 2);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
