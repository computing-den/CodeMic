import { types as t, bus as b, lib } from '@codecast/lib';
import { updateStore } from './store.js';

const vscode = acquireVsCodeApi();
const bus = new b.Bus(postParcel, messageHandler);
window.addEventListener('message', event => bus.handleParcel(event.data));

// type Listener = (req: t.BackendRequest) => Promise<t.FrontendResponse>;
// type ListenerMap = { [key in t.BackendRequest['type']]?: Listener };
// const listeners: ListenerMap = {};

export type PostMessageOptions = {
  performDefaultActions: boolean;
};

export type MediaEventListener = (req: t.BackendMediaEvent) => Promise<t.FrontendResponse>;
let mediaEventListener: MediaEventListener | undefined;

export function setMediaEventListener(l?: MediaEventListener) {
  mediaEventListener = l;
}

export default async function postMessage<Req extends t.FrontendRequest>(
  req: Req,
  options?: PostMessageOptions,
): Promise<t.BackendResponseFor<Req>> {
  const performDefaultActions = options?.performDefaultActions ?? true;

  const res = (await bus.post(req)) as t.BackendResponseFor<Req> | t.ErrorResponse;

  if (res.type === 'error') {
    throw new Error(`Got error for request ${JSON.stringify(req)}`);
  }

  if (performDefaultActions) {
    switch (res.type) {
      case 'store': {
        updateStore(() => res.store);
        break;
      }
      default:
        break;
    }
  }

  return res;
}

// export async function postMessageAndUpdateStore(req: t.FrontendRequest): Promise<t.Store> {
//   const res = await postMessage(req, 'getStore');
//   return updateStore(() => res.store);
// }

async function messageHandler(req: t.BackendRequest): Promise<t.FrontendResponse> {
  console.log('webview received: ', req);

  switch (req.type) {
    case 'updateStore': {
      updateStore(() => req.store);
      return { type: 'ok' };
    }
    case 'todo': {
      return { type: 'ok' };
    }
    case 'backendMediaEvent': {
      return mediaEventListener ? mediaEventListener(req.event) : { type: 'error' };
    }
    default: {
      lib.unreachable(req);
    }
  }
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
