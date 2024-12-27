export let isWindows: boolean;
export let isBrowser: boolean;

if (typeof process === 'object') {
  isWindows = process.platform === 'win32';
  isBrowser = false;
} else if (typeof navigator === 'object') {
  isWindows = navigator.userAgent.indexOf('Windows') >= 0;
  isBrowser = true;
}
