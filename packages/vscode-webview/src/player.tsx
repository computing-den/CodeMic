import { h, Fragment, Component } from 'preact';
import { types as t, lib } from '@codecast/lib';
import FakeMedia from './fake-media.js';
import Screen from './screen.js';
import Section from './section.js';
import * as actions from './actions.js';
import { updateStore } from './store.js';
import { EventEmitter } from 'vscode';
// import type { WebviewApi } from 'vscode-webview';
import _ from 'lodash';
import moment from 'moment';

type Props = { store: t.Store; onExit: () => void };
export default class Player extends Component<Props> {
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
    const localClock = Math.max(0, Math.min(clock, this.props.store.player!.sessionSummary.duration));
    await actions.seek(clock);
    this.setState({ localClock });
  }, 1);

  getClockOfMouse = (e: MouseEvent): number => {
    const p = this.getPosNormOfMouse(e);
    return this.props.store.player!.sessionSummary.duration * p;
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
    const { status } = this.props.store.player!;
    if (status === t.PlayerStatus.Playing && !this.media.isActive()) {
      this.media.start();
    } else if (status === t.PlayerStatus.Playing && !this.media.isActive()) {
      this.media.pause();
    }
  }

  async handleMediaProgress(ms: number) {
    if (this.props.store.player!.status === t.PlayerStatus.Playing) {
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
    const filledStyle = { height: `${(this.state.localClock / player.sessionSummary.duration) * 100}%` };

    let toggleFn: () => void, toggleIcon: string;
    if (player.status === t.PlayerStatus.Playing) {
      [toggleFn, toggleIcon] = [this.pausePlayer, 'codicon-debug-pause'];
    } else {
      [toggleFn, toggleIcon] = [this.startPlayer, 'codicon-play'];
    }

    return (
      <Screen className="player">
        <Section className="main-section">
          <Section.Header
            title={player.sessionSummary.title}
            buttons={[<Section.Header.ExitButton onClick={this.props.onExit} />]}
            collapsible
          />
          <Section.Body>
            <div className="progress-bar" ref={this.handleProgressBarRef} onClick={this.clicked}>
              <div className="bar">
                <div className="shadow" />
                <div className="filled" style={filledStyle} />
              </div>
            </div>
            <div className="subsection control-toolbar">
              <vscode-button onClick={toggleFn}>
                <div className={`codicon ${toggleIcon}`} />
              </vscode-button>
              <div className="time">
                {lib.formatTimeSeconds(this.state.localClock)} / {lib.formatTimeSeconds(player.sessionSummary.duration)}
              </div>
              <div className="actions">
                <vscode-button appearance="icon" title="Fork: record a new session at this point">
                  <span className="codicon codicon-repo-forked" />
                </vscode-button>
                <vscode-button appearance="icon" title="Bookmark">
                  <span className="codicon codicon-bookmark" />
                </vscode-button>
              </div>
            </div>
            <div className="subsection details">
              <div className="header">
                <div className="heading">
                  <span className="author">{player.sessionSummary.author}</span>
                  <span className="timestamp">{moment(player.sessionSummary.timestamp).fromNow()}</span>
                </div>
                <div className="stats-and-actions">
                  <div className="item">
                    <span className="codicon codicon-eye va-top m-right_small" />
                    {player.sessionSummary.views}
                  </div>
                  <div className="item">
                    <span className="codicon codicon-thumbsup va-top m-right_small" />
                    {player.sessionSummary.likes}
                  </div>
                </div>
              </div>
              {player.sessionSummary.description && <div className="body">{player.sessionSummary.description}</div>}
            </div>
          </Section.Body>
        </Section>
      </Screen>
    );

    // return wrap(
    //   <div className="content">
    //     <p>isPlaying:: {player.isPlaying ? 'yes' : 'no'}</p>
    //     <p>Name: {player.name}</p>
    //     <p>Duration: {player.duration}</p>
    //     <p>Path: {player.uri?.path}</p>
    //   </div>,
    // );
  }
}
