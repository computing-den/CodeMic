import * as t from '../lib/types.js';
import * as b from '../lib/bus.js';
import * as lib from '../lib/lib.js';
import { updateStore } from './store.js';
import type MediaManager from './media_manager.js';

const vscode = acquireVsCodeApi();
const bus = new b.Bus(postParcel, messageHandler);
let mediaManager: MediaManager | undefined;
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

export function setMediaManager(m: MediaManager) {
  mediaManager = m;
}

export default async function postMessage<Req extends t.FrontendRequest>(
  req: Req,
  options?: PostMessageOptions,
): Promise<t.ExtractResponse<t.FrontendToBackendReqRes, Req>> {
  const performDefaultActions = options?.performDefaultActions ?? true;

  const res = (await bus.post(req)) as t.BackendResponse;

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

  return res as any;
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
    // case 'audio/load': {
    //   await mediaManager.load(req.id, req.src);
    //   return { type: 'ok' };
    // }
    case 'audio/play': {
      await mediaManager?.audioManager.play(req.id);
      return { type: 'ok' };
    }
    case 'audio/pause': {
      mediaManager?.audioManager.pause(req.id);
      return { type: 'ok' };
    }
    // case 'audio/stop': {
    //   await mediaManager.getAudioManager(req.id).stop();
    //   return { type: 'ok' };
    // }
    case 'audio/dispose': {
      mediaManager?.audioManager.dispose(req.id);
      return { type: 'ok' };
    }
    case 'audio/seek': {
      mediaManager?.audioManager.seek(req.id, req.clock);
      return { type: 'ok' };
    }
    case 'audio/setPlaybackRate': {
      mediaManager?.audioManager.setPlaybackRate(req.id, req.rate);
      return { type: 'ok' };
    }
    case 'video/loadTrack': {
      mediaManager?.videoManager.loadTrack(req.id);
      return { type: 'ok' };
    }
    case 'video/play': {
      await mediaManager?.videoManager.play();
      return { type: 'ok' };
    }
    case 'video/pause': {
      mediaManager?.videoManager.pause();
      return { type: 'ok' };
    }
    case 'video/stop': {
      mediaManager?.videoManager.stop();
      return { type: 'ok' };
    }
    case 'video/seek': {
      mediaManager?.videoManager.seek(req.clock);
      return { type: 'ok' };
    }
    case 'video/setPlaybackRate': {
      mediaManager?.videoManager.setPlaybackRate(req.rate);
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
