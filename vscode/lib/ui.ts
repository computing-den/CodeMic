export type FrontendEvent = SeekEvent | PlayEvent | RecordEvent | StopEvent | PlaybackUpdate;

export type SeekEvent = {
  type: 'seek';
  time: number;
};

export type PlayEvent = {
  type: 'play';
};

export type RecordEvent = {
  type: 'record';
};

export type StopEvent = {
  type: 'stop';
};

export type PlaybackUpdate = {
  type: 'playbackUpdate';
  time: number;
};

export type FrontendResponse = Yes | No | Ack;

export type BackendResponse = Yes | No | Ack;

export type BackendEvent = Error;

export type Error = { type: 'error' };
export type Yes = { type: 'yes' };
export type No = { type: 'no' };
export type Ack = { type: 'ack' };
