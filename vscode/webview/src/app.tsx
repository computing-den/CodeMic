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
  // setOnExit(onExit: () => Promise<boolean>): void;
};

type BreadcrumbsProps = {
  breadcrumbs: BreadcrumbType[];
};

type BreadcrumbType = { title: string; onClick?: () => void };

export default class App extends Component<AppProps> {
  onExit?: () => Promise<boolean>;

  openWelcome = async () => {
    await actions.openWelcome();
    // if (await this.exitScreen()) {
    //   this.setState({ screen: Welcome });
    // }
  };

  openRecorder = async () => {
    await actions.openRecorder();
    // if (await this.exitScreen()) {
    //   await actions.openRecorder();
    //   this.setState({ screen: Recorder });
    // }
  };

  openPlayer = async (path: string) => {
    await actions.openPlayer();
    // if (await this.exitScreen()) {
    //   await actions.openPlayer();
    //   this.setState({ screen: Player });
    // }
  };

  // exitScreen = async () => {
  //   if (!this.onExit || (await this.onExit())) {
  //     this.onExit = undefined;
  //     return true;
  //   }
  //   return false;
  // };

  // setOnExit = (onExit: () => Promise<boolean>) => {
  //   this.onExit = onExit;
  // };

  breadcrumbs = [
    {
      title: 'Start',
      onClick: this.openWelcome,
    },
  ];

  screens = {
    [ui.Screen.Welcome]: Welcome,
    [ui.Screen.Recorder]: Recorder,
    [ui.Screen.Player]: Player,
  };

  render() {
    const Screen = this.screens[this.props.store.screen];
    return (
      <Screen
        {...this.props}
        openWelcome={this.openWelcome}
        openRecorder={this.openRecorder}
        openPlayer={this.openPlayer}
        breadcrumbs={this.breadcrumbs}
        // setOnExit={this.setOnExit}
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

  startRecorder = async () => {
    await actions.startRecorder();
  };

  pauseRecorder = async () => {
    await actions.pauseRecorder();
  };

  // saveRecording = async () => {
  //   await actions.saveRecording();
  // };

  discardRecorder = async () => {
    await actions.discardRecorder();
  };

  // onExit = async () => {
  //   const canExit = await actions.askToCloseRecorder();
  //   if (canExit) await actions.closeRecorder();
  //   return canExit;
  // };

  enableOrDisableMedia() {
    const isRecording = Boolean(this.props.store.recorder!.session?.isRecording);
    if (isRecording !== this.media.isActive()) {
      if (isRecording) this.media.start();
      else this.media.pause();
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
    // this.props.setOnExit(this.onExit);
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
      throw new Error('Recorder:render(): no session');
    }

    const toggleButton = session.isRecording ? (
      <vscode-button onClick={this.pauseRecorder} appearance="secondary">
        <div class="codicon codicon-debug-pause" />
      </vscode-button>
    ) : (
      <vscode-button onClick={this.startRecorder}>
        <div class="codicon codicon-device-camera-video" />
      </vscode-button>
    );

    const timeStr = libMisc.formatTimeSeconds(this.state.localClock);

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

  startPlayer = async () => {
    await actions.startPlayer();
  };

  pausePlayer = async () => {
    await actions.pausePlayer();
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
    if (isPlaying !== this.media.isActive()) {
      if (isPlaying) this.media.start();
      else this.media.pause();
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
            <vscode-button onClick={this.pausePlayer} appearance="secondary">
              <div class="codicon codicon-debug-pause" />
            </vscode-button>
          ) : (
            <vscode-button onClick={this.startPlayer}>
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
    this.start();
  }

  // set(time: number) {
  //   this.time += (performance.now() - )
  // }

  start() {
    this.lastTime = performance.now();
    this.request = setTimeout(this.handle, FakeMedia.intervalMs);
  }

  pause() {
    clearTimeout(this.request);
    this.request = undefined;
  }

  isActive(): boolean {
    return Boolean(this.request);
  }

  private handle = () => {
    const time = performance.now();
    this.time += time - this.lastTime;
    this.lastTime = time;
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
