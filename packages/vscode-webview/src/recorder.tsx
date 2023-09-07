import { h, Fragment, Component } from 'preact';
import { types as t, path, lib } from '@codecast/lib';
import FakeMedia from './fake-media.js';
import Screen from './screen.jsx';
import Section from './section.jsx';
import * as actions from './actions.js';
import _ from 'lodash';

type Props = { store: t.Store; onExit: () => void };
export default class Recorder extends Component<Props> {
  media: FakeMedia = new FakeMedia(
    this.handleMediaProgress.bind(this),
    this.props.store.recorder!.sessionSummary.duration,
  );

  state = {
    localClock: this.props.store.recorder!.sessionSummary.duration,
    root:
      this.props.store.recorder!.root ||
      this.props.store.recorder!.history?.root ||
      this.props.store.recorder!.defaultRoot,
    sessionSummary: this.props.store.recorder!.sessionSummary,
  };

  startRecorder = async () => {
    if (this.props.store.recorder!.status === t.RecorderStatus.Uninitialized) {
      await actions.startRecorder(this.state.root, this.state.sessionSummary);
    } else {
      await actions.startRecorder();
    }
  };

  pauseRecorder = async () => {
    await actions.pauseRecorder();
  };

  save = async () => {
    await actions.saveRecorder();
  };

  updateRoot = (e: InputEvent) => {
    const target = e.target as HTMLInputElement;
    console.log('updateRoot', target.value);
    this.setState({ root: target.value });
  };

  updateSessionSummary = (e: InputEvent) => {
    const target = e.target as HTMLInputElement;
    console.log('updateSessionSummary: ', target.dataset.field, target.value);
    this.setState({
      sessionSummary: { ...this.state.sessionSummary, [target.dataset.field!]: target.value },
    });
    this.sendSessionSummaryUpdate();
  };

  sendSessionSummaryUpdate = _.throttle(
    async () => {
      try {
        await actions.updateRecorderSessionSummary(this.state.sessionSummary);
      } catch (error) {
        console.error(error);
      }
    },
    300,
    {
      leading: true,
      trailing: true,
    },
  );

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
    console.log('Recorder componentDidMount');
    this.enableOrDisableMedia();
    // this.props.setOnExit(this.onExit);
  }

  componentWillUnmount() {
    this.media.pause();
  }

  render() {
    const recorder = this.props.store.recorder!;
    const { status } = recorder;

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
            <div className="subsection buttons">
              <vscode-button appearance="secondary">Open studio</vscode-button>
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
              value={this.state.root}
              onInput={this.updateRoot}
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
              value={this.state.sessionSummary.title}
              onInput={this.updateSessionSummary}
              data-field="title"
            >
              Title
            </vscode-text-field>
            <vscode-text-area
              className="subsection"
              rows={5}
              resize="vertical"
              value={this.state.sessionSummary.description}
              onInput={this.updateSessionSummary}
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
