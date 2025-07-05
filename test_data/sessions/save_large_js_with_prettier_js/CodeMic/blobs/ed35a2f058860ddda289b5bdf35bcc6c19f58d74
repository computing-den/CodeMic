export function throttleAsync(f) {
  let running = false;
  return async function throttleAsyncInner(...args) {
    if (running) return null;
    try {
      running = true;
      return await f(...args);
    } finally {
      running = false;
    }
  };
}

export function mkSharedAsyncResource() {
  let resource = null;
  let queue = [];
  const get = () => {
    if (!_.isNil(resource)) return Promise.resolve(resource);
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
    });
  };
  const set = x => {
    resource = x;
    if (!_.isNil(resource)) {
      for (const { resolve } of queue) resolve(resource);
      queue.length = 0;
    }
  };
  const peek = () => resource;
  const reset = () => (resource = null);

  return { get, set, peek, reset };
}
