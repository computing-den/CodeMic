import { h, Fragment, Component } from 'preact';
import { types as t, path, lib } from '@codecast/lib';
import FakeMedia from './fake-media.jsx';
import TimeFromNow from './time_from_now.jsx';
import Screen from './screen.jsx';
import Section from './section.jsx';
import * as actions from './actions.js';
// import type { WebviewApi } from 'vscode-webview';
import _ from 'lodash';
import moment from 'moment';

type Props = { store: t.Store; onExit: () => void };
export default class Player extends Component<Props> {
  progressBar?: Element;
  media = new FakeMedia(this.handleMediaProgress.bind(this));
  seeking = false;

  state = {
    localClock: 0,
    root: this.props.store.player!.history?.root,
  };

  startPlayer = async () => {
    if (this.props.store.player!.status === t.PlayerStatus.Uninitialized) {
      if (this.state.root) {
        await actions.startPlayer(this.state.root);
      } else {
        // TODO show error to user
        console.error('Select a workspace folder');
      }
    } else {
      if (this.isStoppedAlmostAtTheEnd()) await this.seek(0);
      await actions.startPlayer();
    }
  };

  pausePlayer = async () => {
    await actions.pausePlayer();
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

  handleProgressBarRef = (elem: Element | null) => {
    this.progressBar = elem || undefined;
  };

  mouseMoved = (e: MouseEvent) => {
    if (!this.isMouseOnProgressBar(e)) return;
    const p = this.getPosNormOfMouse(e);
    const shadow = this.progressBar!.querySelector('.shadow') as HTMLElement;
    shadow.style.height = `${p * 100}%`;
  };

  progressBarClicked = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const clock = this.getClockOfMouse(e);

    await this.seek(clock);
    // this.media.time = clock * 1000;
    // this.setState({ localClock: clock });
  };

  seek = async (clock: number) => {
    if (this.props.store.player!.status === t.PlayerStatus.Uninitialized) {
      // TODO populate the workspace automatically or prompt the user
      console.error('Workspace not populated yet');
      return;
    }
    this.seekTaskQueueDontUseDirectly.clear();
    await this.seekTaskQueueDontUseDirectly(clock);
  };

  seekTaskQueueDontUseDirectly = lib.taskQueue(async (clock: number) => {
    try {
      this.seeking = true;
      const localClock = Math.max(0, Math.min(clock, this.props.store.player!.sessionSummary.duration));
      await actions.seek(localClock);
      this.media.timeMs = localClock * 1000;
      this.setState({ localClock });
    } finally {
      this.seeking = false;
    }
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

  tocItemClicked = async (e: Event, item: t.TocItem) => {
    e.preventDefault();
    await this.seek(item.clock);
  };

  fork = async () => {
    if (await actions.confirmForkFromPlayer(this.state.localClock)) {
      await actions.openRecorder(this.props.store.player!.sessionSummary.id, true, this.state.localClock);
    }
  };

  edit = async () => {
    if (await actions.confirmEditFromPlayer()) {
      await actions.openRecorder(this.props.store.player!.sessionSummary.id);
    }
  };

  isStoppedAlmostAtTheEnd(): boolean {
    return (
      this.props.store.player!.status === t.PlayerStatus.Stopped &&
      this.props.store.player!.clock >= this.props.store.player!.sessionSummary.duration - 0.5
    );
  }

  enableOrDisableMedia() {
    const isPlaying = Boolean(this.props.store.player!.status === t.PlayerStatus.Playing);
    if (isPlaying !== this.media.isActive()) {
      if (isPlaying) this.media.start();
      else this.media.pause();
    }
  }

  async handleMediaProgress(ms: number) {
    if (!this.seeking && this.props.store.player!.status === t.PlayerStatus.Playing) {
      await this.seek(ms / 1000);
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
    this.media.pause();
  }

  render() {
    const player = this.props.store.player!;
    const filledStyle = { height: `${(this.state.localClock / player.sessionSummary.duration) * 100}%` };
    const ss = player.sessionSummary;

    let toggleFn: () => void, toggleIcon: string;
    if (player.status === t.PlayerStatus.Playing) {
      [toggleFn, toggleIcon] = [this.pausePlayer, 'codicon-debug-pause'];
    } else {
      [toggleFn, toggleIcon] = [this.startPlayer, 'codicon-play'];
    }

    return (
      <Screen className="player">
        <div className="progress-bar" ref={this.handleProgressBarRef} onClick={this.progressBarClicked}>
          <div className="bar">
            <div className="shadow" />
            <div className="filled" style={filledStyle} />
          </div>
        </div>
        <Section className="main-section">
          <Section.Header
            title="PLAYER"
            buttons={[<Section.Header.ExitButton onClick={this.props.onExit} />]}
            collapsible
          />
          <Section.Body>
            <div className="controls-and-details">
              <div className="details card card-bare card-no-padding card-with-media">
                <div className="media">
                  <img src={ss.author.avatar} />
                </div>
                <div className="card-content">
                  <div className="title">{ss.title || 'Untitled'}</div>
                  <div className="description">{ss.description || 'No description'}</div>

                  <div className="footer">
                    <span className="footer-item timestamp">
                      <TimeFromNow timestamp={ss.timestamp} capitalize />
                    </span>
                  </div>
                  <div className="footer">
                    <span className="footer-item author">{ss.author.name}</span>
                    <div className="footer-item badge">
                      <span className="codicon codicon-eye va-top m-right_small" />
                      <span className="count">{ss.views}</span>
                    </div>
                    <div className="footer-item badge">
                      <span className="codicon codicon-heart va-top m-right_small" />
                      <span className="count">{ss.likes}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="control-toolbar">
                <div className="toggle-button-container">
                  <vscode-button className="toggle-button for-player" onClick={toggleFn} appearance="icon">
                    <div className={`codicon ${toggleIcon}`} />
                  </vscode-button>
                </div>
                <div className="actions">
                  <vscode-button
                    appearance="icon"
                    title={
                      player.status === t.PlayerStatus.Playing
                        ? `Fork: record a new session starting at this point`
                        : `Fork: record a new session starting at ${lib.formatTimeSeconds(this.state.localClock)}`
                    }
                    onClick={this.fork}
                  >
                    <span className="codicon codicon-repo-forked" />
                  </vscode-button>
                  <vscode-button
                    appearance="icon"
                    title="Edit: continue recording and editing this session"
                    onClick={this.edit}
                  >
                    <span className="codicon codicon-edit" />
                  </vscode-button>
                  <vscode-button appearance="icon" title="Bookmark">
                    <span className="codicon codicon-bookmark" />
                  </vscode-button>
                  <vscode-button appearance="icon" title="Like">
                    <span className="codicon codicon-heart" />
                  </vscode-button>
                </div>
                <div className="time">
                  <span className="text">
                    {lib.formatTimeSeconds(this.state.localClock)} / {lib.formatTimeSeconds(ss.duration)}
                  </span>
                </div>
              </div>
            </div>
            <div className="forms">
              {player.status === t.PlayerStatus.Uninitialized && (
                <vscode-text-field
                  className="subsection"
                  data-field="root"
                  onInput={this.updateField}
                  value={this.state.root}
                  autofocus
                >
                  Workspace
                  <vscode-button slot="end" appearance="icon" title="Pick" onClick={this.pickRoot}>
                    <span className="codicon codicon-search" />
                  </vscode-button>
                </vscode-text-field>
              )}
            </div>
          </Section.Body>
        </Section>
        <Section className="contents-section">
          <Section.Header title="CONTENTS" collapsible />
          <Section.Body>
            <vscode-text-field className="subsection" placeholder="Search"></vscode-text-field>
            <vscode-dropdown className="subsection">
              <vscode-option>Table of contents</vscode-option>
              <vscode-option>Files</vscode-option>
              <vscode-option>Entities</vscode-option>
            </vscode-dropdown>
            {ss.toc && (
              <div className="subsection toc">
                {ss.toc.map(item => (
                  <div tabIndex={0} className="item" onClick={e => this.tocItemClicked(e, item)}>
                    <div className="title">{item.title}</div>
                    <div className="clock">{lib.formatTimeSeconds(item.clock)}</div>
                  </div>
                ))}
              </div>
            )}
          </Section.Body>
        </Section>
      </Screen>
    );
  }
}
