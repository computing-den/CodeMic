import { produce, type Draft } from 'immer';
import MediaToolbar, * as MT from './media_toolbar.jsx';
import { h, Fragment, Component } from 'preact';
import { types as t, path, lib, assert } from '@codecast/lib';
// import FakeMedia from './fake_media.js';
import PathField from './path_field.jsx';
import Tabs, { type TabViewProps } from './tabs.jsx';
import { SessionSummary } from './session_summary.jsx';
import SessionDescription from './session_description.jsx';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage, { setMediaManager } from './api.js';
import MediaManager from './media_manager.js';
import { cn } from './misc.js';
import _ from 'lodash';

type Props = { user?: t.User; recorder: t.RecorderState };
export default class Recorder extends Component<Props> {
  mediaManager = new MediaManager();

  tabs = [
    { id: 'details-view', label: 'DETAILS' },
    { id: 'editor-view', label: 'EDITOR' },
  ];

  tabChanged = async (tabId: string) => {
    await postMessage({ type: 'recorder/openTab', tabId: tabId as t.RecorderTabId });
  };

  loadRecorder = async () => {
    await postMessage({ type: 'recorder/load' });
  };

  play = async (clock?: number) => {
    await this.mediaManager.prepare(this.getVideoElem());
    if (clock !== undefined) await postMessage({ type: 'recorder/seek', clock });
    await postMessage({ type: 'recorder/play' });
  };

  record = async (clock?: number) => {
    await this.mediaManager.prepare(this.getVideoElem());
    if (clock !== undefined) await postMessage({ type: 'recorder/seek', clock });
    await postMessage({ type: 'recorder/record' });
  };

  getVideoElem = (): HTMLVideoElement => {
    return document.querySelector('#guide-video')!;
  };

  updateResources() {
    const { audioTracks, videoTracks, webviewUris } = this.props.recorder;
    if (webviewUris) {
      this.mediaManager.updateResources(webviewUris, audioTracks, videoTracks);
    }
  }

  componentDidUpdate() {
    this.updateResources();
  }

  componentDidMount() {
    setMediaManager(this.mediaManager);
    this.updateResources();
  }

  componentWillUnmount() {
    this.mediaManager.close();
  }

  render() {
    return (
      <Screen className="recorder">
        <Tabs tabs={this.tabs} activeTabId={this.props.recorder.tabId} onTabChange={this.tabChanged}>
          <DetailsView id="details-view" className="" {...this.props} onLoadRecorder={this.loadRecorder} />
          <EditorView id="editor-view" className="" {...this.props} onRecord={this.record} onPlay={this.play} />
        </Tabs>
      </Screen>
    );
  }
}

type DetailsViewProps = Props & TabViewProps & { onLoadRecorder: () => any };

class DetailsView extends Component<DetailsViewProps> {
  titleChanged = async (e: InputEvent) => {
    const changes = { title: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'recorder/update', changes });
  };

  descriptionChanged = async (e: InputEvent) => {
    const changes = { description: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'recorder/update', changes });
  };

  save = async () => {
    await postMessage({ type: 'recorder/save' });
  };

  publish = async () => {
    await postMessage({ type: 'recorder/publish' });
  };

  render() {
    const { recorder, id, className, onLoadRecorder } = this.props;
    const { sessionSummary: ss } = recorder;

    return (
      <div id={id} className={className}>
        <vscode-text-area
          className="title subsection"
          rows={2}
          resize="vertical"
          value={ss.title}
          onInput={this.titleChanged}
          placeholder="The title of this project"
          autoFocus={!recorder.loaded}
        >
          Title
        </vscode-text-area>
        <vscode-text-area
          className="description subsection"
          rows={10}
          resize="vertical"
          value={ss.description}
          onInput={this.descriptionChanged}
          placeholder="What is this project about?"
        >
          Description
        </vscode-text-area>
        <p className="subsection help">
          Use <code>.gitignore</code> and <code>.codecastignore</code> to ignore paths.
        </p>
        <vscode-button className="subsection" onClick={this.save} disabled={recorder.mustScan}>
          Save
        </vscode-button>
        <vscode-button className="subsection" onClick={this.publish} disabled={recorder.mustScan}>
          Publish
        </vscode-button>
        {!recorder.loaded && (
          <vscode-button className="subsection" onClick={onLoadRecorder} autoFocus>
            {recorder.mustScan ? 'Scan workspace to start' : 'Load project into workspace'}
            <span className="codicon codicon-chevron-right va-top m-left_small" />
          </vscode-button>
        )}
      </div>
    );
  }
}

type Marker = {
  clock: number;
  type: 'clock' | 'anchor' | 'cursor' | 'selection';
  active?: boolean;
};

type EditorViewStateRecipe = (draft: Draft<EditorView['state']>) => EditorView['state'] | void;

type EditorViewProps = Props &
  TabViewProps & {
    onRecord: (clock?: number) => Promise<void>;
    onPlay: (clock?: number) => Promise<void>;
  };
type TrackSelection = { id: string; type: 'audio' | 'video' };

class EditorView extends Component<EditorViewProps> {
  state = {
    cursor: undefined as Marker | undefined,
    anchor: undefined as Marker | undefined,
    markers: [] as Marker[],
    trackSelection: undefined as TrackSelection | undefined,
  };

  updateState = (recipe: EditorViewStateRecipe) => this.setState(state => produce(state, recipe));

  insertAudio = async () => {
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        title: 'Select audio file',
        filters: { 'MP3 Audio': ['mp3'] },
      },
    });
    if (uris?.length === 1) {
      const clock = this.state.anchor?.clock ?? 0;
      await postMessage({ type: 'recorder/insertAudio', uri: uris[0], clock });
    }
  };

  insertVideo = async () => {
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        title: 'Select video file',
        filters: { 'MP4 Video': ['mp4'], 'WebM Video': ['webm'] },
      },
    });
    if (uris?.length === 1) {
      const clock = this.state.anchor?.clock ?? 0;
      await postMessage({ type: 'recorder/insertVideo', uri: uris[0], clock });
    }
  };

  render() {
    const { id, recorder, className, onRecord, onPlay } = this.props;
    const { sessionSummary: ss } = recorder;
    let primaryAction: MT.PrimaryAction;

    if (recorder.recording) {
      primaryAction = {
        type: 'recorder/pause',
        title: 'Record',
        onClick: async () => {
          await postMessage({ type: 'recorder/pause' });
        },
      };
    } else {
      primaryAction = {
        type: 'recorder/record',
        title: 'Record',
        disabled: recorder.playing,
        onClick: () => onRecord(this.state.anchor?.clock),
      };
    }

    const toolbarActions = [
      recorder.playing
        ? {
            title: 'Pause',
            icon: 'codicon-debug-pause',
            onClick: async () => {
              await postMessage({ type: 'recorder/pause' });
            },
          }
        : {
            title: 'Play',
            icon: 'codicon-play',
            disabled: recorder.recording,
            onClick: () => onPlay(this.state.anchor?.clock),
          },
      {
        title: 'Insert audio',
        icon: 'codicon-mic',
        disabled: recorder.playing || recorder.recording,
        onClick: this.insertAudio,
      },
      {
        title: 'Insert video',
        icon: 'codicon-device-camera-video',
        disabled: recorder.playing || recorder.recording,
        onClick: this.insertVideo,
      },
    ];

    return (
      <div id={id} className={className}>
        <MediaToolbar
          className="subsection subsection_spaced"
          primaryAction={primaryAction}
          actions={toolbarActions}
          clock={recorder.clock}
          duration={ss.duration}
        />
        <video id="guide-video" className="subsection" />
        <Timeline
          recorder={recorder}
          markers={this.state.markers}
          cursor={this.state.cursor}
          anchor={this.state.anchor}
          trackSelection={this.state.trackSelection}
          clock={recorder.clock}
          onChange={this.updateState}
        />
      </div>
    );
  }
}

type TimelineProps = {
  recorder: t.RecorderState;
  markers: Marker[];
  cursor?: Marker;
  anchor?: Marker;
  trackSelection?: TrackSelection;
  clock: number;
  onChange: (draft: EditorViewStateRecipe) => any;
};
class Timeline extends Component<TimelineProps> {
  state = {
    stepCount: 16,
  };

  getTimelineStepClock(): number {
    return calcTimelineStepClock(this.props.recorder.sessionSummary.duration, this.state.stepCount);
  }

  getTimelineDuration(): number {
    return this.getTimelineStepClock() * this.state.stepCount;
  }

  mouseMoved = (e: MouseEvent) => {
    const clock = this.getClockUnderMouse(e);
    // console.log(`mouseMoved to clock ${clock}`, e.target);
    this.props.onChange(state => {
      state.cursor = clock === undefined ? undefined : { clock, type: 'cursor' };
    });
  };

  mouseLeft = (e: MouseEvent) => {
    // console.log('mouseLeft', e.target);
    this.props.onChange(state => {
      state.cursor = undefined;
    });
  };

  mouseOut = (e: MouseEvent) => {
    // console.log('mouseOut', e.target);
  };

  mouseDown = (e: MouseEvent) => {
    const clock = this.getClockUnderMouse(e);
    if (clock !== undefined) {
      this.props.onChange(state => {
        for (const marker of state.markers) marker.active = false;
        state.anchor = { clock, type: 'anchor', active: true };
      });
    }
  };

  mouseUp = (e: MouseEvent) => {
    // const {anchor} = this.state;
    // if (anchor) {
    //   const clock = this.getClockUnderMouse(e);
    //   const tolerance = this.getTimelineDuration() / 300;
    //   if (clock !== undefined && lib.approxEqual(clock, anchor.clock, tolerance)) {
    //     this.updateState(state => {
    //       state.anchor = undefined;
    //       state.selection = {fromClock: anchor.clock, toClock: clock, active}
    //     })
    //   }
    // }
  };

  keyDown = async (e: KeyboardEvent) => {
    if (e.key === 'Delete') {
      if (this.props.trackSelection) {
        this.props.onChange(state => {
          state.trackSelection = undefined;
        });
        if (this.props.trackSelection.type === 'audio') {
          await postMessage({ type: 'recorder/deleteAudio', id: this.props.trackSelection.id });
        } else {
          await postMessage({ type: 'recorder/deleteVideo', id: this.props.trackSelection.id });
        }
      }
    }
  };

  trackClicked = (e: MouseEvent, track: t.RangedTrack) => {
    const type = this.props.recorder.audioTracks?.find(t => t.id === track.id) ? 'audio' : 'video';
    this.props.onChange(state => {
      state.trackSelection = { id: track.id, type };
    });
  };

  resized = () => {
    this.forceUpdate();
  };

  getTracks = () => _.concat(this.props.recorder?.audioTracks ?? [], this.props.recorder?.videoTracks ?? []);

  getClockUnderMouse(e: MouseEvent): number | undefined {
    const target = e.target as HTMLElement;
    if (target.closest('.track')) {
      return;
    }
    const clientPos = [e.clientX, e.clientY] as t.Vec2;
    const timeline = document.getElementById('timeline')!;
    const timelineRect = timeline.getBoundingClientRect();
    if (lib.vec2InRect(clientPos, timelineRect, { top: 5 })) {
      const mouseOffsetInTimeline = Math.max(0, clientPos[1] - timelineRect.top);
      const ratio = mouseOffsetInTimeline / timelineRect.height;
      return ratio * this.getTimelineDuration();
    }
  }

  componentDidUpdate() {}

  componentDidMount() {
    document.addEventListener('resize', this.resized);
    document.addEventListener('mousemove', this.mouseMoved);
    document.addEventListener('mousedown', this.mouseDown);
    document.addEventListener('mouseup', this.mouseUp);
    document.addEventListener('keydown', this.keyDown);

    const timeline = document.getElementById('timeline')!;
    timeline.addEventListener('mouseleave', this.mouseLeft);
    timeline.addEventListener('mouseout', this.mouseOut);
  }

  componentWillUnmount() {
    document.removeEventListener('resize', this.resized);
    document.removeEventListener('mousemove', this.mouseMoved);
    document.removeEventListener('mousedown', this.mouseDown);
    document.removeEventListener('mouseup', this.mouseUp);
    document.removeEventListener('keydown', this.keyDown);

    const timeline = document.getElementById('timeline')!;
    timeline.removeEventListener('mouseleave', this.mouseLeft);
    timeline.removeEventListener('mouseout', this.mouseOut);
  }

  render() {
    const { markers, cursor, anchor, clock, trackSelection } = this.props;
    const clockMarker: Marker | undefined = clock > 0 ? { clock, type: 'clock' } : undefined;

    const allMarkers = _.compact([...markers, cursor, anchor, clockMarker]);
    const timelineDuration = this.getTimelineDuration();

    return (
      <div id="timeline" className="subsection">
        <div className="timeline-body">
          <TracksUI
            tracks={this.getTracks()}
            timelineDuration={timelineDuration}
            trackSelection={trackSelection}
            onClick={this.trackClicked}
          />
          <div className="markers">
            {allMarkers.map(marker => (
              <MarkerUI marker={marker} timelineDuration={timelineDuration} />
            ))}
          </div>
        </div>
        <div id="ruler">
          {_.times(this.state.stepCount + 1, i => (
            <div className="step">
              <div className="indicator"></div>
              <div className="time">{lib.formatTimeSeconds(i * this.getTimelineStepClock())}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
}

type TracksUIProps = {
  tracks: t.RangedTrack[];
  timelineDuration: number;
  trackSelection?: TrackSelection;
  onClick: (e: MouseEvent, track: t.RangedTrack) => any;
};
// type TrackLayout = {columns: TrackLayoutColumn[]};
// type TrackLayoutColumn = {};
type TrackLayoutColumn = t.RangedTrack[];
class TracksUI extends Component<TracksUIProps> {
  render() {
    const { tracks, timelineDuration, trackSelection, onClick } = this.props;
    let columns: TrackLayoutColumn[] = [];

    for (const track of tracks) {
      this.fitTrackIntoColumns(track, columns);
    }

    columns = columns.map(column => this.orderedColumn(column));

    return (
      <div className="tracks">
        {columns.map(column => (
          <div className="tracks-column">
            {column.map(track => {
              const style = {
                top: `${(track.clockRange.start / timelineDuration) * 100}%`,
                bottom: `calc(100% - ${(track.clockRange.end / timelineDuration) * 100}%)`,
              };

              return (
                <div
                  className={cn('track', trackSelection?.id === track.id && 'active')}
                  style={style}
                  onClick={e => onClick(e, track)}
                >
                  <div className="title">{track.title}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  private fitTrackIntoColumns(track: t.RangedTrack, columns: TrackLayoutColumn[]) {
    for (const column of columns) {
      if (this.doesTrackFitInColumn(track, column)) {
        column.push(track);
        return;
      }
    }
    columns.push([track]);
  }

  private doesTrackFitInColumn(track: t.RangedTrack, column: TrackLayoutColumn): boolean {
    return column.every(track2 => !this.doTracksIntersect(track, track2));
  }

  private doTracksIntersect(t1: t.RangedTrack, t2: t.RangedTrack): boolean {
    return t2.clockRange.start < t1.clockRange.end && t1.clockRange.start < t2.clockRange.end;
  }

  private orderedColumn(columns: TrackLayoutColumn): TrackLayoutColumn {
    return _.orderBy(columns, track => track.clockRange.start);
  }
}

type MarkerProps = { marker: Marker; timelineDuration: number };
class MarkerUI extends Component<MarkerProps> {
  render() {
    const { marker, timelineDuration } = this.props;
    const style = {
      top: `${(marker.clock / timelineDuration) * 100}%`,
    };
    return (
      <div className={cn('marker', `marker_${marker.type}`, marker.active && 'marker_active')} style={style}>
        <div className="time">{lib.formatTimeSeconds(this.props.marker.clock)}</div>
      </div>
    );
  }
}

function roundTo(value: number, to: number) {
  assert(to > 0);
  return Math.floor((value + to - 1) / to) * to;
}

function calcTimelineStepClock(dur: number, steps: number): number {
  return Math.max(roundTo(dur / steps, 30), 30);
}
