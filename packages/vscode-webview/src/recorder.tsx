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
import postMessage, { mediaApi } from './api.js';
import { cn } from './misc.js';
import _ from 'lodash';

type Props = { recorder: t.RecorderState };
export default class Recorder extends Component<Props> {
  // panelsElem: Element | null = null;
  // media: FakeMedia = new FakeMedia(
  //   this.handleMediaProgress.bind(this),
  //   this.props.recorder.sessionSummary.duration * 1000,
  // );

  state = {
    // The only time when the recorder screen is opened with already loadned recorder,
    // is right after a vscode restart due to the change of workspace folders.
    tabId: this.props.recorder.isLoaded ? 'editor-view' : 'details-view',
  };

  tabs = [
    { id: 'details-view', label: 'DETAILS' },
    { id: 'editor-view', label: 'EDITOR' },
  ];

  tabChanged = async (tabId: string) => {
    if (tabId === 'editor-view' && !this.props.recorder.isLoaded) {
      await this.loadRecorder();
    } else {
      this.setState({ tabId });
    }
  };

  loadRecorder = async () => {
    const res = await postMessage({ type: 'recorder/load' });
    if (res.store.recorder?.isLoaded) {
      this.setState({ tabId: 'editor-view' });
    }
  };

  play = async (clock?: number) => {
    await mediaApi.prepareAll();
    if (clock) await postMessage({ type: 'recorder/seek', clock });
    await postMessage({ type: 'recorder/play' });
  };

  record = async (clock?: number) => {
    await mediaApi.prepareAll();
    if (clock) await postMessage({ type: 'recorder/seek', clock });
    await postMessage({ type: 'recorder/record' });
  };

  // setRef = (e: Element | null) => (this.panelsElem = e);

  // tabChanged = (e: any) => {
  //   const tab = e.detail as HTMLElement;
  //   // if (tab.id === 'editor-view')
  // };

  // state = {
  //   localClock: this.props.recorder.sessionSummary.duration,
  //   root:
  //     this.props.recorder.root ||
  //     this.props.recorder.history?.root ||
  //     this.props.recorder.defaultRoot,
  //   sessionSummary: this.props.recorder.sessionSummary,
  // };

  // record = async () => {
  //   await postMessage({ type: 'recorder/record' });
  // };

  // pause = async () => {
  //   await postMessage({ type: 'recorder/pause' });
  // };

  // save = async () => {
  //   await postMessage({ type: 'recorder/save' });
  // };

  // enableOrDisableMedia() {
  //   const isRecording = Boolean(this.props.recorder.status === t.TrackPlayerStatus.Running);
  //   if (isRecording !== this.media.isActive()) {
  //     this.media.timeMs = this.props.recorder.clock * 1000;
  //     if (isRecording) {
  //       this.media.start();
  //     } else {
  //       this.media.pause();
  //     }
  //   }
  // }

  // async handleMediaProgress(ms: number) {
  //   if (this.props.recorder.state.status === t.TrackPlayerStatus.Running) {
  //     console.log('handleMediaProgress: ', ms);
  //     await postMessage({ type: 'updateRecorder', changes: { clock: ms / 1000 } });
  //   }
  // }

  componentDidUpdate() {
    mediaApi.loadOrDisposeAudioTracks(this.props.recorder.audioTracks, this.props.recorder.webviewUris);
  }

  componentDidMount() {
    console.log('Recorder componentDidMount');
    mediaApi.loadOrDisposeAudioTracks(this.props.recorder.audioTracks, this.props.recorder.webviewUris);
  }

  componentWillUnmount() {
    mediaApi.disposeAll();
  }

  render() {
    // const canToggle = Boolean(this.props.recorder.root);

    // let toggleFn: () => void, toggleIcon: string, tooltip: string;
    // switch (status) {
    //   case t.TrackPlayerStatus.Uninitialized:
    //   case t.TrackPlayerStatus.Initialized:
    //   case t.TrackPlayerStatus.Paused: {
    //     toggleFn = this.startRecorder;
    //     toggleIcon = 'codicon-circle-large-filled';
    //     tooltip = !canToggle
    //       ? 'Pick a workspace first'
    //       : ss.duration
    //       ? `Continue recording at ${lib.formatTimeSeconds(ss.duration)}`
    //       : 'Start recording';
    //     break;
    //   }
    //   case t.TrackPlayerStatus.Running:
    //     toggleFn = this.pauseRecorder;
    //     toggleIcon = 'codicon-debug-pause';
    //     tooltip = 'Pause';
    //     break;
    //   default:
    //     throw new Error(`Cannot render recorder status: ${status}`);
    // }

    return (
      <Screen className="recorder">
        <Tabs tabs={this.tabs} activeTabId={this.state.tabId} onTabChange={this.tabChanged}>
          <DetailsView id="details-view" className="" {...this.props} onLoadRecorder={this.loadRecorder} />
          <EditorView id="editor-view" className="" {...this.props} onRecord={this.record} onPlay={this.play} />
        </Tabs>
        {/*
        <vscode-panels ref={this.setRef}>
          <vscode-panel-tab id="details-view">DETAILS</vscode-panel-tab>
          <vscode-panel-tab id="editor-view">EDITOR</vscode-panel-tab>
        </vscode-panels>
            <div className="subsection buttons">
              <vscode-button appearance="secondary" onClick={this.toggleStudio}>
                Open studio
              </vscode-button>
              <vscode-button appearance="secondary" onClick={this.save}>
                Save
              </vscode-button>
              <vscode-button className="bump-left" appearance="primary">
                Publish
              </vscode-button>
              </div>
                */}
        {/*
            <vscode-text-field
              className="subsection"
              value={ss.title}
              onInput={this.titleChanged}
              data-field="title"
            >
              Title
            </vscode-text-field>
              */}
      </Screen>
    );

    // if (!session) {
    //   throw new Error('Recorder:render(): no session');
    // }

    // const toggleButton = session.isRecording ? (
    //   <vscode-button onClick={this.pauseRecorder} appearance="secondary">
    //     <div className="codicon codicon-debug-pause" />
    //   </vscode-button>
    // ) : (
    //   <vscode-button onClick={this.startRecorder}>
    //     <div className="codicon codicon-device-camera-video" />
    //   </vscode-button>
    // );

    // const timeStr = lib.formatTimeSeconds(this.state.localClock);

    // return wrap(
    //   <>
    //     <vscode-text-field autofocus>Session Name</vscode-text-field>
    //     <div className="control-toolbar">
    //       {toggleButton}
    //       <div className="time">{timeStr}</div>
    //     </div>
    //   </>,
    // );
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

  rootChanged = async (root: string) => {
    await postMessage({ type: 'recorder/update', changes: { root } });
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
        <PathField
          className="subsection"
          onChange={this.rootChanged}
          value={this.props.recorder.root}
          label="Workspace"
          pickTitle="Select workspace folder"
          disabled={recorder.isLoaded}
          autoFocus
        />
        <p className="subsection help">
          Use <code>.gitignore</code> and <code>.codecastignore</code> to ignore paths.
        </p>
        {!recorder.isLoaded && (
          <vscode-button className="subsection" onClick={onLoadRecorder}>
            {recorder.isNew ? 'Scan workspace to start' : 'Load project into workspace'}
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
class EditorView extends Component<EditorViewProps> {
  state = {
    cursor: undefined as Marker | undefined,
    anchor: undefined as Marker | undefined,
    markers: [] as Marker[],
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
      // await lib.timeout(1000);
      // for (const m of Object.values(mediaApi.audioManagers)) {
      //   await m.play();
      //   await m.pause();
      // }
    }
  };

  render() {
    const { id, recorder, className, onRecord, onPlay } = this.props;
    const { sessionSummary: ss } = recorder;
    let primaryAction: MT.PrimaryAction;

    if (recorder.isRecording) {
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
        disabled: recorder.isPlaying,
        onClick: () => onRecord(this.state.anchor?.clock),
      };
    }

    const toolbarActions = [
      recorder.isPlaying
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
            disabled: recorder.isRecording,
            onClick: () => onPlay(this.state.anchor?.clock),
          },
      {
        title: 'Add audio',
        icon: 'codicon-mic',
        disabled: recorder.isPlaying || recorder.isRecording,
        onClick: this.insertAudio,
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
        <Timeline
          recorder={recorder}
          markers={this.state.markers}
          cursor={this.state.cursor}
          anchor={this.state.anchor}
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

  resized = () => {
    this.forceUpdate();
  };

  getClockUnderMouse(e: MouseEvent): number | undefined {
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

    const timeline = document.getElementById('timeline')!;
    timeline.addEventListener('mouseleave', this.mouseLeft);
    timeline.addEventListener('mouseout', this.mouseOut);
  }

  componentWillUnmount() {
    document.removeEventListener('resize', this.resized);
    document.removeEventListener('mousemove', this.mouseMoved);
    document.removeEventListener('mousedown', this.mouseDown);
    document.removeEventListener('mouseup', this.mouseUp);

    const timeline = document.getElementById('timeline')!;
    timeline.removeEventListener('mouseleave', this.mouseLeft);
    timeline.removeEventListener('mouseout', this.mouseOut);
  }

  render() {
    const { markers, cursor, anchor, clock } = this.props;
    const clockMarker: Marker | undefined = clock > 0 ? { clock, type: 'clock' } : undefined;

    const allMarkers = _.compact([...markers, cursor, anchor, clockMarker]);
    return (
      <div id="timeline" className="subsection">
        <div className="timeline-body">
          <div className="markers">
            {allMarkers.map(marker => (
              <MarkerUI marker={marker} timelineDuration={this.getTimelineDuration()} />
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

type MarkerProps = { id?: string; marker: Marker; timelineDuration: number };
class MarkerUI extends Component<MarkerProps> {
  render() {
    const { id, marker, timelineDuration } = this.props;
    const style = {
      top: `${(marker.clock / timelineDuration) * 100}%`,
    };
    return (
      <div id={id} className={cn('marker', `marker_${marker.type}`, marker.active && 'marker_active')} style={style}>
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
