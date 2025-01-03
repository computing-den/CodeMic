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
import Screen from './screen.jsx';
import postMessage, { setMediaManager } from './api.js';
import MediaManager from './media_manager.js';
import Toolbar from './toolbar.jsx';
import { cn, getCoverUri } from './misc.js';
import _ from 'lodash';
import { VSCodeButton, VSCodeTextArea, VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import Popover, { PopoverProps, usePopover } from './popover.jsx';
import { AppContext } from './app_context.jsx';
import { v4 as uuid } from 'uuid';

const TRACK_HEIGHT_PX = 15;
const TRACK_MIN_GAP_PX = 1;
const TRACK_INDENT_PX = 5;
// const TIMELINE_STEP_HEIGHT = 30;
// const TIMELINE_INITIAL_STEP_DURATION = 30;
const TIMELINE_MAX_PX_TO_TIME_RATIO = 60;
const TIMELINE_MIN_PX_TO_TIME_RATIO = 1 / 60;
const TIMELINE_DEFAULT_PX_TO_SEC_RATIO = 20;
// const TIMELINE_MIN_STEP_DURATION = 5;
const TIMELINE_WHEEL_ZOOM_SPEED = 0.001;

type Props = { user?: t.User; recorder: t.RecorderUIState; session: t.SessionUIState };
export default class Recorder extends React.Component<Props> {
  mediaManager = new MediaManager();

  tabs = [
    { id: 'details-view', label: 'DETAILS' },
    { id: 'editor-view', label: 'EDITOR' },
  ];

  tabChanged = async (tabId: string) => {
    await postMessage({ type: 'recorder/openTab', tabId: tabId as t.RecorderUITabId });
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
    this.mediaManager.updateResources(this.props.session);
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
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;

  state = {
    // coverKey: 0,
  };
  titleChanged = async (e: Event | React.FormEvent<HTMLElement>) => {
    const changes = { title: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'recorder/updateDetails', changes });
  };

  handleChanged = async (e: Event | React.FormEvent<HTMLElement>) => {
    const changes = { handle: (e.target as HTMLInputElement).value.replace(/[^A-Za-z0-9_]/g, '') };
    await postMessage({ type: 'recorder/updateDetails', changes });
  };

  workspaceChanged = async (workspace: string) => {
    const changes = { workspace };
    await postMessage({ type: 'recorder/updateDetails', changes });
  };

  descriptionChanged = async (e: Event | React.FormEvent<HTMLElement>) => {
    const changes = { description: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'recorder/updateDetails', changes });
  };

  save = async () => {
    await postMessage({ type: 'recorder/save' });
  };

  publish = async () => {
    await postMessage({ type: 'recorder/publish' });
  };

  pickCover = async (e: React.MouseEvent) => {
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
      await postMessage({ type: 'recorder/setCover', uri: uris[0] });
      // this.setState({ coverKey: this.state.coverKey + 1 });
    }
  };

  deleteCover = async () => {
    await postMessage({ type: 'recorder/deleteCover' });
  };

  render() {
    const { cache } = this.context;
    const { session, id, className, onLoadRecorder } = this.props;
    // const { coverKey } = this.state;
    const { head, workspace, temp } = session;

    return (
      <div id={id} className={className}>
        <div className={cn('cover-container', head.hasCover && 'has-cover')}>
          {head.hasCover ? (
            <img src={getCoverUri(head.id, cache).toString()} />
          ) : (
            <p className="text-weak">NO COVER PHOTO</p>
          )}
          <div className="buttons">
            {head.hasCover && (
              <VSCodeButton
                className="delete"
                appearance="secondary"
                title="Delete cover photo"
                onClick={this.deleteCover}
              >
                Delete cover
              </VSCodeButton>
            )}
            <VSCodeButton className="pick" onClick={this.pickCover}>
              {head.hasCover ? 'Change cover' : 'Pick cover'}
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
          value={head.title}
          onInput={this.titleChanged}
          placeholder="The title of this project"
          autoFocus={!session.loaded}
        >
          Title
        </VSCodeTextArea>
        <PathField
          className="subsection"
          placeholder="Workspace directory"
          value={workspace}
          onChange={this.workspaceChanged}
          disabled={!temp}
          pickTitle="Pick workpace directory"
        >
          Workspace
        </PathField>
        <p className="subsection help">
          WARNING: workspace contents will be overwritten during recording and playback.
        </p>
        <VSCodeTextField
          className="subsection"
          placeholder="A-Z a-z 0-9 _ (e.g. my_project)"
          value={head.handle}
          onInput={this.handleChanged}
          disabled={!temp}
        >
          Handle
        </VSCodeTextField>
        <VSCodeTextArea
          className="description subsection"
          rows={10}
          resize="vertical"
          value={head.description}
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
          <VSCodeButton onClick={this.publish} disabled={!session.loaded}>
            Publish
          </VSCodeButton>
          <VSCodeButton appearance="secondary" onClick={this.save} disabled={session.mustScan}>
            Save
          </VSCodeButton>
        </div>
        {!session.loaded && (
          <VSCodeButton className="subsection" onClick={onLoadRecorder} autoFocus>
            {session.mustScan ? 'Scan workspace to start' : 'Load project into workspace'}
            <span className="codicon codicon-chevron-right va-top m-left_small" />
          </VSCodeButton>
        )}
      </div>
    );
  }
}

type Marker = {
  id: string;
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

function EditorView({ id, session, className, onRecord, onPlay }: EditorViewProps) {
  const { head } = session;

  const [state, setState] = useState<EditorViewState>({
    cursor: undefined,
    anchor: undefined,
    focus: undefined,
    markers: [],
    trackSelection: undefined,
  });

  const hasRangeSelection = state.anchor && state.focus && state.anchor.clock !== state.focus.clock;

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
  if (session.recording) {
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
      disabled: session.playing,
      onClick: () => onRecord(state.focus?.clock),
    };
  }

  const mediaToolbarActions = [
    session.playing
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
          disabled: session.recording,
          onClick: () => onPlay(state.focus?.clock),
        },
  ];

  const slowDownPopover = usePopover();
  const slowDownButtonRef = useRef(null);

  const speedUpPopover = usePopover();
  const speedUpButtonRef = useRef(null);

  async function changeSpeed(factor: number) {
    assert(state.anchor && state.focus);
    // TODO disable speed control popover buttons till done.
    const range = getClockRangeOfSelection(state.anchor, state.focus);
    await postMessage({ type: 'recorder/changeSpeed', range, factor });

    updateState(state => {
      if (state.anchor && state.focus) {
        // const dur = Math.abs(state.anchor.clock - state.focus.clock);
        state.focus.clock = lib.calcClockAfterRangeSpeedChange(state.focus.clock, range, factor);
        state.anchor.clock = lib.calcClockAfterRangeSpeedChange(state.anchor.clock, range, factor);
      }
    });

    slowDownPopover.close();
    speedUpPopover.close();
  }

  function slowDown(factor: number) {
    return changeSpeed(1 / factor);
  }
  function speedUp(factor: number) {
    return changeSpeed(factor);
  }

  async function merge() {
    assert(state.anchor && state.focus);
    await postMessage({ type: 'recorder/merge', range: getClockRangeOfSelection(state.anchor, state.focus) });
    const mergeClock = Math.min(state.anchor.clock, state.focus.clock);
    updateState(state => {
      if (state.anchor && state.focus) {
        state.focus.clock = mergeClock;
        state.anchor.clock = mergeClock;
      }
    });
  }

  async function crop() {
    assert(state.focus);
    await postMessage({ type: 'recorder/crop', clock: state.focus.clock });
  }

  const insertGapPopover = usePopover();
  const insertGapButtonRef = useRef(null);

  async function insertGap(dur: number) {
    assert(state.focus);
    await postMessage({ type: 'recorder/insertGap', clock: state.focus.clock, dur });
    insertGapPopover.close();
  }

  async function undo() {
    await postMessage({ type: 'recorder/undo' });
  }

  async function redo() {
    await postMessage({ type: 'recorder/redo' });
  }

  const toolbarActions = [
    <Toolbar.Button title="Undo" icon="fa-solid fa-rotate-left" disabled={!session.canUndo} onClick={undo} />,
    <Toolbar.Button title="Redo" icon="fa-solid fa-rotate-right" disabled={!session.canRedo} onClick={redo} />,
    <Toolbar.Separator />,
    <Toolbar.Button
      title="Insert audio"
      icon="codicon codicon-mic"
      disabled={session.playing || session.recording}
      onClick={insertAudio}
    />,
    <Toolbar.Button
      title="Insert video"
      icon="codicon codicon-device-camera-video"
      disabled={session.playing || session.recording}
      onClick={insertVideo}
    />,
    <Toolbar.Button
      title="Insert Image"
      icon="codicon codicon-device-camera"
      disabled={session.playing || session.recording}
      onClick={() => console.log('TODO')}
    />,
    <Toolbar.Separator />,
    <Toolbar.Button
      ref={slowDownButtonRef}
      title="Slow down"
      icon="fa-solid fa-backward"
      disabled={session.playing || session.recording || !hasRangeSelection}
      onClick={slowDownPopover.toggle}
    />,
    <Toolbar.Button
      ref={speedUpButtonRef}
      title="Speed up"
      icon="fa-solid fa-forward"
      disabled={session.playing || session.recording || !hasRangeSelection}
      onClick={speedUpPopover.toggle}
    />,
    <Toolbar.Button
      title="Merge"
      icon="fa-solid fa-arrows-up-to-line"
      disabled={session.playing || session.recording || !hasRangeSelection}
      onClick={merge}
    />,
    <Toolbar.Button
      ref={insertGapButtonRef}
      title="Insert gap"
      icon="fa-solid fa-arrows-left-right-to-line icon-rotate-cw-90"
      disabled={session.playing || session.recording || hasRangeSelection || !state.focus}
      onClick={insertGapPopover.toggle}
    />,
    <Toolbar.Button
      ref={insertGapButtonRef}
      title="Crop"
      icon="fa-solid fa-crop-simple"
      disabled={session.playing || session.recording || hasRangeSelection || !state.focus}
      onClick={crop}
    />,
  ];

  return (
    <div id={id} className={className}>
      <MediaToolbar
        className="subsection subsection_spaced"
        primaryAction={primaryAction}
        actions={mediaToolbarActions}
        clock={session.clock}
        duration={head.duration}
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
        session={session}
        markers={state.markers}
        cursor={state.cursor}
        anchor={state.anchor}
        focus={state.focus}
        trackSelection={state.trackSelection}
        onChange={updateState}
      />
      <SpeedControlPopover
        popover={slowDownPopover}
        onConfirm={slowDown}
        anchor={slowDownButtonRef}
        title="Slow down"
      />
      <SpeedControlPopover popover={speedUpPopover} onConfirm={speedUp} anchor={speedUpButtonRef} title="Speed up" />
      <InsertGapPopover popover={insertGapPopover} onConfirm={insertGap} anchor={insertGapButtonRef} />
    </div>
  );
}

type TimelineProps = {
  session: t.SessionUIState;
  markers: Marker[];
  cursor?: Marker;
  anchor?: Marker;
  focus?: Marker;
  trackSelection?: TrackSelection;
  onChange: (draft: EditorViewStateRecipe) => any;
};
type TimelineDrag<T> = { load: T; startClockUnderMouse: number; curClockUnderMouse: number };
type TimelineState = {
  pxToSecRatio: number;
  trackDrag?: TimelineDrag<t.RangedTrack>;
  markerDrag?: TimelineDrag<Marker>;
};
class Timeline extends React.Component<TimelineProps, TimelineState> {
  state = {
    pxToSecRatio: TIMELINE_DEFAULT_PX_TO_SEC_RATIO,
  } as TimelineState;

  rangeSelectionStart?: number;
  zoomState?: {
    timestampMs: number;
    clock: number;
    clientY: number;
  };

  // getTimelineStepClock(): number {
  //   return calcTimelineStepClock(this.props.recorder.head.duration, this.state.stepCount);
  // }

  getRulerStepDur(): number {
    const { pxToSecRatio } = this.state;
    if (pxToSecRatio >= 11) {
      return 1;
    } else if (pxToSecRatio >= 7 && pxToSecRatio < 11) {
      return 2;
    } else if (pxToSecRatio >= 3.4 && pxToSecRatio < 7) {
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
    return roundTo(this.props.session.head.duration + stepDur * 4, stepDur);
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
        state.focus = { id: 'focus', clock, type: 'focus', active: true };
      });
    } else {
      this.props.onChange(state => {
        if (clock === undefined) {
          state.cursor = undefined;
        } else {
          state.cursor = { id: 'focus', clock, type: 'cursor' };
        }
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
        state.focus = { id: 'focus', clock, type: 'focus', active: true };
        state.anchor = { id: 'anchor', clock, type: 'anchor' };
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

    const startClockUnderMouse = this.getClockUnderMouse(e.nativeEvent);
    if (startClockUnderMouse !== undefined) {
      console.log('trackDragStarted', track, startClockUnderMouse);
      this.setState({ trackDrag: { load: track, startClockUnderMouse, curClockUnderMouse: startClockUnderMouse } });
    }
  };

  trackDragEnded = async (e: React.DragEvent, _track: t.RangedTrack) => {
    const { trackDrag } = this.state;
    if (!trackDrag) return;

    const clockRange = getClockRangeOfTrackDrag(trackDrag);
    this.setState({ trackDrag: undefined });

    if (trackDrag.load.type === 'audio') {
      await postMessage({ type: 'recorder/updateAudio', update: { id: trackDrag.load.id, clockRange } });
    } else if (trackDrag.load.type === 'video') {
      await postMessage({ type: 'recorder/updateVideo', update: { id: trackDrag.load.id, clockRange } });
    }
  };

  trackDragged = (e: React.DragEvent, track: t.RangedTrack) => {
    const curClockUnderMouse = this.getClockUnderMouse(e.nativeEvent);
    if (curClockUnderMouse !== undefined && this.state.trackDrag) {
      this.setState({ trackDrag: { ...this.state.trackDrag, curClockUnderMouse } });
    }
  };

  markerClicked = (e: React.MouseEvent, marker: Marker) => {
    console.log('Marker clicked', marker);
    this.props.onChange(state => {
      state.anchor = { id: 'anchor', clock: marker.clock, type: 'anchor' };
      state.focus = { id: 'focus', clock: marker.clock, type: 'focus', active: true };
    });
  };

  markerDragStarted = (e: React.DragEvent, marker: Marker) => {
    e.dataTransfer?.setDragImage(new Image(), 0, 0);
    if (marker.draggable) {
      const startClockUnderMouse = this.getClockUnderMouse(e.nativeEvent);
      if (startClockUnderMouse !== undefined) {
        this.setState({ markerDrag: { load: marker, startClockUnderMouse, curClockUnderMouse: startClockUnderMouse } });
      }
    }
  };

  markerDragEnded = (e: React.DragEvent, marker: Marker) => {
    this.setState({ markerDrag: undefined });
    // TODO
    // const duration = Math.max(0, clock);
    // await postMessage({ type: 'recorder/updateDuration', duration });
  };

  markerDragged = async (e: React.DragEvent, marker: Marker) => {
    const curClockUnderMouse = this.getClockUnderMouse(e.nativeEvent);
    if (curClockUnderMouse !== undefined && this.state.markerDrag) {
      this.setState({ markerDrag: { ...this.state.markerDrag, curClockUnderMouse } });
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
    if (this.props.session.recording) {
      this.autoScroll();
    }

    if (prevState.pxToSecRatio !== this.state.pxToSecRatio) {
      this.scrollAfterZoom();
    }
  }

  render() {
    const { markers, cursor, anchor, focus, trackSelection, session } = this.props;
    const { pxToSecRatio, trackDrag, markerDrag } = this.state;
    const clockMarker: Marker | undefined =
      session.clock > 0 && session.clock !== session.head.duration && !session.recording
        ? { id: 'clock', clock: session.clock, type: 'clock' }
        : undefined;
    const endOrRecordingMarker: Marker = session.recording
      ? { id: 'recording', clock: session.head.duration, type: 'recording' }
      : { id: 'end', clock: session.head.duration, type: 'end' };

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
      _.concat<t.RangedTrack>(session.audioTracks ?? [], session.videoTracks ?? []),
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
              workspaceFocusTimeline={session.workspaceFocusTimeline}
              timelineDuration={timelineDuration}
              // timelineHeightPx={timelineHeightPx}
              pxToSecRatio={pxToSecRatio}
            />
            <RangedTracksUI
              timelineDuration={timelineDuration}
              tracks={tracks}
              trackSelection={trackSelection}
              trackDrag={trackDrag}
              onClick={this.trackClicked}
              onDrag={this.trackDragged}
              onDragStart={this.trackDragStarted}
              onDragEnd={this.trackDragEnded}
            />
            <div className="markers">
              {allMarkers.map(marker => (
                <MarkerUI
                  marker={marker}
                  markerDrag={markerDrag}
                  timelineDuration={timelineDuration}
                  onClick={this.markerClicked}
                  onDragStart={this.markerDragStarted}
                  onDragEnd={this.markerDragEnded}
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
  onDragEnd: (e: React.DragEvent, track: t.RangedTrack) => any;
  onDrag: (e: React.DragEvent, track: t.RangedTrack) => any;
  trackDrag?: TimelineDrag<t.RangedTrack>;
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
    const { tracks, timelineDuration, trackSelection, onClick, onDrag, onDragStart, onDragEnd, trackDrag } = this.props;

    // let layouts: RangedTrackLayout[] = [];

    // Two columns
    // for (let i = 0; i < tracks.length; ) {
    //   if (i === tracks.length - 1 || !doClockRangesOverlap(tracks[i], tracks[i + 1])) {
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
    //     if (lib.doClockRangesOverlap(track.clockRange, track2.clockRange)) indent++;
    //   }
    //   layouts.push({ start: 0, end: 2, track, indent });
    // }

    // const columnHalfGap = 0.25;

    const layouts: { track: t.RangedTrack; indent: number }[] = tracks.map(track => ({ track, indent: 0 }));
    for (const [i, layout] of layouts.entries()) {
      for (const layout2 of layouts.slice(0, i)) {
        if (lib.doClockRangesOverlap(layout.track.clockRange, layout2.track.clockRange)) {
          layout.indent = Math.max(layout.indent, layout2.indent) + 1;
        }
      }
    }

    return (
      <div className="ranged-tracks">
        {layouts.map(({ indent, track }, i) => {
          const indentPx = indent * TRACK_INDENT_PX;

          const clockRange = track.id === trackDrag?.load.id ? getClockRangeOfTrackDrag(trackDrag) : track.clockRange;

          const style = {
            // left: `calc(${start * 50}% + ${columnHalfGap}rem + ${indent * TRACK_INDENT_PX}px)`,
            // width: `calc(${(end - start) * 50}% - ${columnHalfGap * 2}rem - ${indent * TRACK_INDENT_PX}px)`,
            right: `${indentPx}px`,
            maxWidth: `calc(50% - ${indentPx})`,
            top: `${(clockRange.start / timelineDuration) * 100}%`,
            bottom: `calc(100% - ${(clockRange.end / timelineDuration) * 100}%)`,
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
              onDragEnd={e => onDragEnd(e, track)}
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
  //   return column.every(track2 => !this.doClockRangesOverlap(track, track2));
  // }

  // private orderedColumn(columns: RangedTrackLayoutColumn): RangedTrackLayoutColumn {
  //   return _.orderBy(columns, track => track.clockRange.start);
  // }
}

type EditorTrackUIProps = {
  timelineDuration: number;
  pxToSecRatio: number;
  workspaceFocusTimeline?: t.Focus[];
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
    //     if (!clockRangesOfOccupiedLines.some(x => lib.doClockRangesOverlap(x, lineClockRange))) {
    //       lineFocusItems.push(line);
    //     }
    //   }
    // }

    // Skip lines that may cut into the previous line.
    const lineFocusTimeline: { text: string; clockRange: t.ClockRange; offsetPx: number }[] = [];
    // const heightOf1Sec = timelineHeightPx / timelineDuration;
    // const heightOf1Sec = TIMELINE_STEP_HEIGHT / stepDuration;
    for (const [i, focus] of (workspaceFocusTimeline ?? []).entries()) {
      let offsetPx = 0;
      const lastLineFocus = lineFocusTimeline.at(-1);
      const nextFocusClock = workspaceFocusTimeline?.[i + 1]?.clock ?? timelineDuration;
      if (lastLineFocus) {
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
        const lineOriginalTopPx = focus.clock * pxToSecRatio;
        const lineOriginalBottomPx = nextFocusClock * pxToSecRatio;

        const availableSpace = lineOriginalBottomPx - lastLineBottomPx;
        const requiredSpace = TRACK_HEIGHT_PX + TRACK_MIN_GAP_PX;

        if (availableSpace < requiredSpace) continue;

        const lineTopPx = Math.max(lastLineBottomPx + TRACK_MIN_GAP_PX, lineOriginalTopPx);
        offsetPx = lineTopPx - lineOriginalTopPx;
      }

      lineFocusTimeline.push({ text: focus.text, offsetPx, clockRange: { start: focus.clock, end: nextFocusClock } });
    }

    const documentFocusTimeline: { uri: string; clockRange: t.ClockRange }[] = [];
    for (const [i, focus] of (workspaceFocusTimeline ?? []).entries()) {
      const lastDocumentFocus = documentFocusTimeline.at(-1);
      const nextFocusClock = workspaceFocusTimeline?.[i + 1]?.clock ?? timelineDuration;

      if (lastDocumentFocus && lastDocumentFocus.uri === focus.uri) {
        lastDocumentFocus.clockRange.end = nextFocusClock;
      } else {
        documentFocusTimeline.push({ uri: focus.uri, clockRange: { start: focus.clock, end: nextFocusClock } });
      }
    }

    return (
      <div className="editor-track">
        {documentFocusTimeline.map(documentFocus => {
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
            top: `calc(${(lineFocus.clockRange.start / timelineDuration) * 100}% + ${lineFocus.offsetPx}px)`,
            // paddingTop: `${lineFocus.offsetPx }px`,
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
  onDragEnd?: (e: React.DragEvent, m: Marker) => any;
  onDrag?: (e: React.DragEvent, m: Marker) => any;
  markerDrag?: TimelineDrag<Marker>;
};
class MarkerUI extends React.Component<MarkerProps> {
  clicked = (e: React.MouseEvent) => this.props.onClick?.(e, this.props.marker);
  dragStarted = (e: React.DragEvent) => this.props.onDragStart?.(e, this.props.marker);
  dragEnded = (e: React.DragEvent) => this.props.onDragEnd?.(e, this.props.marker);
  dragged = (e: React.DragEvent) => this.props.onDrag?.(e, this.props.marker);

  render() {
    const { marker, timelineDuration, markerDrag } = this.props;
    const clock = marker.id === markerDrag?.load.id ? getClockOfMarkerDrag(markerDrag) : marker.clock;
    const style = {
      top: `${(clock / timelineDuration) * 100}%`,
    };
    return (
      <div
        className={cn('marker', `marker_${marker.type}`, marker.active && 'marker_active', marker.draggable)}
        style={style}
        onClick={this.clicked}
        onDragStart={this.dragStarted}
        onDragEnd={this.dragEnded}
        onDrag={this.dragged}
        draggable={marker.draggable}
      >
        <div className="time">
          {lib.formatTimeSeconds(clock)}
          {marker.label ? ' ' + marker.label : ''}
        </div>
      </div>
    );
  }
}

function RangeSelection(props: { timelineDuration: number; anchor: Marker; focus: Marker }) {
  const { start, end } = getClockRangeOfSelection(props.anchor, props.focus);

  const style = {
    top: `${(start / props.timelineDuration) * 100}%`,
    height: `${((end - start) / props.timelineDuration) * 100}%`,
  };
  return <div className="range-selection" style={style} />;
}

function SpeedControlPopover(props: PopoverProps & { title: string; onConfirm: (factor: number) => any }) {
  const [factor, setFactor] = useState(2);
  return (
    <Popover {...props}>
      <form className="recorder-speed-popover-form">
        <label className="label" htmlFor="speed-control-slider">
          {props.title} by {factor}x
        </label>
        <input
          type="range"
          id="speed-control-slider"
          min={1}
          max={10}
          step={0.1}
          value={factor}
          onChange={e => setFactor(Number(e.currentTarget!.value))}
          autoFocus
        />
        <VSCodeButton appearance="secondary" onClick={e => props.onConfirm(factor)}>
          OK
        </VSCodeButton>
      </form>
    </Popover>
  );
}

function InsertGapPopover(props: PopoverProps & { onConfirm: (dur: number) => any }) {
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  return (
    <Popover {...props}>
      <form className="insert-gap-popover-form">
        <label className="label" htmlFor="gap-time-minute">
          Insert gap
        </label>
        <div className="inputs">
          <input
            type="number"
            id="gap-time-minute"
            min={0}
            max={60}
            step={1}
            value={minutes}
            placeholder="minutes"
            onChange={e => setMinutes(e.currentTarget.value)}
          />
          <input
            type="number"
            id="gap-time-seconds"
            min={0}
            max={59}
            step={1}
            value={seconds}
            placeholder="seconds"
            onChange={e => setSeconds(e.currentTarget.value)}
          />
        </div>
        <VSCodeButton
          appearance="secondary"
          onClick={e => {
            if (/[^0-9]/.test(minutes) || /[^0-9]/.test(seconds)) return;
            props.onConfirm(Number(minutes || '0') * 60 + Number(seconds || '0'));
          }}
        >
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

function getClockRangeOfSelection(anchor: Marker, focus: Marker): t.ClockRange {
  return { start: Math.min(anchor.clock, focus.clock), end: Math.max(anchor.clock, focus.clock) };
}

function getClockRangeOfTrackDrag(trackDrag: TimelineDrag<t.RangedTrack>): t.ClockRange {
  const { curClockUnderMouse, startClockUnderMouse, load: track } = trackDrag;
  const clockDiff = curClockUnderMouse - startClockUnderMouse;
  const start = Math.max(0, track.clockRange.start + clockDiff);
  const end = start + track.clockRange.end - track.clockRange.start;
  return { start, end };
}

function getClockOfMarkerDrag(markerDrag: TimelineDrag<Marker>): number {
  const { curClockUnderMouse, startClockUnderMouse, load: marker } = markerDrag;
  const clockDiff = curClockUnderMouse - startClockUnderMouse;
  return Math.max(0, marker.clock + clockDiff);
}
