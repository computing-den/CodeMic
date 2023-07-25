import { h, Fragment, Component } from 'preact';
import * as ui from './lib/ui';
import * as libMisc from './lib/misc';
import * as actions from './actions';
import { updateStore } from './store';
import { JsxElement } from 'typescript';
import { EventEmitter } from 'vscode';
// import type { WebviewApi } from 'vscode-webview';
import _ from 'lodash';

type AppProps = {
  store: ui.Store;
  // postMessage(req: ui.FrontendRequest): Promise<ui.BackendResponse>;
};

type ScreenProps = AppProps & {
  breadcrumbs: BreadcrumbType[];
  openWelcome(): void;
  openRecorder(): void;
  openPlayer(path: string): void;
};

type BreadcrumbsProps = {
  breadcrumbs: BreadcrumbType[];
};

type BreadcrumbType = { title: string; onClick?: () => void };

export default class App extends Component<AppProps> {
  state = {
    screen: Welcome,
  };

  openWelcome = () => this.setState({ screen: Welcome });

  openRecorder = async () => {
    await actions.openRecorder();
    this.setState({ screen: Recorder });
  };

  openPlayer = async (path: string) => {
    await actions.openPlayer();
    this.setState({ screen: Player });
  };

  breadcrumbs = [
    {
      title: 'Start',
      onClick: this.openWelcome,
    },
  ];

  render() {
    return (
      <this.state.screen
        {...this.props}
        openWelcome={this.openWelcome}
        openRecorder={this.openRecorder}
        openPlayer={this.openPlayer}
        breadcrumbs={this.breadcrumbs}
      />
    );
  }
}

class Welcome extends Component<ScreenProps> {
  openBrowser = async () => {
    // TODO show file dialog
    this.props.openPlayer('~/session1');
  };

  render() {
    const recentFiles = [
      { name: 'session1', dir: '~', path: '~/session1' },
      { name: 'session2', dir: '~/workspaces', path: '~/workspaces/session2' },
      { name: 'session3', dir: '~/some-other', path: '~/some-other/session3' },
    ];

    return (
      <div className="screen welcome">
        <div className="section">
          <h2>Start</h2>
          <ul className="unstyled">
            <li>
              <vscode-link href="#" onClick={this.props.openRecorder}>
                <span className="codicon codicon-device-camera-video va-top m-right" />
                Record new session
              </vscode-link>
            </li>
            <li>
              <vscode-link href="#" onClick={this.openBrowser}>
                <span className="codicon codicon-folder-opened va-top m-right" />
                Open session
              </vscode-link>
            </li>
          </ul>
        </div>
        <div className="section recent">
          <h2>Recent</h2>
          <ul className="unstyled">
            {recentFiles.map(({ name, dir, path }) => (
              <li>
                <vscode-link href="#" onClick={() => this.props.openPlayer(path)}>
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

class Recorder extends Component<ScreenProps> {
  media: FakeMedia = new FakeMedia(this.handleMediaProgress.bind(this));

  state = {
    localClock: 0,
  };

  startRecording = async () => {
    await actions.startRecording();
  };

  stopRecording = async () => {
    await actions.stopRecording();
  };

  saveRecording = async () => {
    await actions.saveRecording();
  };

  discardRecording = async () => {
    await actions.discardRecording();
  };

  enableOrDisableMedia() {
    const isRecording = Boolean(this.props.store.recorder!.session?.isRecording);
    if (isRecording !== this.media.isPlaying()) {
      if (isRecording) this.media.play();
      else this.media.stop();
    }
  }

  handleMediaProgress(ms: number) {
    if (this.props.store.recorder!.session?.isRecording) {
      this.setState({ localClock: ms / 1000 });
    }
  }

  componentDidUpdate() {
    this.enableOrDisableMedia();
  }

  componentDidMount() {
    this.enableOrDisableMedia();
  }

  render() {
    const recorder = this.props.store.recorder!;
    const { session, workspaceFolders } = recorder;

    const breadcrumbs = [...this.props.breadcrumbs, { title: 'Record' }];

    const wrap = (body: any) => (
      <div className="recorder screen">
        <Breadcrumbs breadcrumbs={breadcrumbs} />
        {body}
      </div>
    );

    if (!session) {
      return wrap(<div className="background-msg">ERROR: empty session.</div>);
    }

    const toggleButton = session.isRecording ? (
      <vscode-button onClick={this.stopRecording} appearance="secondary">
        <div class="codicon codicon-debug-stop" />
      </vscode-button>
    ) : (
      <vscode-button onClick={this.startRecording}>
        <div class="codicon codicon-device-camera-video" />
      </vscode-button>
    );

    const timeStr = session.isRecording ? libMisc.formatTimeSeconds(this.state.localClock) : '00:00';

    return wrap(
      <>
        <vscode-text-field autofocus>Session Name</vscode-text-field>
        <div className="control-toolbar">
          {toggleButton}
          <div className="time">{timeStr}</div>
        </div>
      </>,
    );
  }
}

class Player extends Component<ScreenProps> {
  progressBar?: Element;
  media: FakeMedia = new FakeMedia(this.handleMediaProgress.bind(this));
  isSeeking: boolean = false;

  state = {
    localClock: 0,
  };

  startPlaying = async () => {
    await actions.startPlaying();
  };

  stopPlaying = async () => {
    await actions.stopPlaying();
  };

  handleProgressBarRef = (elem: Element | null) => {
    this.progressBar = elem || undefined;
  };

  mouseMoved = (e: MouseEvent) => {
    if (!this.isMouseOnProgressBar(e)) return;
    const p = this.getPosNormOfMouse(e);
    const shadow = this.progressBar!.querySelector('.shadow') as HTMLElement;
    shadow.style.height = `${p * 100}%`;
  };

  clicked = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const clock = this.getClockOfMouse(e);
    await this.seek(clock);
    this.media.time = clock * 1000;
    this.setState({ localClock: clock });
  };

  seek = async (clock: number) => {
    try {
      this.isSeeking = true;
      await actions.seek(clock);
    } finally {
      this.isSeeking = false;
    }
  };

  getClockOfMouse = (e: MouseEvent): number => {
    const p = this.getPosNormOfMouse(e);
    return this.props.store.player!.duration * p;
  };

  getPosNormOfMouse = (e: MouseEvent): number => {
    const rect = this.progressBar!.getBoundingClientRect();
    return (e.clientY - rect.y) / rect.height;
  };

  isMouseOnProgressBar = (e: MouseEvent): boolean => {
    const rect = this.progressBar!.getBoundingClientRect();
    const p = [e.clientX - rect.x, e.clientY - rect.y];
    return p[0] >= 0 && p[0] <= rect.width && p[1] >= 0 && p[1] <= rect.height;
  };

  // seekBackend = async (clock: number) => {
  //   (actions.seek, 200);
  // }

  enableOrDisableMedia() {
    const { isPlaying } = this.props.store.player!;
    if (isPlaying !== this.media.isPlaying()) {
      if (isPlaying) this.media.play();
      else this.media.stop();
    }
  }

  async handleMediaProgress(ms: number) {
    if (this.props.store.player!.isPlaying && !this.isSeeking) {
      const localClock = Math.max(0, Math.min(ms / 1000, this.props.store.player!.duration));
      await this.seek(localClock);
      this.setState({ localClock });
    }
  }

  componentDidUpdate() {
    this.enableOrDisableMedia();
  }

  componentDidMount() {
    document.addEventListener('mousemove', this.mouseMoved);
    this.enableOrDisableMedia();
  }

  componentWillUnmount() {
    document.removeEventListener('mousemove', this.mouseMoved);
  }

  render() {
    const player = this.props.store.player!;

    const breadcrumbs = [...this.props.breadcrumbs, { title: 'Play' }];

    const wrap = (body: any) => (
      <div className="player screen">
        <Breadcrumbs breadcrumbs={breadcrumbs} />
        {body}
      </div>
    );

    const filledStyle = { height: `${(this.state.localClock / player.duration) * 100}%` };

    return wrap(
      <div className="content">
        <div className="progress-bar" ref={this.handleProgressBarRef} onClick={this.clicked}>
          <div className="bar">
            <div className="shadow" />
            <div className="filled" style={filledStyle} />
          </div>
        </div>
        <div className="control-toolbar">
          {player.isPlaying ? (
            <vscode-button onClick={this.stopPlaying} appearance="secondary">
              <div class="codicon codicon-debug-pause" />
            </vscode-button>
          ) : (
            <vscode-button onClick={this.startPlaying}>
              <div class="codicon codicon-play" />
            </vscode-button>
          )}
          <div className="time">
            {libMisc.formatTimeSeconds(this.state.localClock)} / {libMisc.formatTimeSeconds(player.duration)}
          </div>
        </div>
        <p>isPlaying: {player.isPlaying ? 'yes' : 'no'}</p>
        <p>Name: {player.name}</p>
        <p>Duration: {player.duration}</p>
        <p>Path: {player.path}</p>
      </div>,
    );
  }
}

class Breadcrumbs extends Component<BreadcrumbsProps> {
  render() {
    let elems = this.props.breadcrumbs.map(b =>
      b.onClick ? (
        <vscode-link href="#" onClick={b.onClick}>
          <h2>{b.title}</h2>
        </vscode-link>
      ) : (
        <h2>{b.title}</h2>
      ),
    );
    elems = elems.flatMap((x, i) => (i ? [<span className="separator codicon codicon-chevron-right" />, x] : [x]));
    return <div className="breadcrumbs">{elems}</div>;
  }
}

class FakeMedia {
  private request: any;
  private lastTime: DOMHighResTimeStamp = 0;

  static intervalMs: number = 200;

  constructor(private listener: (time: number) => void, public time: number = 0) {
    this.play();
  }

  // set(time: number) {
  //   this.time += (performance.now() - )
  // }

  play() {
    console.log('fakemedia: play()');
    this.lastTime = performance.now();
    this.request = setTimeout(this.handle, FakeMedia.intervalMs);
  }

  stop() {
    console.log('fakemedia: stop()');
    clearTimeout(this.request);
    this.request = undefined;
  }

  isPlaying(): boolean {
    return Boolean(this.request);
  }

  private handle = () => {
    const time = performance.now();
    this.time += time - this.lastTime;
    this.lastTime = time;
    console.log('fakemedia: event: ', this.time);
    this.listener(this.time);
    this.request = setTimeout(this.handle, FakeMedia.intervalMs);
  };
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
