import React from 'react';
import { createRoot } from 'react-dom/client';
import { provideVSCodeDesignSystem, allComponents } from '@vscode/webview-ui-toolkit';
import App from './app.js';
import { getStore, setStoreListener } from './store.js';
import postMessage from './api.js';

provideVSCodeDesignSystem().register(allComponents);
setStoreListener(renderApp);
// postMessage({ type: 'getStore' }).catch(console.error);
const root = createRoot(document.getElementById('app')!);

function renderApp() {
  root.render(<App store={getStore()} />);
}
