import { produce } from 'immer';

export type Store = {
  recorder: {
    isRecording: boolean;
  };
  player: {
    isPlaying: boolean;
  };
};

let store: Store = {
  recorder: {
    isRecording: false,
  },
  player: {
    isPlaying: false,
  },
};

export type Listener = (old: Store, cur: Store) => void;

let listener: Listener | undefined;

export function getStore(): Store {
  return store;
}

export function updateStore(recipe: (draft: Store) => void): Store {
  const old = store;
  store = produce(old, recipe);
  listener?.(old, store);
  return store;
}

export function listenToStore(l: Listener) {
  listener = l;
}
