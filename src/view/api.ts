import * as t from '../lib/types.js';
import * as b from '../lib/bus.js';
import * as lib from '../lib/lib.js';
import { updateStore, getStore } from './store.js';
import { mediaManager } from './media_manager.js';

const vscode = acquireVsCodeApi();
const bus = new b.Bus(postParcel, messageHandler);
window.addEventListener('message', event => bus.handleParcel(event.data));

// type Listener = (req: t.BackendRequest) => Promise<t.FrontendResponse>;
// type ListenerMap = { [key in t.BackendRequest['type']]?: Listener };
// const listeners: ListenerMap = {};

// export type MediaEventListener = (req: t.BackendMediaEvent) => Promise<t.FrontendResponse>;
// let mediaEventListener: MediaEventListener | undefined;

// export function setMediaEventListener(l?: MediaEventListener) {
// mediaEventListener = l;
// }

// export function setMediaManager(m: MediaManager) {
//   mediaManager = m;
// }

export default async function postMessage<Req extends t.FrontendRequest>(
  req: Req,
): Promise<t.ExtractResponse<t.FrontendToBackendReqRes, Req>> {
  const res = (await bus.post(req)) as t.BackendResponse;

  if (res.type === 'error') {
    throw new Error(`Error: ${res.message || 'UNKNOWN'} \n | in response to request ${JSON.stringify(req)}`);
  }

  return res as any;
}

// export async function postMessageAndUpdateStore(req: t.FrontendRequest): Promise<t.Store> {
//   const res = await postMessage(req, 'getStore');
//   return updateStore(() => res.store);
// }

async function messageHandler(req: t.BackendRequest): Promise<t.FrontendResponse> {
  // console.log('webview received: ', req);

  if (req.type.startsWith('media/')) {
    return await mediaManager.handleRequest(req as t.BackendMediaRequest);
  }

  switch (req.type) {
    case 'updateStore': {
      updateStore(() => req.store);
      return { type: 'ok' };
    }
  }

  throw new Error(`Unknown request from backend: ${req.type}`);
}

//==================================================
// HELPERS
//==================================================

function postParcel(parcel: b.Parcel): Promise<boolean> {
  vscode.postMessage(parcel);
  return Promise.resolve(true);
}

// function postMessageBase(req: t.FrontendRequest): Promise<t.BackendResponse> {
// }

// function assertResType<T extends string>(
//   req: t.FrontendRequest,
//   res: t.BackendResponse,
//   type: T,
// ): asserts res is t.HasType<t.BackendResponse, T> {
//   if (res.type !== type) {
//     throw new Error(`Unknown response for request: ${JSON.stringify(req)}: ${JSON.stringify(res)}`);
//   }
// }
