import { h, render } from 'preact';
import { types as t, bus as b } from '@codecast/lib';
import { provideVSCodeDesignSystem, allComponents } from '@vscode/webview-ui-toolkit';
import App from './app.js';
import { getStore, listenToStore } from './store.js';
import * as actions from './actions.js';

provideVSCodeDesignSystem().register(allComponents);
const vscode = acquireVsCodeApi();
const bus = new b.Bus(postParcel, messageHandler);

actions.init(postMessage);
window.addEventListener('message', event => bus.handleParcel(event.data));
listenToStore(renderApp);
actions.getStore().then(renderApp).catch(console.error);

function renderApp() {
  render(<App store={getStore()} />, document.getElementById('app')!);
}

function postMessage(req: t.FrontendRequest): Promise<t.BackendResponse> {
  return bus.post(req) as Promise<t.BackendResponse>;
}

function postParcel(parcel: b.Parcel): Promise<boolean> {
  vscode.postMessage(parcel);
  return Promise.resolve(true);
}

async function messageHandler(req: t.BackendRequest): Promise<t.FrontendResponse> {
  console.log('webview received: ', req);

  // no backend requests to handle yet

  return { type: 'ok' };
}
