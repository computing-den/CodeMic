import './config.js'; // Init config
import './api.js'; // Init extension <-> webview API

import React from 'react';
import { createRoot } from 'react-dom/client';
import { provideVSCodeDesignSystem, allComponents } from '@vscode/webview-ui-toolkit';
import App from './app.js';
import { getStore, setStoreListener } from './store.js';
import postMessage from './api.js';

async function load() {
  function renderApp() {
    root.render(<App store={getStore()} />);
  }

  provideVSCodeDesignSystem().register(allComponents);
  setStoreListener(renderApp);
  const root = createRoot(document.getElementById('app')!);

  try {
    // Backend will send the store.
    await postMessage({ type: 'webviewLoaded' });
  } catch (error) {
    console.error(error);
  }
}

window.onload = load;
