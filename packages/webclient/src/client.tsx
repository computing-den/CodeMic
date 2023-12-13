import { h, render } from 'preact';
import App from './app.js';

function renderApp() {
  render(<App />, document.getElementById('app')!);
}

renderApp();
