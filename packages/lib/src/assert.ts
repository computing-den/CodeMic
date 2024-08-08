export function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    debugger;
    throw new Error(`Assertion failed: ${message}` || 'Assertion failed');
  }
}
