import { produce, type Draft } from 'immer';
import MediaToolbar, * as MT from './media_toolbar.jsx';
import { h, Fragment, Component } from 'preact';
import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import { Vec2, Rect } from '../lib/lib.js';
import assert from '../lib/assert.js';
// import FakeMedia from './fake_media.js';
import PathField from './path_field.jsx';
import Tabs, { type TabViewProps } from './tabs.jsx';
import { SessionHead } from './session_head.jsx';
import SessionDescription from './session_description.jsx';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage, { setMediaManager } from './api.js';
import MediaManager from './media_manager.js';
import { cn } from './misc.js';
import _ from 'lodash';

const TRACK_HEIGHT_PX = 15;
const TRACK_MIN_GAP_PX = 1;
const TRACK_INDENT_PX = 5;
const TIMELINE_STEP_HEIGHT = 30;
const TIMELINE_INITIAL_STEP_DURATION = 30;
const TIMELINE_MIN_STEP_DURATION = 5;
const TIMELINE_ZOOM_MULTIPLIER = 10;

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
    const { audioTracks, videoTracks, blobsWebviewUris: webviewUris } = this.props.recorder;
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
          <DetailsView id="details-view" {...this.props} onLoadRecorder={this.loadRecorder} />
          <EditorView id="editor-view" {...this.props} onRecord={this.record} onPlay={this.play} />
        </Tabs>
      </Screen>
    );
  }
}

type DetailsViewProps = Props & TabViewProps & { onLoadRecorder: () => any };

class DetailsView extends Component<DetailsViewProps> {
  state = {
    // coverPhotoKey: 0,
  };
  titleChanged = async (e: InputEvent) => {
    const changes = { title: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'recorder/update', changes });
  };

  handleChanged = async (e: InputEvent) => {
    const changes = { handle: (e.target as HTMLInputElement).value };
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

  pickCoverPhoto = async (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        title: 'Select cover photo',
        filters: { Image: ['png', 'jpg', 'jpeg'] },
      },
    });
    if (uris?.length === 1) {
      await postMessage({ type: 'recorder/setCoverPhoto', uri: uris[0] });
      // this.setState({ coverPhotoKey: this.state.coverPhotoKey + 1 });
    }
  };

  deleteCoverPhoto = async (e: Event) => {
    await postMessage({ type: 'recorder/deleteCoverPhoto' });
  };

  render() {
    const { recorder, id, className, onLoadRecorder } = this.props;
    // const { coverPhotoKey } = this.state;
    const { sessionHead: s } = recorder;

    return (
      <div id={id} className={className}>
        <div className={cn('cover-photo-container', s.hasCoverPhoto && 'has-cover-photo')}>
          {s.hasCoverPhoto ? <img src={recorder.coverPhotoWebviewUri} /> : <p>NO COVER PHOTO</p>}
          <div className="buttons">
            {s.hasCoverPhoto && (
              <vscode-button
                className="delete"
                appearance="secondary"
                title="Delete cover photo"
                onClick={this.deleteCoverPhoto}
              >
                Delete cover
              </vscode-button>
            )}
            <vscode-button className="pick" onClick={this.pickCoverPhoto}>
              {s.hasCoverPhoto ? 'Change cover' : 'Pick cover'}
            </vscode-button>
          </div>
        </div>
        <div className="subsection">
          <label className="label"></label>
        </div>
        <vscode-text-area
          className="title subsection"
          rows={2}
          resize="vertical"
          value={s.title}
          onInput={this.titleChanged}
          placeholder="The title of this project"
          autoFocus={!recorder.loaded}
        >
          Title
        </vscode-text-area>
        <vscode-text-field
          className="subsection"
          placeholder="A-Z a-z 0-9 _ (e.g. my_project)"
          value={s.handle}
          onInput={this.handleChanged}
          disabled={Boolean(s.publishTimestamp)}
        >
          Handle
        </vscode-text-field>
        <vscode-text-area
          className="description subsection"
          rows={10}
          resize="vertical"
          value={s.description}
          onInput={this.descriptionChanged}
          placeholder="What is this project about?"
        >
          Description
        </vscode-text-area>
        <vscode-text-field
          className="subsection"
          // value={''}
          // onInput={this.descriptionChanged}
          placeholder="e.g. https://github.com/computing-den/codemic.git"
        >
          Git repository
        </vscode-text-field>
        <vscode-text-field
          className="subsection"
          // value={''}
          // onInput={this.descriptionChanged}
          placeholder="e.g. 86056b1"
        >
          Git commit
        </vscode-text-field>
        <p className="subsection help">
          Use <code>.codemicignore</code> to ignore paths.
        </p>
        <div className="subsection buttons">
          <vscode-button onClick={this.publish} disabled={!recorder.loaded}>
            Publish
          </vscode-button>
          <vscode-button appearance="secondary" onClick={this.save} disabled={recorder.mustScan}>
            Save
          </vscode-button>
        </div>
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
  type: 'clock' | 'anchor' | 'cursor' | 'selection' | 'end' | 'recording';
  active?: boolean;
  label?: string;
  draggable?: boolean;
};

type EditorViewStateRecipe = (draft: Draft<EditorView['state']>) => EditorView['state'] | void;

type EditorViewProps = Props &
  TabViewProps & {
    onRecord: (clock?: number) => Promise<void>;
    onPlay: (clock?: number) => Promise<void>;
  };
type TrackSelection = { id: string; type: 'audio' | 'video' | 'editor' };

class EditorView extends Component<EditorViewProps> {
  state = {
    cursor: undefined as Marker | undefined,
    anchor: undefined as Marker | undefined,
    markers: [] as Marker[],
    trackSelection: undefined as TrackSelection | undefined,
    // timelineHeightPx: 0,
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
    const { sessionHead: s } = recorder;
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
      {
        title: 'Insert image',
        icon: 'codicon-device-camera',
        disabled: recorder.playing || recorder.recording,
        onClick: () => console.log('TODO'),
      },
    ];

    return (
      <div id={id} className={className}>
        <MediaToolbar
          className="subsection subsection_spaced"
          primaryAction={primaryAction}
          actions={toolbarActions}
          clock={recorder.clock}
          duration={s.duration}
        />
        <div className="subsection subsection_spaced guide-video-container">
          <video id="guide-video" />
          <div className="empty-content">
            <span className="codicon codicon-device-camera-video" />
          </div>
        </div>
        <Timeline
          recorder={recorder}
          markers={this.state.markers}
          cursor={this.state.cursor}
          anchor={this.state.anchor}
          trackSelection={this.state.trackSelection}
          clock={recorder.clock}
          duration={recorder.sessionHead.duration}
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
  duration: number;
  onChange: (draft: EditorViewStateRecipe) => any;
};
type TimelineState = {
  stepDuration: number;
  trackDragStart?: TrackSelection & t.RangedTrack & { clock: number };
  markerDragStart?: Marker;
  // timelineHeightPx: number;
};
class Timeline extends Component<TimelineProps, TimelineState> {
  state = {
    stepDuration: TIMELINE_INITIAL_STEP_DURATION,
    trackDragStart: undefined,
    // timelineHeightPx: 1,
  } as TimelineState;

  zoomState:
    | {
        timestampMs: number;
        clock: number;
        clientY: number;
      }
    | undefined;

  // getTimelineStepClock(): number {
  //   return calcTimelineStepClock(this.props.recorder.sessionHead.duration, this.state.stepCount);
  // }

  getTimelineDuration(): number {
    return roundTo(this.props.recorder.sessionHead.duration + this.state.stepDuration * 4, this.state.stepDuration + 1);
  }

  wheelMoved = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();

      const clock = this.getClockUnderMouse(e);
      if (!clock) return;

      // if (!this.zoomState || this.zoomState.timestampMs < Date.now() - 300) {
      this.zoomState = { timestampMs: Date.now(), clock, clientY: e.clientY };
      console.log('setting zoomState: ', JSON.stringify(this.zoomState));
      // }

      const newStepDuration = this.state.stepDuration + (e.deltaY / 100) * TIMELINE_ZOOM_MULTIPLIER;
      const clippedStepDuration = Math.min(
        this.getTimelineDuration() / 2,
        Math.max(TIMELINE_MIN_STEP_DURATION, newStepDuration),
      );
      this.setState({ stepDuration: clippedStepDuration });

      // const deltaModes = { 0: 'pixel', 1: 'line', 2: 'page' } as Record<number, string>;
      // console.log(
      //   `wheel delta: ${e.deltaY}, wheel deltaMode: ${
      //     deltaModes[e.deltaMode]
      //   }, new step dur: ${newStepDuration}, clipped: ${clippedStepDuration}`,
      // );
    }
  };

  mouseMoved = (e: MouseEvent) => {
    const clock = this.getClockUnderMouse(e, { emptySpace: true });

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
    const clock = this.getClockUnderMouse(e, { emptySpace: true });
    if (clock !== undefined) {
      this.props.onChange(state => {
        for (const marker of state.markers) marker.active = false;
        state.anchor = { clock, type: 'anchor', active: true };
      });
    }
  };

  mouseUp = (e: MouseEvent) => {
    // const {anchor} = this.props;
    // if (anchor) {
    //   const clock = this.getClockUnderMouse(e, {emptySpace: true});
    //   const tolerance = this.getTimelineDuration() / 300;
    //   if (clock !== undefined && lib.approxEqual(clock, anchor.clock, tolerance)) {
    //     this.props.onChange(state => {
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

  getSelectionFromTrack = (track: t.RangedTrack): TrackSelection => {
    return { id: track.id, type: track.type };
  };

  trackClicked = (e: MouseEvent, track: t.RangedTrack) => {
    this.props.onChange(state => {
      state.trackSelection = track;
    });
  };

  trackDragStarted = (e: DragEvent, track: t.RangedTrack) => {
    e.dataTransfer?.setDragImage(new Image(), 0, 0);

    if (track.type === 'editor') return;

    const clock = this.getClockUnderMouse(e);
    if (!clock) return;

    console.log('trackDragStarted', track, clock);

    this.setState({ trackDragStart: { ...this.getSelectionFromTrack(track), ...track, clock } });
  };

  trackDragged = async (e: DragEvent, track: t.RangedTrack) => {
    const clock = this.getClockUnderMouse(e);
    const { trackDragStart } = this.state;
    if (!clock || !trackDragStart) return;

    const clockDiff = clock - trackDragStart.clock;
    const start = Math.max(0, trackDragStart.clockRange.start + clockDiff);
    const end = start + trackDragStart.clockRange.end - trackDragStart.clockRange.start;

    const clockRange: t.ClockRange = { start, end };

    console.log('trackDragged', track, clock, clockDiff);

    if (trackDragStart.type === 'audio') {
      await postMessage({ type: 'recorder/updateAudio', audio: { id: track.id, clockRange } });
    } else if (trackDragStart.type === 'video') {
      await postMessage({ type: 'recorder/updateVideo', video: { id: track.id, clockRange } });
    }
  };

  markerClicked = (e: MouseEvent, marker: Marker) => {
    console.log('Marker clicked', marker);
    this.props.onChange(state => {
      state.anchor = { clock: marker.clock, type: 'anchor', active: true };
    });
  };

  markerDragStarted = (e: DragEvent, marker: Marker) => {
    e.dataTransfer?.setDragImage(new Image(), 0, 0);
    //  if (!this.getClockUnderMouse(e)) return;

    this.setState({ markerDragStart: marker });
  };

  markerDragged = async (e: DragEvent, marker: Marker) => {
    const clock = this.getClockUnderMouse(e);
    const { markerDragStart } = this.state;
    if (!clock || !markerDragStart) return;
    if (markerDragStart.type === 'end') {
      const duration = Math.max(0, clock);
      await postMessage({ type: 'recorder/update', changes: { duration } });
    }
  };

  autoScroll = () => {
    const timeline = document.getElementById('timeline')!;
    const atBottom = timeline.scrollTop + timeline.clientHeight >= timeline.scrollHeight;
    if (!atBottom) {
      timeline.scrollTo({ top: timeline.scrollHeight, behavior: 'instant' });
    }
  };

  scrollAfterZoom = () => {
    /*
     __________  Timeline Body (TB) -|
    |          |                     |
    |          |                     |
    |          |                     |
    |          |                     |
    |__________| Timeline (T) -|     |
    |==========| + padding     |     |
    |          |               |     |
    |----------| ClientY (CY)  |     |
    |          |               |     |
    |__________|               |     |


    Clock@CY = ( (CY - TB.top) / TB.height ) * dur
    TB.top = CY - Clock@CY * TB.height / dur

    T.scroll = T.top + T.padding - TB.top
    T.scroll = T.top + T.padding - (CY - Clock@CY * TB.height / dur)

    */

    if (!this.zoomState) return;

    // Scroll timeline to keep the mouse position the same after zoom.
    const timeline = document.getElementById('timeline')!;
    const timelineBody = document.getElementById('timeline-body')!;
    const timelineRect = Rect.fromDOMRect(timeline.getBoundingClientRect());
    const timelineBodyRect = Rect.fromDOMRect(timelineBody.getBoundingClientRect());
    const dur = this.getTimelineDuration();
    const timelineTopPadding = parseFloat(window.getComputedStyle(timeline).paddingTop) || 0;

    console.log(
      `scroll: ${timeline.scrollTop} = T.top ${timelineRect.top} - TB.top ${
        timelineBodyRect.top
      } + TP ${timelineTopPadding} = ${timelineRect.top - timelineBodyRect.top + timelineTopPadding}`,
    );

    const top =
      timelineRect.top +
      timelineTopPadding -
      (this.zoomState.clientY - (this.zoomState.clock * timelineBodyRect.height) / dur);
    timeline.scrollTo({ behavior: 'instant', top });
  };

  getClockUnderMouse(e: MouseEvent, opts?: { emptySpace?: boolean }): number | undefined {
    if (opts?.emptySpace) {
      const target = e.target as HTMLElement;
      if (target.closest('.track') || target.closest('.marker')) return;
    }

    const clientPos = new Vec2(e.clientX, e.clientY);
    const timeline = document.getElementById('timeline')!;
    const timelineBody = document.getElementById('timeline-body')!;
    const timelineRect = Rect.fromDOMRect(timeline.getBoundingClientRect());
    const timelineBodyRect = Rect.fromDOMRect(timelineBody.getBoundingClientRect());
    if (timelineRect.isPointInRect(clientPos)) {
      const mouseOffsetInTimelineBody = Math.min(
        timelineBodyRect.height,
        Math.max(0, clientPos.y - timelineBodyRect.top),
      );
      const ratio = mouseOffsetInTimelineBody / timelineBodyRect.height;
      return ratio * this.getTimelineDuration();
    }
  }

  // updateTimelineHeightPx = () => {
  //   const timelineHeightPx = document.getElementById('timeline-body')!.getBoundingClientRect().height;
  //   if (timelineHeightPx !== this.state.timelineHeightPx) {
  //     console.log('updateTimelineHeightPx', timelineHeightPx);
  //     this.setState({ timelineHeightPx });
  //   }
  // };

  // resized = () => this.updateTimelineHeightPx();

  componentDidMount() {
    // window.addEventListener('resize', this.resized);
    // this.updateTimelineHeightPx();

    document.addEventListener('wheel', this.wheelMoved);
    document.addEventListener('mousemove', this.mouseMoved);
    document.addEventListener('mousedown', this.mouseDown);
    document.addEventListener('mouseup', this.mouseUp);
    document.addEventListener('keydown', this.keyDown);

    const timelineBody = document.getElementById('timeline-body')!;
    timelineBody.addEventListener('mouseleave', this.mouseLeft);
    timelineBody.addEventListener('mouseout', this.mouseOut);
  }

  componentWillUnmount() {
    // window.removeEventListener('resize', this.resized);

    document.removeEventListener('wheel', this.wheelMoved);
    document.removeEventListener('mousemove', this.mouseMoved);
    document.removeEventListener('mousedown', this.mouseDown);
    document.removeEventListener('mouseup', this.mouseUp);
    document.removeEventListener('keydown', this.keyDown);

    const timelineBody = document.getElementById('timeline-body')!;
    timelineBody.removeEventListener('mouseleave', this.mouseLeft);
    timelineBody.removeEventListener('mouseout', this.mouseOut);
  }

  componentDidUpdate(prevProps: TimelineProps, prevState: TimelineState) {
    if (this.props.recorder.recording) {
      this.autoScroll();
    }

    if (prevState.stepDuration !== this.state.stepDuration) {
      this.scrollAfterZoom();
    }
  }

  render() {
    const { markers, cursor, anchor, clock, trackSelection, duration, recorder } = this.props;
    const { stepDuration /*timelineHeightPx*/ } = this.state;
    const clockMarker: Marker | undefined =
      clock > 0 && clock !== duration && !recorder.recording ? { clock, type: 'clock' } : undefined;
    const endOrRecordingMarker: Marker = recorder.recording
      ? { clock: duration, type: 'recording' }
      : { clock: duration, type: 'end', draggable: true };

    const allMarkers = _.compact([
      ...markers,
      cursor,
      !recorder.playing && !recorder.recording && anchor,
      clockMarker,
      endOrRecordingMarker,
    ]);
    const timelineDuration = this.getTimelineDuration();

    // const groupedEditorTracks = groupEditorEvents(recorder.editorTrack!.events, timelineDuration, timelineHeightPx);
    const tracks = _.orderBy(
      _.concat<t.RangedTrack>(recorder.audioTracks ?? [], recorder.videoTracks ?? []),
      track => track.clockRange.start,
    );

    return (
      <div id="timeline" className="subsection">
        <div
          id="timeline-body"
          style={{ minHeight: `${(this.getTimelineDuration() / stepDuration + 1) * TIMELINE_STEP_HEIGHT}px` }}
        >
          <div className="timeline-grid">
            <EditorTrackUI
              workspaceFocusTimeline={recorder.workspaceFocusTimeline}
              timelineDuration={timelineDuration}
              // timelineHeightPx={timelineHeightPx}
              stepDuration={stepDuration}
            />
            <RangedTracksUI
              timelineDuration={timelineDuration}
              tracks={tracks}
              trackSelection={trackSelection}
              onClick={this.trackClicked}
              onDrag={this.trackDragged}
              onDragStart={this.trackDragStarted}
            />
            <div className="markers">
              {allMarkers.map(marker => (
                <MarkerUI
                  marker={marker}
                  timelineDuration={timelineDuration}
                  onClick={this.markerClicked}
                  onDragStart={this.markerDragStarted}
                  onDrag={this.markerDragged}
                />
              ))}
            </div>
          </div>
          <div id="ruler">
            {_.times(this.getTimelineDuration() / stepDuration + 1, i => (
              <div className="step">
                <div className="indicator"></div>
                <div className="time">{lib.formatTimeSeconds(i * stepDuration)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
}

type RangedTracksUIProps = {
  timelineDuration: number;
  tracks: t.RangedTrack[];
  trackSelection?: TrackSelection;
  onClick: (e: MouseEvent, track: t.RangedTrack) => any;
  onDragStart: (e: DragEvent, track: t.RangedTrack) => any;
  onDrag: (e: DragEvent, track: t.RangedTrack) => any;
};
// type RangedTrackLayout = {
//   start: number;
//   end: number;
//   track: t.RangedTrack;
//   indent: number;
// };
// type TrackLayout = {columns: RangedTrackLayoutColumn[]};
// type RangedTrackLayoutColumn = {};
// type RangedTrackLayoutColumn = t.RangedTrack[];
class RangedTracksUI extends Component<RangedTracksUIProps> {
  render() {
    const { tracks, timelineDuration, trackSelection, onClick, onDrag, onDragStart } = this.props;

    // let layouts: RangedTrackLayout[] = [];

    // Two columns
    // for (let i = 0; i < tracks.length; ) {
    //   if (i === tracks.length - 1 || !doClockRangesIntersect(tracks[i], tracks[i + 1])) {
    //     layouts.push({ start: 0, end: 2, track: tracks[i] });
    //     i++;
    //   } else {
    //     layouts.push({ start: 0, end: 1, track: tracks[i] });
    //     layouts.push({ start: 1, end: 2, track: tracks[i + 1] });
    //     i += 2;
    //   }
    // }

    // Single column
    // for (const [i, track] of tracks.entries()) {
    //   let indent = 0;
    //   for (const track2 of tracks.slice(0, i)) {
    //     if (lib.doClockRangesIntersect(track.clockRange, track2.clockRange)) indent++;
    //   }
    //   layouts.push({ start: 0, end: 2, track, indent });
    // }

    // const columnHalfGap = 0.25;

    const layouts: { track: t.RangedTrack; indent: number }[] = tracks.map(track => ({ track, indent: 0 }));
    for (const [i, layout] of layouts.entries()) {
      for (const layout2 of layouts.slice(0, i)) {
        if (lib.doClockRangesIntersect(layout.track.clockRange, layout2.track.clockRange)) {
          layout.indent = Math.max(layout.indent, layout2.indent) + 1;
        }
      }
    }

    return (
      <div className="ranged-tracks">
        {layouts.map(({ indent, track }, i) => {
          const indentPx = indent * TRACK_INDENT_PX;

          const style = {
            // left: `calc(${start * 50}% + ${columnHalfGap}rem + ${indent * TRACK_INDENT_PX}px)`,
            // width: `calc(${(end - start) * 50}% - ${columnHalfGap * 2}rem - ${indent * TRACK_INDENT_PX}px)`,
            right: `${indentPx}px`,
            maxWidth: `calc(50% - ${indentPx})`,
            top: `${(track.clockRange.start / timelineDuration) * 100}%`,
            bottom: `calc(100% - ${(track.clockRange.end / timelineDuration) * 100}%)`,
            minHeight: `${TRACK_HEIGHT_PX}px`,
          };

          const icon =
            track.type === 'audio' ? 'codicon-mic' : track.type === 'video' ? 'codicon-device-camera-video' : '';

          return (
            <div
              key={track.id}
              className={cn('track', trackSelection?.id === track.id && 'active')}
              style={style}
              onClick={e => onClick(e, track)}
              onDragStart={e => onDragStart(e, track)}
              onDrag={e => onDrag(e, track)}
              draggable
            >
              <p>
                <span className={`codicon va-middle m-right_small ${icon}`} />
                {track.title}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  // private fitTrackIntoColumns(track: t.RangedTrack, columns: RangedTrackLayoutColumn[]) {
  //   for (const column of columns) {
  //     if (this.doesTrackFitInColumn(track, column)) {
  //       column.push(track);
  //       return;
  //     }
  //   }
  //   columns.push([track]);
  // }

  // private doesTrackFitInColumn(track: t.RangedTrack, column: RangedTrackLayoutColumn): boolean {
  //   return column.every(track2 => !this.doClockRangesIntersect(track, track2));
  // }

  // private orderedColumn(columns: RangedTrackLayoutColumn): RangedTrackLayoutColumn {
  //   return _.orderBy(columns, track => track.clockRange.start);
  // }
}

type EditorTrackUIProps = {
  timelineDuration: number;
  stepDuration: number;
  workspaceFocusTimeline?: t.WorkspaceFocusTimeline;
};
class EditorTrackUI extends Component<EditorTrackUIProps> {
  render() {
    const { timelineDuration, stepDuration, workspaceFocusTimeline } = this.props;

    // const lineFocusItems:t.LineFocus [] = [];
    // if (workspaceFocusTimeline) {
    //   const { documents, lines } = workspaceFocusTimeline;
    //   const durationOfOneLine = (TRACK_HEIGHT_PX * timelineDuration) / timelineHeightPx;

    //   // Cut duration of document focus items to durationOfOneLine.
    //   const clockRangesOfOccupiedLines: t.ClockRange[] = documents.map(x => ({
    //     start: x.clockRange.start,
    //     end: x.clockRange.start + durationOfOneLine,
    //   }));

    //   for (const line of lines) {
    //     const lineClockRange: t.ClockRange = {
    //       start: line.clockRange.start,
    //       end: line.clockRange.start + durationOfOneLine,
    //     };

    //     // TODO write an algorithm with better time complexity.
    //     if (!clockRangesOfOccupiedLines.some(x => lib.doClockRangesIntersect(x, lineClockRange))) {
    //       lineFocusItems.push(line);
    //     }
    //   }
    // }

    // Skip lines that may cut into the previous line.
    const lineFocusTimeline: (t.LineFocus & { offsetPx?: number })[] = [];
    // const heightOf1Sec = timelineHeightPx / timelineDuration;
    const heightOf1Sec = TIMELINE_STEP_HEIGHT / stepDuration;
    for (const lineFocus of workspaceFocusTimeline?.lines || []) {
      const lastLineFocus = lineFocusTimeline.at(-1);
      if (!lastLineFocus) {
        lineFocusTimeline.push(lineFocus);
        continue;
      }

      // The following:

      // | first line
      // | | second line
      // | |
      //   |
      //
      // must be turned into this:
      //
      // | first line
      // | |
      // | |
      //   | second line

      const lastLineBottomPx = lastLineFocus.clockRange.start * heightOf1Sec + TRACK_HEIGHT_PX;
      const lineOriginalTopPx = lineFocus.clockRange.start * heightOf1Sec;
      const lineOriginalBottomPx = lineFocus.clockRange.end * heightOf1Sec;

      const availableSpace = lineOriginalBottomPx - lastLineBottomPx;
      const requiredSpace = TRACK_HEIGHT_PX + TRACK_MIN_GAP_PX;

      if (availableSpace < requiredSpace) continue;

      const lineTopPx = Math.max(lastLineBottomPx + TRACK_MIN_GAP_PX, lineOriginalTopPx);
      lineFocusTimeline.push({ ...lineFocus, offsetPx: lineTopPx - lineOriginalTopPx });
    }

    return (
      <div className="editor-track">
        {workspaceFocusTimeline?.documents?.map(documentFocus => {
          const style = {
            top: `${(documentFocus.clockRange.start / timelineDuration) * 100}%`,
            bottom: `calc(100% - ${(documentFocus.clockRange.end / timelineDuration) * 100}%)`,
            minHeight: `${TRACK_HEIGHT_PX}px`,
          };
          return (
            <div className="document-focus" style={style}>
              {/*path.getUriShortNameOpt(documentFocus.uri) || 'unknown file'*/}
            </div>
          );
        })}
        {lineFocusTimeline.map(lineFocus => {
          const style = {
            top: `${(lineFocus.clockRange.start / timelineDuration) * 100}%`,
            paddingTop: `${lineFocus.offsetPx ?? 0}px`,
            bottom: `calc(100% - ${(lineFocus.clockRange.end / timelineDuration) * 100}%)`,
            minHeight: `${TRACK_HEIGHT_PX}px`,
          };
          return (
            <div className="line-focus" style={style}>
              {lineFocus.text}
            </div>
          );
        })}
      </div>
    );
  }
}

// const EDITOR_TRACK_COLUMN_COUNT = 2;
// class EditorTrackUI extends Component<EditorTrackUIProps> {
//   render() {
//     const { timelineDuration } = this.props;
//     const columns: h.JSX.Element[][] = _.times(EDITOR_TRACK_COLUMN_COUNT, () => []);

//     const eventGroups = this.groupEditorEvents();

//     for (const [i, g] of eventGroups.entries()) {
//       const style = {
//         top: `${(g.events[0].clock / timelineDuration) * 100}%`,
//         bottom: `calc(100% - ${(g.events.at(-1)!.clock / timelineDuration) * 100}%)`,
//       };

//       let text = '';
//       if (g.type === 'textChange') {
//         text = g.events
//           .flatMap(e => e.contentChanges.map(cc => cc.text))
//           .join('')
//           .replace(/\n+/g, '\n')
//           .trim();
//       }

//       const uri = g.events.at(-1)?.uri;
//       let p: t.Path | undefined;
//       let basename: string | undefined;

//       if (uri) {
//         p = path.getUriPathOpt(uri);
//         basename = p && path.basename(p);
//         basename ??= path.getUntitledUriNameOpt(uri);
//       }

//       const title = [p, text].filter(Boolean).join('\n');

//       let label = '';
//       let icon = '';
//       if (g.type === 'documentChange') {
//         label = basename || 'document';
//         icon = 'codicon-file';
//       } else {
//         label = text || 'text';
//       }

//       const elem = (
//         <div className={`track ${g.type}`} title={title} style={style}>
//           <p>
//             {icon && <span className={`codicon va-middle m-right_small ${icon}`} />}
//             {label}
//           </p>
//         </div>
//       );
//       columns[i % columns.length].push(elem);
//     }

//     return (
//       <div className="editor-track">
//         {columns.map(column => (
//           <div className="column">{column}</div>
//         ))}
//       </div>
//     );
//   }
// }

type MarkerProps = {
  marker: Marker;
  timelineDuration: number;
  onClick?: (e: MouseEvent, m: Marker) => any;
  onDragStart?: (e: DragEvent, m: Marker) => any;
  onDrag?: (e: DragEvent, m: Marker) => any;
};
class MarkerUI extends Component<MarkerProps> {
  clicked = (e: MouseEvent) => this.props.onClick?.(e, this.props.marker);
  dragStarted = (e: DragEvent) => this.props.onDragStart?.(e, this.props.marker);
  dragged = (e: DragEvent) => this.props.onDrag?.(e, this.props.marker);

  render() {
    const { marker, timelineDuration } = this.props;
    const style = {
      top: `${(marker.clock / timelineDuration) * 100}%`,
    };
    return (
      <div
        className={cn('marker', `marker_${marker.type}`, marker.active && 'marker_active', marker.draggable)}
        style={style}
        onClick={this.clicked}
        onDragStart={this.dragStarted}
        onDrag={this.dragged}
        draggable={marker.draggable}
      >
        <div className="time">
          {lib.formatTimeSeconds(marker.clock)}
          {marker.label ? ' ' + marker.label : ''}
        </div>
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

// function groupEditorEvents(
//   events: t.EditorEvent[],
//   timelineDuration: number,
//   timelineHeightPx: number,
// ): EditorRangedTrack[] {
//   const groups: EditorRangedTrack[] = [];
//   for (const e of events) {
//     const groupType = EDITOR_EVENT_GROUP_TYPE_MAP[e.type] as EditorRangedTrack['groupType'] | undefined;
//     if (!groupType) continue;

//     const lastGroup = groups.at(-1);
//     const lastEvent = lastGroup?.events.at(-1);
//     const groupChanged = lastGroup && groupType !== lastGroup.groupType;
//     const uriChanged = lastEvent && lastEvent.uri !== e.uri;
//     const thereWasALongPause = lastEvent && e.clock - lastEvent.clock > 5;

//     if (!lastGroup || uriChanged || groupChanged || thereWasALongPause) {
//       const newGroup: EditorRangedTrack = {
//         id: uuid(),
//         type: 'editor',
//         groupType,
//         events: [e as any],
//         clockRange: { start: 0, end: 0 },
//         title: '',
//       };
//       groups.push(newGroup);
//     } else {
//       lastGroup.events.push(e as any);
//     }
//   }

//   const minDuration = (TRACK_HEIGHT_PX * timelineDuration) / timelineHeightPx;

//   for (const group of groups) {
//     group.clockRange.start = group.events[0].clock;
//     group.clockRange.end = Math.max(group.events[0].clock + minDuration, group.events.at(-1)!.clock);

//     let text = '';
//     if (group.groupType === 'textChange') {
//       text = group.events
//         .flatMap(e => e.contentChanges.map(cc => cc.text))
//         .join('')
//         .replace(/\n+/g, '\n')
//         .trim();
//     }

//     const uri = group.events.at(-1)?.uri;
//     let p: t.Path | undefined;
//     let basename: string | undefined;

//     if (uri) {
//       p = path.getUriPathOpt(uri);
//       basename = p && path.basename(p);
//       basename ??= path.getUntitledUriNameOpt(uri);
//     }

//     // const title = [p, text].filter(Boolean).join('\n');

//     if (group.groupType === 'documentChange') {
//       group.title = basename || 'document';
//       // icon = 'codicon-file';
//     } else {
//       group.title = text || 'text';
//     }
//   }

//   return groups;
// }
