import MediaToolbar, * as MT from './media_toolbar.jsx';
import { h, Fragment, Component } from 'preact';
import { types as t, path, lib, assert } from '@codecast/lib';
import FakeMedia from './fake_media.js';
import PathField from './path_field.jsx';
import { SessionSummary } from './session_summary.jsx';
import SessionDescription from './session_description.jsx';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage from './api.js';
import _ from 'lodash';

type Props = { recorder: t.RecorderState };
export default class Recorder extends Component<Props> {
  panelsElem: Element | null = null;
  media: FakeMedia = new FakeMedia(
    this.handleMediaProgress.bind(this),
    this.props.recorder.sessionSummary.duration * 1000,
  );

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

  startRecorder = async () => {
    await postMessage({ type: 'record' });
  };

  pauseRecorder = async () => {
    await postMessage({ type: 'pauseRecorder' });
  };

  save = async () => {
    await postMessage({ type: 'saveRecorder' });
  };

  enableOrDisableMedia() {
    const isRecording = Boolean(this.props.recorder.status === t.RecorderStatus.Recording);
    if (isRecording !== this.media.isActive()) {
      this.media.timeMs = this.props.recorder.clock * 1000;
      if (isRecording) {
        this.media.start();
      } else {
        this.media.pause();
      }
    }
  }

  async handleMediaProgress(ms: number) {
    if (this.props.recorder.status === t.RecorderStatus.Recording) {
      console.log('handleMediaProgress: ', ms);
      await postMessage({ type: 'updateRecorder', changes: { clock: ms / 1000 } });
    }
  }

  componentDidUpdate() {
    this.enableOrDisableMedia();
  }

  componentDidMount() {
    console.log('Recorder componentDidMount');
    this.enableOrDisableMedia();

    this.panelsElem!.addEventListener('change', this.tabChanged);
  }

  componentWillUnmount() {
    this.media.pause();
  }

  render() {
    // const canToggle = Boolean(this.props.recorder.root);

    // let toggleFn: () => void, toggleIcon: string, tooltip: string;
    // switch (status) {
    //   case t.RecorderStatus.Uninitialized:
    //   case t.RecorderStatus.Ready:
    //   case t.RecorderStatus.Paused: {
    //     toggleFn = this.startRecorder;
    //     toggleIcon = 'codicon-circle-large-filled';
    //     tooltip = !canToggle
    //       ? 'Pick a workspace first'
    //       : ss.duration
    //       ? `Continue recording at ${lib.formatTimeSeconds(ss.duration)}`
    //       : 'Start recording';
    //     break;
    //   }
    //   case t.RecorderStatus.Recording:
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
    await postMessage({ type: 'updateRecorder', changes });
  };

  descriptionChanged = async (e: InputEvent) => {
    const changes = { description: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'updateRecorder', changes });
  };

  rootChanged = async (root: string) => {
    await postMessage({ type: 'updateRecorder', changes: { root } });
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
          disabled={recorder.status !== t.RecorderStatus.Uninitialized}
          autoFocus
        />
        <p className="subsection help">
          Use <code>.gitignore</code> and <code>.codecastignore</code> to ignore paths.
        </p>
      </vscode-panel-view>
    );
  }
}

class EditorView extends Component<Props> {
  state = {
    indicatorClock: 0,
    stepCount: 15,
  };

  get timelineStepClock(): number {
    return calcTimelineStepClock(this.props.recorder.sessionSummary.duration, this.state.stepCount);
  }

  mouseMoved = (e: MouseEvent) => {
    const timeline = document.getElementById('timeline')!;
    const timelineRect = timeline.getBoundingClientRect();
    const indicatorElem = document.getElementById('indicator')!;
    const clientPos = [e.clientX, e.clientY] as t.Vec2;
    if (lib.vec2InRect(clientPos, timelineRect, { top: 5 })) {
      const steps: HTMLElement[] = Array.from(timeline.querySelectorAll('.ruler .step'));
      const firstStepMidY = lib.rectMid(steps[0].getBoundingClientRect())[1];
      const lastStepMidY = lib.rectMid(_.last(steps)!.getBoundingClientRect())[1];
      const firstStepMidYFromTimeline = firstStepMidY - timelineRect.top;
      const mouseYFromFirstStepMid = Math.max(0, clientPos[1] - firstStepMidY);
      const height = lastStepMidY - firstStepMidY;
      const ratio = mouseYFromFirstStepMid / height;
      const indicatorY = mouseYFromFirstStepMid + firstStepMidYFromTimeline;
      indicatorElem.style.display = 'block';
      indicatorElem.style.top = `${indicatorY}px`;
      this.setState({ indicatorClock: ratio * this.state.stepCount * this.timelineStepClock });
    } else {
      indicatorElem.style.display = 'none';
    }
  };

  componentDidMount() {
    document.addEventListener('mousemove', this.mouseMoved);
  }

  componentWillUnmount() {
    document.removeEventListener('mousemove', this.mouseMoved);
  }

  render() {
    const { recorder } = this.props;
    const { sessionSummary: ss } = recorder;
    let primaryAction: MT.PrimaryAction = { type: 'record', title: 'Play', onClick: () => {} };

    const toolbarActions = [
      {
        title: 'Play',
        icon: 'codicon-play',
        onClick: () => {
          console.log('TODO');
        },
      },
      {
        title: 'Add audio',
        icon: 'codicon-add',
        onClick: () => {
          console.log('TODO');
        },
      },
    ];

    return (
      <vscode-panel-view className="editor-view">
        <MediaToolbar
          className="subsection subsection_spaced"
          primaryAction={primaryAction}
          actions={toolbarActions}
          clock={recorder.clock}
          duration={ss.duration}
        />
        <div id="timeline" className="subsection">
          <div className="ruler">
            {_.times(this.state.stepCount + 1, i => (
              <div className="step">{lib.formatTimeSeconds(i * this.timelineStepClock)}</div>
            ))}
          </div>
          <div id="indicator">
            <div className="time">{lib.formatTimeSeconds(this.state.indicatorClock)}</div>
          </div>
        </div>
      </vscode-panel-view>
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
