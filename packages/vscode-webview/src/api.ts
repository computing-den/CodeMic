import { types as t, bus as b, lib } from '@codecast/lib';
import { updateStore } from './store.js';
import MediaApi from './media_api.js';

const vscode = acquireVsCodeApi();
const bus = new b.Bus(postParcel, messageHandler);
const mediaApi = new MediaApi(postAudioEvent);
window.addEventListener('message', event => bus.handleParcel(event.data));

// type Listener = (req: t.BackendRequest) => Promise<t.FrontendResponse>;
// type ListenerMap = { [key in t.BackendRequest['type']]?: Listener };
// const listeners: ListenerMap = {};

export type PostMessageOptions = {
  performDefaultActions: boolean;
};

// export type MediaEventListener = (req: t.BackendMediaEvent) => Promise<t.FrontendResponse>;
// let mediaEventListener: MediaEventListener | undefined;

// export function setMediaEventListener(l?: MediaEventListener) {
// mediaEventListener = l;
// }

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

async function postAudioEvent(event: t.FrontendAudioEvent) {
  await postMessage({ type: 'audio', event });
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
    case 'audio/load': {
      await mediaApi.load(req.id, req.src);
      return { type: 'ok' };
    }
    case 'audio/play': {
      await mediaApi.getAudioManager(req.id).play();
      return { type: 'ok' };
    }
    case 'audio/pause': {
      await mediaApi.getAudioManager(req.id).pause();
      return { type: 'ok' };
    }
    case 'audio/stop': {
      await mediaApi.getAudioManager(req.id).stop();
      return { type: 'ok' };
    }
    case 'audio/dispose': {
      mediaApi.getAudioManager(req.id).dispose();
      return { type: 'ok' };
    }
    case 'audio/seek': {
      await mediaApi.getAudioManager(req.id).seek(req.clock);
      return { type: 'ok' };
    }
    case 'audio/setPlaybackRate': {
      await mediaApi.getAudioManager(req.id).setPlaybackRate(req.rate);
      return { type: 'ok' };
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
