import { h, render } from 'preact';
import * as ui from './lib/ui';
import { provideVSCodeDesignSystem, allComponents } from '@vscode/webview-ui-toolkit';
import App from './app';

provideVSCodeDesignSystem().register(allComponents);

render(
  <App onRecordSession={recordSession} onBrowseSession={browseSession} onOpenSession={openSession} />,
  document.getElementById('app')!,
);

function recordSession() {
  postMessage({ type: 'record' });
}

function browseSession() {
  postMessage({ type: 'play' });
}

function openSession() {
  postMessage({ type: 'play' });
}

const vscode = acquireVsCodeApi();
// const oldState = vscode.getState() || { colors: [] };
// vscode.setState({ colors: colors });

window.addEventListener('message', event => {
  receivedMessage(event.data as ui.Event);
});

function postMessage(e: ui.Event) {
  vscode.postMessage(e);
}

function receivedMessage(e: ui.Event) {
  console.log('webview received: ', e);
}
