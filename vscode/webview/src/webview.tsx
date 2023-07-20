import { h, render } from 'preact';
import * as ui from './lib/ui';
import Bus from './lib/bus';
import type { MessageHandler, Parcel } from './lib/bus';
import { provideVSCodeDesignSystem, allComponents } from '@vscode/webview-ui-toolkit';
import App from './app';
import { getStore, listenToStore } from './store';

provideVSCodeDesignSystem().register(allComponents);
const vscode = acquireVsCodeApi();
const bus = new Bus(postParcel, messageHandler);

window.addEventListener('message', event => bus.handleParcel(event.data));
listenToStore(renderApp);
renderApp();

function renderApp() {
  render(<App store={getStore()} postMessage={postMessage} />, document.getElementById('app')!);
}

function postMessage(req: ui.FrontendRequest): Promise<ui.BackendResponse> {
  return bus.post(req) as Promise<ui.BackendResponse>;
}

function postParcel(parcel: Parcel): Promise<boolean> {
  vscode.postMessage(parcel);
  return Promise.resolve(true);
}

async function messageHandler(req: ui.BackendRequest): Promise<ui.FrontendResponse> {
  console.log('webview received: ', req);
  return { type: 'ack' };
}
