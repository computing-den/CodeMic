import { produce, type Draft } from 'immer';
import MediaToolbar, * as MT from './media_toolbar.jsx';
import React, { useEffect, useRef, useState } from 'react';
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
import Toolbar from './toolbar.jsx';
import { cn } from './misc.js';
import _ from 'lodash';
import { VSCodeButton, VSCodeTextArea, VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import Popover, { PointName, pointNames, pointNameToXY, PopoverProps, usePopover } from './popover.jsx';

const TRACK_HEIGHT_PX = 15;
const TRACK_MIN_GAP_PX = 1;
const TRACK_INDENT_PX = 5;
// const TIMELINE_STEP_HEIGHT = 30;
// const TIMELINE_INITIAL_STEP_DURATION = 30;
const TIMELINE_DEFAULT_PX_TO_SEC_RATIO = 1;
const TIMELINE_MAX_PX_TO_TIME_RATIO = 5;
const TIMELINE_MIN_PX_TO_TIME_RATIO = 1 / 60;
// const TIMELINE_MIN_STEP_DURATION = 5;
const TIMELINE_WHEEL_ZOOM_SPEED = 0.001;

type Props = { user?: t.User; recorder: t.RecorderState };
export default class Recorder extends React.Component<Props> {
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

class DetailsView extends React.Component<DetailsViewProps> {
  state = {
    // coverPhotoKey: 0,
  };
  titleChanged = async (e: Event | React.FormEvent<HTMLElement>) => {
    const changes = { title: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'recorder/update', changes });
  };

  handleChanged = async (e: Event | React.FormEvent<HTMLElement>) => {
    const changes = { handle: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'recorder/update', changes });
  };

  descriptionChanged = async (e: Event | React.FormEvent<HTMLElement>) => {
    const changes = { description: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'recorder/update', changes });
  };

  save = async () => {
    await postMessage({ type: 'recorder/save' });
  };

  publish = async () => {
    await postMessage({ type: 'recorder/publish' });
  };

  pickCoverPhoto = async (e: React.MouseEvent) => {
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

  deleteCoverPhoto = async () => {
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
              <VSCodeButton
                className="delete"
                appearance="secondary"
                title="Delete cover photo"
                onClick={this.deleteCoverPhoto}
              >
                Delete cover
              </VSCodeButton>
            )}
            <VSCodeButton className="pick" onClick={this.pickCoverPhoto}>
              {s.hasCoverPhoto ? 'Change cover' : 'Pick cover'}
            </VSCodeButton>
          </div>
        </div>
        <div className="subsection">
          <label className="label"></label>
        </div>
        <VSCodeTextArea
          className="title subsection"
          rows={2}
          resize="vertical"
          value={s.title}
          onInput={this.titleChanged}
          placeholder="The title of this project"
          autoFocus={!recorder.loaded}
        >
          Title
        </VSCodeTextArea>
        <VSCodeTextField
          className="subsection"
          placeholder="A-Z a-z 0-9 _ (e.g. my_project)"
          value={s.handle}
          onInput={this.handleChanged}
          disabled={Boolean(s.publishTimestamp)}
        >
          Handle
        </VSCodeTextField>
        <VSCodeTextArea
          className="description subsection"
          rows={10}
          resize="vertical"
          value={s.description}
          onInput={this.descriptionChanged}
          placeholder="What is this project about?"
        >
          Description
        </VSCodeTextArea>
        <VSCodeTextField
          className="subsection"
          // value={''}
          // onInput={this.descriptionChanged}
          placeholder="e.g. https://github.com/computing-den/codemic.git"
        >
          Git repository
        </VSCodeTextField>
        <VSCodeTextField
          className="subsection"
          // value={''}
          // onInput={this.descriptionChanged}
          placeholder="e.g. 86056b1"
        >
          Git commit
        </VSCodeTextField>
        <p className="subsection help">
          Use <code>.codemicignore</code> to ignore paths.
        </p>
        <div className="subsection buttons">
          <VSCodeButton onClick={this.publish} disabled={!recorder.loaded}>
            Publish
          </VSCodeButton>
          <VSCodeButton appearance="secondary" onClick={this.save} disabled={recorder.mustScan}>
            Save
          </VSCodeButton>
        </div>
        {!recorder.loaded && (
          <VSCodeButton className="subsection" onClick={onLoadRecorder} autoFocus>
            {recorder.mustScan ? 'Scan workspace to start' : 'Load project into workspace'}
            <span className="codicon codicon-chevron-right va-top m-left_small" />
          </VSCodeButton>
        )}
      </div>
    );
  }
}

type Marker = {
  clock: number;
  type: 'clock' | 'anchor' | 'focus' | 'cursor' | 'end' | 'recording';
  active?: boolean;
  label?: string;
  draggable?: boolean;
};

type EditorViewProps = Props &
  TabViewProps & {
    onRecord: (clock?: number) => Promise<void>;
    onPlay: (clock?: number) => Promise<void>;
  };
type EditorViewStateRecipe = (draft: Draft<EditorViewState>) => EditorViewState | void;
type EditorViewState = {
  cursor: Marker | undefined;
  anchor: Marker | undefined;
  focus: Marker | undefined;
  markers: Marker[];
  trackSelection: TrackSelection | undefined;
};
type TrackSelection = { id: string; type: 'audio' | 'video' | 'editor' };

function EditorView({ id, recorder, className, onRecord, onPlay }: EditorViewProps) {
  const { sessionHead: s } = recorder;

  const [state, setState] = useState<EditorViewState>({
    cursor: undefined,
    anchor: undefined,
    focus: undefined,
    markers: [],
    trackSelection: undefined,
  });

  function updateState(recipe: EditorViewStateRecipe) {
    setState(state => produce(state, recipe));
  }

  async function insertAudio() {
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        title: 'Select audio file',
        filters: { 'MP3 Audio': ['mp3'] },
      },
    });
    if (uris?.length === 1) {
      const clock = state.focus?.clock ?? 0;
      await postMessage({ type: 'recorder/insertAudio', uri: uris[0], clock });
    }
  }

  async function insertVideo() {
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        title: 'Select video file',
        filters: { 'MP4 Video': ['mp4'], 'WebM Video': ['webm'] },
      },
    });
    if (uris?.length === 1) {
      const clock = state.focus?.clock ?? 0;
      await postMessage({ type: 'recorder/insertVideo', uri: uris[0], clock });
    }
  }

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
      onClick: () => onRecord(state.focus?.clock),
    };
  }

  const mediaToolbarActions = [
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
          onClick: () => onPlay(state.focus?.clock),
        },
  ];

  const slowDownPopover = usePopover();
  const slowDownButtonRef = useRef(null);

  const speedUpPopover = usePopover();
  const speedUpButtonRef = useRef(null);

  function slowDown(factor: number) {
    // TODO
    console.log(`Slow down by ${factor}x`);
  }
  function speedUp(factor: number) {
    // TODO
    console.log(`Speed up by ${factor}x`);
  }

  // function openSlowDownPopover() {
  //   slowDownPopover.open()
  // }

  // function speedUp(factor: number) {
  //   // TODO
  //   console.log(`Speed up by ${factor}x`);
  // }

  // const speedUpPopover = usePopover({
  //   render: props => <SpeedControlPopover {...props} onConfirm={speedUp} title="Speed up" />,
  // });

  const toolbarActions = [
    <Toolbar.Button
      title="Insert audio"
      icon="codicon codicon-mic"
      disabled={recorder.playing || recorder.recording}
      onClick={insertAudio}
    />,
    <Toolbar.Button
      title="Insert video"
      icon="codicon codicon-device-camera-video"
      disabled={recorder.playing || recorder.recording}
      onClick={insertVideo}
    />,
    <Toolbar.Button
      title="Insert Image"
      icon="codicon codicon-device-camera"
      disabled={recorder.playing || recorder.recording}
      onClick={() => console.log('TODO')}
    />,
    <Toolbar.Separator />,
    <Toolbar.Button
      ref={slowDownButtonRef}
      title="Slow down"
      icon="fa-solid fa-backward"
      disabled={recorder.playing || recorder.recording}
      onClick={slowDownPopover.toggle}
    />,
    <Toolbar.Button
      ref={speedUpButtonRef}
      title="Speed up"
      icon="fa-solid fa-forward"
      disabled={recorder.playing || recorder.recording}
      onClick={speedUpPopover.toggle}
    />,
  ];

  return (
    <div id={id} className={className}>
      <MediaToolbar
        className="subsection subsection_spaced"
        primaryAction={primaryAction}
        actions={mediaToolbarActions}
        clock={recorder.clock}
        duration={s.duration}
      />
      <div className="subsection subsection_spaced guide-video-container">
        <video id="guide-video" />
        <div className="empty-content">
          <span className="codicon codicon-device-camera-video" />
        </div>
      </div>
      <div className="subsection">
        <Toolbar actions={toolbarActions} />
      </div>
      <Timeline
        recorder={recorder}
        markers={state.markers}
        cursor={state.cursor}
        anchor={state.anchor}
        focus={state.focus}
        trackSelection={state.trackSelection}
        clock={recorder.clock}
        duration={recorder.sessionHead.duration}
        onChange={updateState}
      />
      <SpeedControlPopover
        popover={slowDownPopover}
        onConfirm={slowDown}
        anchor={slowDownButtonRef}
        title="Slow down"
      />
      <SpeedControlPopover popover={speedUpPopover} onConfirm={speedUp} anchor={speedUpButtonRef} title="Speed up" />
    </div>
  );
}

type TimelineProps = {
  recorder: t.RecorderState;
  markers: Marker[];
  cursor?: Marker;
  anchor?: Marker;
  focus?: Marker;
  trackSelection?: TrackSelection;
  clock: number;
  duration: number;
  onChange: (draft: EditorViewStateRecipe) => any;
};
type TimelineState = {
  pxToSecRatio: number;
};
class Timeline extends React.Component<TimelineProps, TimelineState> {
  state = {
    pxToSecRatio: TIMELINE_DEFAULT_PX_TO_SEC_RATIO,
  } as TimelineState;

  trackDragStart?: TrackSelection & t.RangedTrack & { clock: number };
  markerDragStart?: Marker;
  rangeSelectionStart?: number;
  zoomState?: {
    timestampMs: number;
    clock: number;
    clientY: number;
  };

  // getTimelineStepClock(): number {
  //   return calcTimelineStepClock(this.props.recorder.sessionHead.duration, this.state.stepCount);
  // }

  getRulerStepDur(): number {
    const { pxToSecRatio } = this.state;
    if (pxToSecRatio >= 3.4 && pxToSecRatio <= 5) {
      return 5;
    } else if (pxToSecRatio >= 1.6 && pxToSecRatio < 3.4) {
      return 10;
    } else if (pxToSecRatio >= 0.64 && pxToSecRatio < 1.6) {
      return 30;
    } else if (pxToSecRatio >= 0.3 && pxToSecRatio < 0.64) {
      return 60;
    } else if (pxToSecRatio >= 0.11 && pxToSecRatio < 0.3) {
      return 60 * 5;
    } else if (pxToSecRatio >= 0.06 && pxToSecRatio < 0.11) {
      return 60 * 10;
    } else if (pxToSecRatio >= 0.03 && pxToSecRatio < 0.06) {
      return 60 * 15;
    } else {
      return 60 * 30;
    }
  }

  getTimelineDuration(): number {
    const stepDur = this.getRulerStepDur();
    return roundTo(this.props.recorder.sessionHead.duration + stepDur * 4, stepDur);
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

      // 120  => px2sec = px2sec * 1.1
      // -120 => px2sec = px2sec * 0.9

      // 120 / 1000 = 0.12
      // 0.12 + 1 = 1.12

      // -120 /1000 = -0.12
      // -0.12 + 1 = 0.88

      let pxToSecRatio = this.state.pxToSecRatio * (1 - e.deltaY * TIMELINE_WHEEL_ZOOM_SPEED);
      pxToSecRatio = Math.min(TIMELINE_MAX_PX_TO_TIME_RATIO, Math.max(TIMELINE_MIN_PX_TO_TIME_RATIO, pxToSecRatio));
      this.setState({ pxToSecRatio });

      // // const newStepDuration = this.state.stepDuration + (e.deltaY / 100) * TIMELINE_ZOOM_MULTIPLIER;
      // const clippedStepDuration = Math.min(
      //   this.getTimelineDuration() / 2,
      //   Math.max(TIMELINE_MIN_STEP_DURATION, newStepDuration),
      // );
      // this.setState({ stepDuration: clippedStepDuration });

      // const deltaModes = { 0: 'pixel', 1: 'line', 2: 'page' } as Record<number, string>;
      // console.log(
      //   `wheel delta: ${e.deltaY}, wheel deltaMode: ${
      //     deltaModes[e.deltaMode]
      //   }, new step dur: ${newStepDuration}, clipped: ${clippedStepDuration}`,
      // );
    }
  };

  mouseMoved = (e: MouseEvent) => {
    const clock = this.getClockUnderMouse(e);

    if (this.rangeSelectionStart !== undefined && clock !== undefined) {
      this.props.onChange(state => {
        state.cursor = undefined;
        state.focus = { clock, type: 'focus', active: true };
      });
    } else {
      this.props.onChange(state => {
        state.cursor = clock === undefined ? undefined : { clock, type: 'cursor' };
      });
    }
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
      this.rangeSelectionStart = clock;
      this.props.onChange(state => {
        for (const marker of state.markers) marker.active = false;
        state.focus = { clock, type: 'focus', active: true };
        state.anchor = { clock, type: 'anchor' };
      });
    }
  };

  mouseUp = (e: MouseEvent) => {
    this.rangeSelectionStart = undefined;
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

  trackClicked = (e: React.MouseEvent, track: t.RangedTrack) => {
    this.props.onChange(state => {
      state.trackSelection = track;
    });
  };

  trackDragStarted = (e: React.DragEvent, track: t.RangedTrack) => {
    e.dataTransfer?.setDragImage(new Image(), 0, 0);

    if (track.type === 'editor') return;

    const clock = this.getClockUnderMouse(e.nativeEvent);
    if (!clock) return;

    console.log('trackDragStarted', track, clock);

    this.trackDragStart = { ...this.getSelectionFromTrack(track), ...track, clock };
  };

  trackDragged = async (e: React.DragEvent, track: t.RangedTrack) => {
    const clock = this.getClockUnderMouse(e.nativeEvent);
    if (!clock || !this.trackDragStart) return;

    const clockDiff = clock - this.trackDragStart.clock;
    const start = Math.max(0, this.trackDragStart.clockRange.start + clockDiff);
    const end = start + this.trackDragStart.clockRange.end - this.trackDragStart.clockRange.start;

    const clockRange: t.ClockRange = { start, end };

    console.log('trackDragged', track, clock, clockDiff);

    if (this.trackDragStart.type === 'audio') {
      await postMessage({ type: 'recorder/updateAudio', audio: { id: track.id, clockRange } });
    } else if (this.trackDragStart.type === 'video') {
      await postMessage({ type: 'recorder/updateVideo', video: { id: track.id, clockRange } });
    }
  };

  markerClicked = (e: React.MouseEvent, marker: Marker) => {
    console.log('Marker clicked', marker);
    this.props.onChange(state => {
      state.anchor = { clock: marker.clock, type: 'anchor' };
      state.focus = { clock: marker.clock, type: 'focus', active: true };
    });
  };

  markerDragStarted = (e: React.DragEvent, marker: Marker) => {
    e.dataTransfer?.setDragImage(new Image(), 0, 0);
    //  if (!this.getClockUnderMouse(e)) return;

    this.markerDragStart = marker;
  };

  markerDragged = async (e: React.DragEvent, marker: Marker) => {
    const clock = this.getClockUnderMouse(e.nativeEvent);
    if (clock !== undefined && this.markerDragStart?.type === 'end') {
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
    if (opts?.emptySpace && !this.isMouseOverEmptySpaceInTimeline(e)) return;

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

  isMouseOverEmptySpaceInTimeline(e: MouseEvent): boolean {
    const target = e.target as HTMLElement;
    return Boolean(target.closest('#timeline') && !target.closest('.track') && !target.closest('.marker'));
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

    const timeline = document.getElementById('timeline')!;
    timeline.addEventListener('wheel', this.wheelMoved);

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

    const timeline = document.getElementById('timeline')!;
    timeline.removeEventListener('wheel', this.wheelMoved);
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

    if (prevState.pxToSecRatio !== this.state.pxToSecRatio) {
      this.scrollAfterZoom();
    }
  }

  render() {
    const { markers, cursor, anchor, focus, clock, trackSelection, duration, recorder } = this.props;
    const { pxToSecRatio /*timelineHeightPx*/ } = this.state;
    const clockMarker: Marker | undefined =
      clock > 0 && clock !== duration && !recorder.recording ? { clock, type: 'clock' } : undefined;
    const endOrRecordingMarker: Marker = recorder.recording
      ? { clock: duration, type: 'recording' }
      : { clock: duration, type: 'end', draggable: true };

    const hasRangeSelection = anchor && focus && anchor.clock !== focus.clock;

    const allMarkers = _.compact([
      ...markers,
      cursor,
      hasRangeSelection && anchor,
      focus,
      clockMarker,
      endOrRecordingMarker,
    ]);
    const timelineDuration = this.getTimelineDuration();

    // const groupedEditorTracks = groupEditorEvents(recorder.editorTrack!.events, timelineDuration, timelineHeightPx);
    const tracks = _.orderBy(
      _.concat<t.RangedTrack>(recorder.audioTracks ?? [], recorder.videoTracks ?? []),
      track => track.clockRange.start,
    );

    const rulerStepDur = this.getRulerStepDur();

    return (
      <div id="timeline" className="subsection">
        <div
          id="timeline-body"
          style={{
            height: `${this.getTimelineDuration() * pxToSecRatio + 1}px`,
          }}
        >
          <div className="timeline-grid">
            <EditorTrackUI
              workspaceFocusTimeline={recorder.workspaceFocusTimeline}
              timelineDuration={timelineDuration}
              // timelineHeightPx={timelineHeightPx}
              pxToSecRatio={pxToSecRatio}
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
            {hasRangeSelection && <RangeSelection timelineDuration={timelineDuration} anchor={anchor} focus={focus} />}
          </div>
          <div id="ruler">
            {_.times(this.getTimelineDuration() / rulerStepDur + 1, i => (
              <div className="step">
                <div className="indicator"></div>
                <div className="time">{lib.formatTimeSeconds(i * rulerStepDur)}</div>
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
  onClick: (e: React.MouseEvent, track: t.RangedTrack) => any;
  onDragStart: (e: React.DragEvent, track: t.RangedTrack) => any;
  onDrag: (e: React.DragEvent, track: t.RangedTrack) => any;
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
class RangedTracksUI extends React.Component<RangedTracksUIProps> {
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
  pxToSecRatio: number;
  workspaceFocusTimeline?: t.WorkspaceFocusTimeline;
};
class EditorTrackUI extends React.Component<EditorTrackUIProps> {
  render() {
    const { timelineDuration, pxToSecRatio, workspaceFocusTimeline } = this.props;

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
    // const heightOf1Sec = TIMELINE_STEP_HEIGHT / stepDuration;
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

      const lastLineBottomPx = lastLineFocus.clockRange.start * pxToSecRatio + TRACK_HEIGHT_PX;
      const lineOriginalTopPx = lineFocus.clockRange.start * pxToSecRatio;
      const lineOriginalBottomPx = lineFocus.clockRange.end * pxToSecRatio;

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
// class EditorTrackUI extends React.Component<EditorTrackUIProps> {
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
  onClick?: (e: React.MouseEvent, m: Marker) => any;
  onDragStart?: (e: React.DragEvent, m: Marker) => any;
  onDrag?: (e: React.DragEvent, m: Marker) => any;
};
class MarkerUI extends React.Component<MarkerProps> {
  clicked = (e: React.MouseEvent) => this.props.onClick?.(e, this.props.marker);
  dragStarted = (e: React.DragEvent) => this.props.onDragStart?.(e, this.props.marker);
  dragged = (e: React.DragEvent) => this.props.onDrag?.(e, this.props.marker);

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

function RangeSelection(props: { timelineDuration: number; anchor: Marker; focus: Marker }) {
  const min = Math.min(props.anchor.clock, props.focus.clock);
  const max = Math.max(props.anchor.clock, props.focus.clock);

  const style = {
    top: `${(min / props.timelineDuration) * 100}%`,
    height: `${((max - min) / props.timelineDuration) * 100}%`,
  };
  return <div className="range-selection" style={style} />;
}

function SpeedControlPopover(props: PopoverProps & { title: string; onConfirm: (factor: number) => any }) {
  const [factor, setFactor] = useState(2);
  return (
    <Popover {...props}>
      <form className="recorder-speed-popover-form">
        <label className="label" htmlFor="x-slider">
          {props.title} by {factor}x
        </label>
        <input
          type="range"
          id="x-slider"
          min={1}
          max={10}
          step={0.1}
          value={factor}
          onChange={e => setFactor(Number(e.currentTarget!.value))}
        />
        <VSCodeButton appearance="secondary" onClick={e => props.onConfirm(factor)} autoFocus>
          OK
        </VSCodeButton>
      </form>
    </Popover>
  );
}

function roundTo(value: number, to: number) {
  assert(to > 0);
  return Math.floor((value + to - 1) / to) * to;
}
