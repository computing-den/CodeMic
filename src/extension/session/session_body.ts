import os from 'os';
import * as t from '../../lib/types.js';
import EventContainer from '../../lib/event_container.js';
import _ from 'lodash';

export default class SessionBody {
  audioTracks: t.AudioTrack[];
  videoTracks: t.VideoTrack[];
  eventContainer: EventContainer;
  defaultEol: t.EndOfLine;
  focusTimeline: t.WorkspaceFocusTimeline;

  constructor(json?: t.SessionBodyJSON) {
    this.audioTracks = json?.audioTracks ?? [];
    this.videoTracks = json?.videoTracks ?? [];
    this.eventContainer = new EventContainer(json?.editorTracks ?? {});
    this.defaultEol = json?.defaultEol ?? (os.EOL as t.EndOfLine);
    this.focusTimeline = json?.focusTimeline ?? { documents: [], lines: [] };
  }

  toJSON(): t.SessionBodyJSON {
    return {
      audioTracks: this.audioTracks,
      videoTracks: this.videoTracks,
      defaultEol: this.defaultEol,
      focusTimeline: this.focusTimeline,
      editorTracks: this.eventContainer.toJSON(),
    };
  }
}
