import { h, Fragment, Component } from 'preact';
import { types as t, path, lib } from '@codecast/lib';
import FakeMedia from './fake_media.js';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage from './api.js';
import _ from 'lodash';

type Props = { store: t.Store; onExit: () => void };
export default class Recorder extends Component<Props> {
  media: FakeMedia = new FakeMedia(this.handleMediaProgress.bind(this), this.recorder.sessionSummary.duration * 1000);

  get recorder(): t.RecorderState {
    return this.props.store.recorder!;
  }

  // state = {
  //   localClock: this.recorder.sessionSummary.duration,
  //   root:
  //     this.recorder.root ||
  //     this.recorder.history?.root ||
  //     this.recorder.defaultRoot,
  //   sessionSummary: this.recorder.sessionSummary,
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

  titleChanged = async (e: InputEvent) => {
    const changes = { title: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'updateRecorder', changes });
  };

  descriptionChanged = async (e: InputEvent) => {
    const changes = { description: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'updateRecorder', changes });
  };

  rootChanged = async (e: InputEvent) => {
    const changes = { root: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'updateRecorder', changes });
  };

  pickRoot = async () => {
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        defaultUri: this.recorder.root ? path.fileUriFromAbsPath(path.abs(this.recorder.root)) : undefined,
        canSelectFolders: true,
        canSelectFiles: false,
        title: 'Select workspace folder',
      },
    });
    if (uris?.length === 1) {
      if (!path.isFileUri(uris[0] as t.Uri)) {
        throw new Error(`pickRoot: only local paths are supported. Instead received ${uris[0]}`);
      }
      await postMessage({ type: 'updateRecorder', changes: { root: path.getFileUriPath(uris[0] as t.Uri) } });
    }
  };

  toggleStudio = async () => {
    // TODO
  };

  // saveRecording = async () => {
  //   await actions.saveRecording();
  // };

  // discardRecorder = async () => {
  //   await actions.discardRecorder();
  // };

  // onExit = async () => {
  //   const canExit = await actions.askToCloseRecorder();
  //   if (canExit) await actions.closeRecorder();
  //   return canExit;
  // };

  enableOrDisableMedia() {
    const isRecording = Boolean(this.recorder.status === t.RecorderStatus.Recording);
    if (isRecording !== this.media.isActive()) {
      this.media.timeMs = this.recorder.clock * 1000;
      if (isRecording) {
        this.media.start();
      } else {
        this.media.pause();
      }
    }
  }

  async handleMediaProgress(ms: number) {
    if (this.recorder.status === t.RecorderStatus.Recording) {
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
    // this.props.setOnExit(this.onExit);
  }

  componentWillUnmount() {
    this.media.pause();
  }

  render() {
    const { status, sessionSummary } = this.recorder;

    const canToggle = Boolean(this.recorder.root);

    let toggleFn: () => void, toggleIcon: string, tooltip: string;
    switch (status) {
      case t.RecorderStatus.Uninitialized:
      case t.RecorderStatus.Ready:
      case t.RecorderStatus.Paused: {
        toggleFn = this.startRecorder;
        toggleIcon = 'codicon-circle-large-filled';
        tooltip = !canToggle
          ? 'Pick a workspace first'
          : sessionSummary.duration
          ? `Continue recording at ${lib.formatTimeSeconds(sessionSummary.duration)}`
          : 'Start recording';
        break;
      }
      case t.RecorderStatus.Recording:
        toggleFn = this.pauseRecorder;
        toggleIcon = 'codicon-debug-pause';
        tooltip = 'Pause';
        break;
      default:
        throw new Error(`Cannot render recorder status: ${status}`);
    }

    return (
      <Screen className="recorder">
        <Section className="main-section">
          <Section.Header
            title="RECORDER"
            buttons={[<Section.Header.ExitButton onClick={this.props.onExit} />]}
            collapsible
          />
          <Section.Body>
            <div className="control-toolbar">
              <div className="toggle-button-container">
                <vscode-button
                  className="toggle-button for-recorder"
                  onClick={toggleFn}
                  appearance="icon"
                  disabled={!canToggle}
                  title={tooltip}
                >
                  <div className={`codicon ${toggleIcon}`} />
                </vscode-button>
              </div>
              <div className="actions">
                <vscode-button
                  appearance="icon"
                  title="Discard"
                  disabled={status === t.RecorderStatus.Ready || status === t.RecorderStatus.Uninitialized}
                >
                  <span className="codicon codicon-debug-restart" />
                </vscode-button>
              </div>
              <div className="time">
                <span
                  className={`recording-indicator codicon codicon-circle-filled m-right_small ${
                    status === t.RecorderStatus.Recording ? 'active' : ''
                  }`}
                />
                <span className="text large">{lib.formatTimeSeconds(this.recorder.clock, true)}</span>
              </div>
            </div>
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
            <p className="subsection help">Add audio and further adjustments in the studio.</p>
            <vscode-text-field
              className="subsection"
              value={this.recorder.root}
              onInput={this.rootChanged}
              data-field="root"
              disabled={status !== t.RecorderStatus.Uninitialized}
              autofocus
            >
              Workspace
              <vscode-button slot="end" appearance="icon" title="Pick" onClick={this.pickRoot}>
                <span className="codicon codicon-search" />
              </vscode-button>
            </vscode-text-field>
            <p className="subsection help">
              Use <code>.gitignore</code> and <code>.codecastignore</code> to ignore paths.
            </p>
            <vscode-text-field
              className="subsection"
              value={this.recorder.sessionSummary.title}
              onInput={this.titleChanged}
              data-field="title"
            >
              Title
            </vscode-text-field>
            <vscode-text-area
              className="subsection"
              rows={5}
              resize="vertical"
              value={this.recorder.sessionSummary.description}
              onInput={this.descriptionChanged}
              data-field="description"
            >
              Description
            </vscode-text-area>
          </Section.Body>
        </Section>
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
