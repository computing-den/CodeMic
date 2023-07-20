import { h, Component } from 'preact';
import * as ui from './lib/ui';
import { Store, updateStore } from './store';
// import type { WebviewApi } from 'vscode-webview';

type AppProps = {
  store: Store;
  postMessage(req: ui.FrontendRequest): Promise<ui.BackendResponse>;
};

type ScreenProps = AppProps & {
  openScreen(screen: any): void;
};

export default class App extends Component<AppProps> {
  state = {
    screen: Welcome,
  };

  openScreen = (screen: any) => this.setState({ screen });

  render() {
    return <this.state.screen {...this.props} openScreen={this.openScreen} />;
  }
}

class Welcome extends Component<ScreenProps> {
  open = async (name: string) => {
    const res = await this.props.postMessage({ type: 'play' });
    console.log('open: got response from backend: ', res);
  };

  browse = async () => {
    const res = await this.props.postMessage({ type: 'play' });
    console.log('browse: got response from backend: ', res);
  };

  render() {
    const recentFiles = [
      { name: 'session1', dir: '~' },
      { name: 'session2', dir: '~/workspaces' },
      { name: 'session3', dir: '~/some-other' },
    ];

    return (
      <div className="welcome">
        <div className="section">
          <h2>Start</h2>
          <ul className="unstyled">
            <li>
              <vscode-link
                href="#"
                onClick={() => {
                  this.props.openScreen(Record);
                }}
              >
                <span className="codicon codicon-device-camera-video va-top m-right" />
                Record new session
              </vscode-link>
            </li>
            <li>
              <vscode-link href="#" onClick={() => this.browse()}>
                <span className="codicon codicon-folder-opened va-top m-right" />
                Open session
              </vscode-link>
            </li>
          </ul>
        </div>
        <div className="section recent">
          <h2>Recent</h2>
          <ul className="unstyled">
            {recentFiles.map(({ name, dir }) => (
              <li>
                <vscode-link href="#" onClick={() => this.open(name)}>
                  {name}
                </vscode-link>
                {dir}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
}

class Record extends Component<ScreenProps> {
  state = {
    path: '',
  };

  startRecording = async () => {
    const { type } = await this.props.postMessage({ type: 'record' });
    if (type === 'yes') {
      updateStore(store => {
        store.recorder.isRecording = true;
      });
    }
  };

  stopRecording = async () => {
    const { type } = await this.props.postMessage({ type: 'stop' });
    if (type === 'yes') {
      updateStore(store => {
        store.recorder.isRecording = false;
      });
    }
  };
  async componentDidMount() {
    const res = await this.props.postMessage({ type: 'getWorkspaceFolder' });
    if (res.type !== 'getWorkspaceFolder') throw new Error(`Unknown response type ${res.type}`);

    this.setState({ path: res.path || '' });
  }

  render() {
    if (!this.state.path) {
      return (
        <div className="record">
          <h1>Record</h1>
          <div className="add-folder-msg">Add a folder to your workspace.</div>
        </div>
      );
    }

    if (this.props.store.recorder.isRecording) {
      return (
        <div className="record">
          <h1>
            Recording <span className="rec-icon codicon codicon-circle-large-filled" />
          </h1>
          <vscode-text-field autofocus>Session Name</vscode-text-field>
          <vscode-button onClick={this.stopRecording}>Stop recording</vscode-button>
        </div>
      );
    }

    return (
      <div className="record">
        <h1>Record</h1>
        <vscode-text-field autofocus>Session Name</vscode-text-field>
        <vscode-button onClick={this.startRecording}>Start recording</vscode-button>
      </div>
    );
  }
}

// export class App extends Component {
//   interval: any;

//   state = {
//     time: 0,
//     duration: 60,
//     isPlaying: false,
//   };

//   sliderChanged = (e: Event) => {
//     const time = Number((e.target as HTMLInputElement).value);
//     console.log(`sliderChanged: ${time}`);
//     this.setState({ time });
//     postMessage({ type: 'seek', time });
//   };

//   play = () => {
//     this.setState({ isPlaying: true });
//     postMessage({ type: 'play' });

//     // Fake playback events
//     const TS = 0.2;
//     this.interval = setInterval(() => {
//       const time = Math.min(this.state.duration, this.state.time + TS);
//       this.setState({ time });
//       postMessage({ type: 'playbackUpdate', time });
//       if (time >= this.state.duration) {
//         this.stop();
//       }
//     }, TS * 1000);
//   };

//   stop = () => {
//     this.setState({ isPlaying: false });
//     postMessage({ type: 'stop' });
//     clearInterval(this.interval);
//     this.interval = undefined;
//   };

//   clicked = (e: Event) => {
//     console.log('clicked', e);
//   };

//   render = () => {
//     const { time, duration, isPlaying } = this.state;
//     return (
//       <div>
//         <input type="range" min={0} max={duration} step="any" onChange={this.sliderChanged} value={time} />
//         <vscode-button onClick={this.clicked}>
//           <div class="codicon codicon-add" />
//           Hello!
//         </vscode-button>
//       </div>
//     );
//     // return (
//     //   <div>
//     //     <button className="button" onClick={this.play} disabled={isPlaying}>
//     //       play
//     //     </button>
//     //     <button className="button" onClick={this.stop} disabled={!isPlaying}>
//     //       stop
//     //     </button>
//     //   </div>
//     // );
//   };
// }
