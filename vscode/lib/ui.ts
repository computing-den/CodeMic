export type FrontendEvent =
  | { type: 'seek'; time: number }
  | { type: 'play' }
  | { type: 'record' }
  | { type: 'stop' }
  | { type: 'playbackUpdate'; time: number }
  | { type: 'getWorkspaceFolder' };
export type BackendResponse =
  | { type: 'yes' }
  | { type: 'no' }
  | { type: 'ack' }
  | { type: 'getWorkspaceFolder'; path?: string };

export type BackendEvent = { type: 'error' };
export type FrontendResponse = { type: 'yes' } | { type: 'no' } | { type: 'ack' };
