import os from 'os';
import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import _ from 'lodash';

export default class SessionBody {
  private data: {
    editorEvents: t.EditorEvent[];
    audioTracks: t.AudioTrack[];
    videoTracks: t.VideoTrack[];
    defaultEol: t.EndOfLine;
    focusTimeline: t.Focus[];
  };

  constructor(data?: SessionBody['data']) {
    this.data = {
      editorEvents: data?.editorEvents ?? [],
      audioTracks: data?.audioTracks ?? [],
      videoTracks: data?.videoTracks ?? [],
      defaultEol: data?.defaultEol ?? (os.EOL as t.EndOfLine),
      focusTimeline: data?.focusTimeline ?? [],
    };
  }

  get editorEvents() {
    return this.data.editorEvents;
  }
  get audioTracks() {
    return this.data.audioTracks;
  }
  get videoTracks() {
    return this.data.videoTracks;
  }
  get defaultEol() {
    return this.data.defaultEol;
  }
  get focusTimeline() {
    return this.data.focusTimeline;
  }

  static fromJSON(json?: t.SessionBodyJSON): SessionBody {
    return new SessionBody(json);
  }

  toJSON(): t.SessionBodyJSON {
    return { ...this.data };
  }

  private withPatch(patch: Partial<SessionBody['data']>): SessionBody {
    return new SessionBody({ ...this.data, ...patch });
  }

  insertEditorEvents(events: t.EditorEvent[], at?: number): SessionBody {
    const editorEvents = this.data.editorEvents.slice();
    lib.insertIntoArray(editorEvents, events, at);
    return this.withPatch({ editorEvents });
  }

  deleteEditorEvents(at: number, delCount: number): SessionBody {
    const editorEvents = this.data.editorEvents.slice();
    editorEvents.splice(at, delCount);
    return this.withPatch({ editorEvents });
  }

  updateEditorEvents(
    from: number,
    toExclusive: number,
    f: (e: t.EditorEvent, i: number) => t.EditorEvent,
  ): SessionBody {
    const editorEvents = this.data.editorEvents.map((e, i) => (i < from || i >= toExclusive ? e : f(e, i)));
    return this.withPatch({ editorEvents });
  }
}
