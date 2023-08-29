import { h, Fragment, Component } from 'preact';
import { types as t, path, lib } from '@codecast/lib';
import FakeMedia from './fake-media.js';
import Screen from './screen.jsx';
import Section from './section.jsx';
import * as actions from './actions.js';
import _ from 'lodash';

type Props = { store: t.Store; onExit: () => void };
export default class Recorder extends Component<Props> {
  media: FakeMedia = new FakeMedia(this.handleMediaProgress.bind(this));

  state = {
    localClock: 0,
    root: this.props.store.recorder!.defaultRoot,
    title: '',
    description: '',
  };

  startRecorder = async () => {
    if (this.props.store.recorder!.status === t.RecorderStatus.Uninitialized) {
      await actions.startRecorder(this.state.root);
    } else {
      await actions.startRecorder();
    }
  };

  pauseRecorder = async () => {
    await actions.pauseRecorder();
  };

  updateField = (e: InputEvent) => {
    const target = e.target as HTMLInputElement;
    this.setState({ [target.dataset.field!]: target.value });
  };

  pickRoot = async () => {
    const p = await actions.showOpenDialog({
      defaultUri: this.state.root ? path.fileUriFromAbsPath(this.state.root) : undefined,
      canSelectFolders: true,
      canSelectFiles: false,
      title: 'Select workspace folder',
    });
    if (p?.length === 1) {
      const parsedUri = path.parseUri(p[0]);
      if (parsedUri.scheme !== 'file') {
        throw new Error(`pickRoot: only local paths are supported. Instead received ${parsedUri.scheme}`);
      }
      this.setState({ root: parsedUri.path });
    }
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
    const isRecording = Boolean(this.props.store.recorder!.status === t.RecorderStatus.Recording);
    if (isRecording !== this.media.isActive()) {
      if (isRecording) this.media.start();
      else this.media.pause();
    }
  }

  handleMediaProgress(ms: number) {
    if (this.props.store.recorder!.status === t.RecorderStatus.Recording) {
      this.setState({ localClock: ms / 1000 });
    }
  }

  componentDidUpdate() {
    this.enableOrDisableMedia();
  }

  componentDidMount() {
    this.enableOrDisableMedia();
    // this.props.setOnExit(this.onExit);
  }

  render() {
    const recorder = this.props.store.recorder!;
    const { status } = recorder;

    const timeStr = lib.formatTimeSeconds(this.state.localClock);
    let toggleFn: () => void, toggleIcon: string;
    if (status === t.RecorderStatus.Uninitialized) {
      [toggleFn, toggleIcon] = [this.startRecorder, 'codicon-circle-large-filled'];
    } else if (status === t.RecorderStatus.Ready) {
      [toggleFn, toggleIcon] = [this.startRecorder, 'codicon-circle-large-filled'];
    } else if (status === t.RecorderStatus.Paused) {
      [toggleFn, toggleIcon] = [this.startRecorder, 'codicon-circle-large-filled'];
    } else if (status === t.RecorderStatus.Recording) {
      [toggleFn, toggleIcon] = [this.pauseRecorder, 'codicon-debug-pause'];
    } else {
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
                  disabled={!this.state.root}
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
                <span className="text large">{lib.formatTimeSeconds(this.state.localClock, true)}</span>
              </div>
            </div>
            <vscode-text-field
              className="subsection"
              value={this.state.root}
              onChange={this.updateField}
              data-field="root"
              disabled={status !== t.RecorderStatus.Uninitialized}
              autofocus
            >
              Workspace
              <vscode-button slot="end" appearance="icon" title="Pick" onClick={this.pickRoot}>
                <span className="codicon codicon-search" />
              </vscode-button>
            </vscode-text-field>
            <vscode-text-field
              className="subsection"
              value={this.state.title}
              onChange={this.updateField}
              data-field="title"
            >
              Title
            </vscode-text-field>
            <vscode-text-area
              className="subsection"
              rows={5}
              resize="vertical"
              value={this.state.description}
              onChange={this.updateField}
              data-field="description"
            >
              Description
            </vscode-text-area>
            <p className="subsection help">
              Use <code>.gitignore</code> and <code>.codecastignore</code> to ignore paths.
            </p>
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
