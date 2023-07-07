export type Event = SeekEvent | PlayEvent | StopEvent | PlaybackUpdate;

export type SeekEvent = {
  type: 'seek';
  time: number;
};

export type PlayEvent = {
  type: 'play';
};

export type StopEvent = {
  type: 'stop';
};

export type PlaybackUpdate = {
  type: 'playbackUpdate';
  time: number;
};
