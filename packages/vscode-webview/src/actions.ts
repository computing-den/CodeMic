import { types as t } from '@codecast/lib';
import { updateStore } from './store.js';

let postMessage: (req: t.FrontendRequest) => Promise<t.BackendResponse>;

export function init(_postMessage: (req: t.FrontendRequest) => Promise<t.BackendResponse>) {
  postMessage = _postMessage;
}

export async function startRecorder(root?: t.AbsPath) {
  await postMessageAndUpdateStore({ type: 'record', root });
}

export async function pauseRecorder() {
  await postMessageAndUpdateStore({ type: 'pauseRecorder' });
}

// export async function closeRecorder() {
//   await postMessageAndUpdateStore({ type: 'closeRecorder' });
// }

// export async function saveRecording() {
//   await postMessageAndUpdateStore({ type: 'save' });
// }

// export async function discardRecorder() {
//   await postMessageAndUpdateStore({ type: 'discard' });
// }

export async function openWelcome() {
  await postMessageAndUpdateStore({ type: 'openWelcome' });
}

export async function openPlayer(sessionId: string) {
  await postMessageAndUpdateStore({ type: 'openPlayer', sessionId });
}

export async function openRecorder() {
  await postMessageAndUpdateStore({ type: 'openRecorder' });
}

// export async function askToCloseRecorder(): Promise<boolean> {
//   const res = await postMessageHelper({ type: 'askToCloseRecorder' }, 'boolean');
//   return res.value;
// }

export async function startPlayer(root?: t.AbsPath) {
  await postMessageAndUpdateStore({ type: 'play', root });
}

export async function pausePlayer() {
  await postMessageAndUpdateStore({ type: 'pausePlayer' });
}

// export async function closePlayer() {
//   await postMessageAndUpdateStore({ type: 'closePlayer' });
// }

export async function seek(clock: number) {
  await postMessageAndUpdateStore({ type: 'seek', clock });
}

export async function showOpenDialog(options: t.OpenDialogOptions): Promise<t.Uri[] | undefined> {
  return (await postMessageHelper({ type: 'showOpenDialog', options }, 'uris')).uris;
}

export async function getStore() {
  await postMessageAndUpdateStore({ type: 'getStore' });
}

async function postMessageAndUpdateStore(req: t.FrontendRequest) {
  const res = await postMessageHelper(req, 'getStore');
  updateStore(() => res.store);
}

type HasType<R, T extends string> = R & { type: T };

async function postMessageHelper<T extends string>(
  req: t.FrontendRequest,
  expectedType: T,
): Promise<HasType<t.BackendResponse, T>> {
  const res = await postMessage(req);
  if (res.type === 'error') {
    throw new Error(`Got error for request ${JSON.stringify(req)}`);
  }
  assertResType(req, res, expectedType);
  return res;
}

function assertResType<T extends string>(
  req: t.FrontendRequest,
  res: t.BackendResponse,
  type: T,
): asserts res is HasType<t.BackendResponse, T> {
  if (res.type !== type) {
    throw new Error(`Unknown response for request: ${JSON.stringify(req)}: ${JSON.stringify(res)}`);
  }
}
