import { h, Fragment, Component } from 'preact';
import { types as t, lib } from '@codecast/lib';
import * as actions from './actions';
import { updateStore } from './store';
import { JsxElement } from 'typescript';
import { EventEmitter } from 'vscode';
// import type { WebviewApi } from 'vscode-webview';
import _ from 'lodash';

type AppProps = {
  store: t.Store;
  // postMessage(req: t.FrontendRequest): Promise<t.BackendResponse>;
};

type ScreenProps = AppProps & {
  breadcrumbs: BreadcrumbType[];
};

type BreadcrumbsProps = {
  breadcrumbs: BreadcrumbType[];
};

type BreadcrumbType = { title: string; onClick?: () => void };

export default class App extends Component<AppProps> {
  onExit?: () => Promise<boolean>;

  openWelcome = async () => {
    await actions.openWelcome();
  };

  openRecorder = async () => {
    await actions.openRecorder();
  };

  openPlayer = async (path: string) => {
    await actions.openPlayer();
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
    [t.Screen.Welcome]: Welcome,
    [t.Screen.Recorder]: Recorder,
    [t.Screen.Player]: Player,
  };

  render() {
    const Screen = this.screens[this.props.store.screen];
    return (
      <Screen
        {...this.props}
        breadcrumbs={this.breadcrumbs}
        // setOnExit={this.setOnExit}
      />
    );
  }
}

class Welcome extends Component<ScreenProps> {
  openRecorder = async () => {
    await actions.openRecorder();
  };

  openPlayer = async (uri?: t.Uri) => {
    await actions.openPlayer(uri);
  };

  render() {
    const recentFiles = [
      { name: 'session1', dir: '~', uri: { scheme: 'file', path: '~/session1' } as t.Uri },
      { name: 'session2', dir: '~/workspaces', uri: { scheme: 'file', path: '~/workspaces/session2' } as t.Uri },
      { name: 'session3', dir: '~/some-other', uri: { scheme: 'file', path: '~/some-other/session3' } as t.Uri },
    ];

    return (
      <div className="screen welcome">
        <div className="section">
          <h2>Start</h2>
          <ul className="unstyled">
            <li>
              <vscode-link href="#" onClick={this.openRecorder}>
                <span className="codicon codicon-device-camera-video va-top m-right" />
                Record new session
              </vscode-link>
            </li>
            <li>
              <vscode-link href="#" onClick={() => this.openPlayer()}>
                <span className="codicon codicon-folder-opened va-top m-right" />
                Open session
              </vscode-link>
            </li>
          </ul>
        </div>
        <div className="section recent">
          <h2>Recent</h2>
          <ul className="unstyled">
            {recentFiles.map(({ name, dir, uri }) => (
              <li>
                <vscode-link href="#" onClick={() => this.openPlayer(uri)}>
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

  // discardRecorder = async () => {
  //   await actions.discardRecorder();
  // };

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

    const timeStr = lib.formatTimeSeconds(this.state.localClock);

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
    this.media.time = clock * 1000;

    await this.seek(clock, true);
    // this.media.time = clock * 1000;
    // this.setState({ localClock: clock });
  };

  // force will delete any seek before or after this one.
  // Consider that we are currently at t=10, and we seek to t=20,
  // but before the seek is complete, media sends a progress update
  // to seek to t=10.1. If the seek t=20 is forced, the t=10.1 will be
  // removed from the queue
  seek = async (clock: number, force: boolean) => {
    if (force) this.seekTaskQueueDontUseDirectly.clear();
    await this.seekTaskQueueDontUseDirectly(clock);
    if (force) this.seekTaskQueueDontUseDirectly.clear();
  };

  seekTaskQueueDontUseDirectly = lib.taskQueue(async (clock: number) => {
    const localClock = Math.max(0, Math.min(clock, this.props.store.player!.duration));
    await actions.seek(clock);
    this.setState({ localClock });
  }, 1);

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
    if (this.props.store.player!.isPlaying) {
      await this.seek(ms / 1000, false);
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
            {lib.formatTimeSeconds(this.state.localClock)} / {lib.formatTimeSeconds(player.duration)}
          </div>
        </div>
        <p>isPlaying:: {player.isPlaying ? 'yes' : 'no'}</p>
        <p>Name: {player.name}</p>
        <p>Duration: {player.duration}</p>
        <p>Path: {player.uri?.path}</p>
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
