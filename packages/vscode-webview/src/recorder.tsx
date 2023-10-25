import { produce, type Draft } from 'immer';
import MediaToolbar, * as MT from './media_toolbar.jsx';
import { h, Fragment, Component } from 'preact';
import { types as t, path, lib, assert } from '@codecast/lib';
// import FakeMedia from './fake_media.js';
import PathField from './path_field.jsx';
import { SessionSummary } from './session_summary.jsx';
import SessionDescription from './session_description.jsx';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage from './api.js';
import { cn } from './misc.js';
import _ from 'lodash';

type Props = { recorder: t.RecorderState };
export default class Recorder extends Component<Props> {
  panelsElem: Element | null = null;
  // media: FakeMedia = new FakeMedia(
  //   this.handleMediaProgress.bind(this),
  //   this.props.recorder.sessionSummary.duration * 1000,
  // );

  setRef = (e: Element | null) => (this.panelsElem = e);

  tabChanged = (e: any) => {
    const tab = e.detail as HTMLElement;
    console.log(tab);
  };

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
    // this.enableOrDisableMedia();
  }

  componentDidMount() {
    console.log('Recorder componentDidMount');
    // this.enableOrDisableMedia();

    this.panelsElem!.addEventListener('change', this.tabChanged);
  }

  componentWillUnmount() {
    // this.media.pause();
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
        <vscode-panels ref={this.setRef}>
          <vscode-panel-tab id="details-tab">DETAILS</vscode-panel-tab>
          <vscode-panel-tab id="editor-tab">EDITOR</vscode-panel-tab>
          <DetailsView {...this.props} />
          <EditorView {...this.props} />
        </vscode-panels>
        {/*
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

class DetailsView extends Component<Props> {
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
    const { recorder } = this.props;
    const { sessionSummary: ss } = recorder;

    return (
      <vscode-panel-view className="details-view">
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
      </vscode-panel-view>
    );
  }
}

type Marker = {
  clock: number;
  type: 'clock' | 'anchor' | 'cursor' | 'selection';
  active?: boolean;
};

type EditorViewStateRecipe = (draft: Draft<EditorView['state']>) => EditorView['state'] | void;

class EditorView extends Component<Props> {
  state = {
    cursor: undefined as Marker | undefined,
    anchor: undefined as Marker | undefined,
    markers: [] as Marker[],
    stepCount: 15,
  };

  getTimelineStepClock(): number {
    return calcTimelineStepClock(this.props.recorder.sessionSummary.duration, this.state.stepCount);
  }

  getTimelineDuration(): number {
    return this.getTimelineStepClock() * this.state.stepCount;
  }

  mouseMoved = (e: MouseEvent) => {
    const clock = this.getClockUnderMouse(e);
    if (clock !== undefined) {
      this.updateState(state => {
        state.cursor = { clock, type: 'cursor' };
      });
    }
  };

  mouseLeft = () => {
    this.updateState(state => {
      state.cursor = undefined;
    });
  };

  mouseDown = (e: MouseEvent) => {
    const clock = this.getClockUnderMouse(e);
    if (clock !== undefined) {
      this.updateState(state => {
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

  updateState = (recipe: EditorViewStateRecipe) => this.setState(state => produce(state, recipe));

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
  }

  componentWillUnmount() {
    document.removeEventListener('resize', this.resized);
    document.removeEventListener('mousemove', this.mouseMoved);
    document.removeEventListener('mousedown', this.mouseDown);
    document.removeEventListener('mouseup', this.mouseUp);

    const timeline = document.getElementById('timeline')!;
    timeline.removeEventListener('mouseleave', this.mouseLeft);
  }

  render() {
    const { recorder } = this.props;
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
        onClick: async () => {
          await postMessage({ type: 'recorder/record' });
        },
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
            onClick: async () => {
              await postMessage({ type: 'recorder/play' });
            },
          },
      {
        title: 'Add audio',
        icon: 'codicon-mic',
        onClick: () => {
          console.log('TODO');
        },
      },
    ];

    const clockMarker: Marker | undefined = recorder.clock > 0 ? { clock: recorder.clock, type: 'clock' } : undefined;
    const allMarkers = _.compact([...this.state.markers, this.state.cursor, this.state.anchor, clockMarker]);

    return (
      <vscode-panel-view className="editor-view">
        <MediaToolbar
          className="subsection subsection_spaced"
          primaryAction={primaryAction}
          actions={toolbarActions}
          clock={recorder.clock}
        />
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
      </vscode-panel-view>
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
  return Math.max(roundTo(dur / steps, 60), 60);
}
