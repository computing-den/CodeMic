import { h, Fragment, Component } from 'preact';
import { types as t, lib } from '@codecast/lib';
import FakeMedia from './fake-media.js';
import Screen from './screen.jsx';
import Section from './section.jsx';
import * as actions from './actions.js';
import { updateStore } from './store.js';
import { JsxElement } from 'typescript';
import { EventEmitter } from 'vscode';
// import type { WebviewApi } from 'vscode-webview';
import _ from 'lodash';

type Props = { store: t.Store; onExit: () => void };
export default class Recorder extends Component<Props> {
  media: FakeMedia = new FakeMedia(this.handleMediaProgress.bind(this));

  state = {
    localClock: 0,
  };

  startRecorder = async () => {
    await actions.startRecorder();
  };

  pauseRecorder = async () => {
    await actions.pauseRecorder();
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
    const { status, workspaceFolders } = recorder;

    const timeStr = lib.formatTimeSeconds(this.state.localClock);
    let toggleFn: () => void, toggleIcon: string;
    if (status === t.RecorderStatus.Init) {
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
              <vscode-button className="toggle-button for-recorder" onClick={toggleFn} appearance="icon">
                <div className={`codicon ${toggleIcon}`} />
              </vscode-button>
              <div className="actions">
                <vscode-button appearance="icon" title="Discard">
                  <span className="codicon codicon-trash" />
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

            <vscode-text-field className="subsection" autofocus>
              Title
            </vscode-text-field>
            <vscode-text-area className="subsection" rows={5} resize="vertical">
              Summary
            </vscode-text-area>
            <vscode-text-field className="subsection" placeholder={workspaceFolders[0] || ''}>
              Workspace
              <vscode-button slot="end" appearance="icon" title="Pick">
                <span className="codicon codicon-search" />
              </vscode-button>
            </vscode-text-field>
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
