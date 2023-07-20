import { produce } from 'immer';
import * as ui from './lib/ui';

let store: ui.Store = {};

export type Listener = (old: ui.Store, cur: ui.Store) => void;

let listener: Listener | undefined;

export function getStore(): ui.Store {
  return store;
}

export function updateStore(recipe: (draft: ui.Store) => void): ui.Store {
  const old = store;
  store = produce(old, recipe);
  listener?.(old, store);
  return store;
}

export function listenToStore(l: Listener) {
  listener = l;
}
