import * as ui from './lib/ui';
import { updateStore } from './store';

let postMessage: (req: ui.FrontendRequest) => Promise<ui.BackendResponse>;

export function init(_postMessage: (req: ui.FrontendRequest) => Promise<ui.BackendResponse>) {
  postMessage = _postMessage;
}

export async function startRecording() {
  await postMessageAndUpdateStore({ type: 'record' });
}

export async function stopRecording() {
  await postMessageAndUpdateStore({ type: 'stop' });
}

export async function saveRecording() {
  await postMessageAndUpdateStore({ type: 'save' });
}

export async function discardRecording() {
  await postMessageAndUpdateStore({ type: 'discard' });
}

export async function openPlayer() {
  await postMessageAndUpdateStore({ type: 'openPlayer' });
}

export async function startPlaying() {
  await postMessageAndUpdateStore({ type: 'play' });
}

export async function stopPlaying() {
  await postMessageAndUpdateStore({ type: 'stop' });
}

export async function seek(clock: number) {
  await postMessageAndUpdateStore({ type: 'seek', clock });
}

export async function getStore() {
  await postMessageAndUpdateStore({ type: 'getStore' });
}

async function postMessageAndUpdateStore(req: ui.FrontendRequest) {
  const res = await postMessage(req);

  if (res.type === 'getStore') {
    updateStore(() => res.store);
  } else if (res.type === 'error') {
    throw new Error(`Got error for request ${JSON.stringify(req)}`);
  } else {
    throw new Error(`Unknown response for request: ${JSON.stringify(req)}: ${JSON.stringify(res)}`);
  }
}
