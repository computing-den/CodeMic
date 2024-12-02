export default function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    debugger;
    throw new Error(`${message}` || 'Assertion failed');
  }
}
