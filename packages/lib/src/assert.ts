export function assert(condition: any, message?: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}` || 'Assertion failed');
}
