import { produce } from 'immer';
import * as t from '../lib/types.js';

let store: t.Store;

export type Listener = (old: t.Store, cur: t.Store) => void;

let listener: Listener | undefined;

export function getStore(): t.Store {
  return store;
}

export function updateStore(recipe: (draft: t.Store) => void): t.Store {
  const old = store;
  store = produce(old, recipe);
  listener?.(old, store);
  return store;
}

export function setStoreListener(l: Listener) {
  listener = l;
}

//@ts-ignore
globalThis.getStore = getStore;
