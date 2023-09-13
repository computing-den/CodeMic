import { types as t } from '@codecast/lib';
import { updateStore } from './store.js';

// let postMessageBase: (req: t.FrontendRequest) => Promise<t.BackendResponse>;

// export function init(_postMessageBase: (req: t.FrontendRequest) => Promise<t.BackendResponse>) {
//   postMessageBase = _postMessageBase;
// }

// export async function startRecorder() {
//   await postMessageAndUpdateStore({ type: 'record' });
// }

// export async function pauseRecorder() {
//   await postMessageAndUpdateStore({ type: 'pauseRecorder' });
// }

// export async function saveRecorder() {
//   await postMessage({ type: 'saveRecorder' }, 'ok');
// }

// // export async function closeRecorder() {
// //   await postMessageAndUpdateStore({ type: 'closeRecorder' });
// // }

// // export async function saveRecording() {
// //   await postMessageAndUpdateStore({ type: 'save' });
// // }

// // export async function discardRecorder() {
// //   await postMessageAndUpdateStore({ type: 'discard' });
// // }

// export async function openWelcome() {
//   await postMessageAndUpdateStore({ type: 'openWelcome' });
// }

// export async function openPlayer(sessionId: string) {
//   await postMessageAndUpdateStore({ type: 'openPlayer', sessionId });
// }

// export async function openRecorder(sessionId?: string, fork?: boolean, forkClock?: number) {
//   await postMessageAndUpdateStore({ type: 'openRecorder', sessionId, fork, forkClock });
// }

// export async function updateRecorder(changes: t.RecorderUpdate) {
//   await postMessageAndUpdateStore({ type: 'updateRecorder', changes });
// }

// export async function updatePlayer(changes: t.PlayerUpdate) {
//   await postMessageAndUpdateStore({ type: 'updatePlayer', changes });
// }

// export async function startPlayer() {
//   await postMessageAndUpdateStore({ type: 'play' });
// }

// export async function pausePlayer() {
//   await postMessageAndUpdateStore({ type: 'pausePlayer' });
// }

// export async function deleteSession(sessionId: string) {
//   await postMessageAndUpdateStore({ type: 'deleteSession', sessionId });
// }

// export async function test(value: any): Promise<t.Store> {
//   return await postMessageAndUpdateStore({ type: 'test', value: value });
// }

// export async function showOpenDialog(options: t.OpenDialogOptions): Promise<t.Uri[] | undefined> {
//   return (await postMessage({ type: 'showOpenDialog', options }, 'uris')).uris;
// }

// export async function getStore() {
//   await postMessageAndUpdateStore({ type: 'getStore' });
// }

// export async function confirmForkFromPlayer(clock: number): Promise<boolean> {
//   return (await postMessage({ type: 'confirmForkFromPlayer', clock }, 'boolean')).value;
// }

// export async function confirmEditFromPlayer(): Promise<boolean> {
//   return (await postMessage({ type: 'confirmEditFromPlayer' }, 'boolean')).value;
// }

// export async function mediaEvent(event: t.FrontendMediaEvent) {
//   await postMessageAndUpdateStore({ type: 'mediaEvent', event });
// }
