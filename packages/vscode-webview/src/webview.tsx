import { h, render } from 'preact';
import { provideVSCodeDesignSystem, allComponents } from '@vscode/webview-ui-toolkit';
import App from './app.js';
import { getStore, setStoreListener } from './store.js';
import postMessage from './api.js';

provideVSCodeDesignSystem().register(allComponents);
setStoreListener(renderApp);
postMessage({ type: 'getStore' }).catch(console.error);

function renderApp() {
  render(<App store={getStore()} />, document.getElementById('app')!);
}
