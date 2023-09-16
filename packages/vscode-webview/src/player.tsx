import { h, Fragment, Component } from 'preact';
import { types as t, path, lib } from '@codecast/lib';
// import FakeMedia from './fake_media.jsx';
import Media from './media.jsx';
import TimeFromNow from './time_from_now.jsx';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage from './api.js';
import _ from 'lodash';

type Props = { store: t.Store; onExit: () => void };
export default class Player extends Component<Props> {
  progressBar?: Element;
  media = new Media();
  seeking = false;

  get player(): t.PlayerState {
    return this.props.store.player!;
  }

  startPlayer = async () => {
    if (this.player.status === t.PlayerStatus.Uninitialized) {
      if (this.player.root) {
        await postMessage({ type: 'play' });
      } else {
        // TODO show error to user
        console.error('Select a workspace folder');
      }
    } else {
      if (this.isStoppedAlmostAtTheEnd()) await this.seek(0);
      await postMessage({ type: 'play' });
    }

    // this.media!.start();
  };

  pausePlayer = async () => {
    await postMessage({ type: 'pausePlayer' });
  };

  rootChanged = async (e: InputEvent) => {
    await postMessage({ type: 'updatePlayer', changes: { root: (e.target as HTMLInputElement).value } });
  };

  pickRoot = async () => {
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        defaultUri: this.player.root ? path.fileUriFromAbsPath(path.abs(this.player.root)) : undefined,
        canSelectFolders: true,
        canSelectFiles: false,
        title: 'Select workspace folder',
      },
    });
    if (uris?.length === 1) {
      if (!path.isFileUri(uris[0] as t.Uri)) {
        throw new Error(`pickRoot: only local paths are supported. Instead received ${uris[0]}`);
      }
      await postMessage({ type: 'updatePlayer', changes: { root: path.getFileUriPath(uris[0] as t.Uri) } });
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
  };

  seek = async (clock: number) => {
    if (this.player.status === t.PlayerStatus.Uninitialized) {
      // TODO populate the workspace automatically or prompt the user
      console.error('Workspace not populated yet');
      return;
    }
    // this.seekTaskQueueDontUseDirectly.clear();

    // await postMessage({ type: 'pausePlayer' });
    await postMessage({ type: 'seekPlayer', clock });
    // await postMessage({ type: 'play' });

    // await this.seekTaskQueueDontUseDirectly(clock);
  };

  // seekTaskQueueDontUseDirectly = lib.taskQueue(async (clock: number) => {
  //   try {
  //     this.seeking = true;
  //     clock = Math.max(0, Math.min(clock, this.player.sessionSummary.duration));
  //     await postMessage({ type: 'seekPlayer', clock });
  //     // this.media!.clock = clock;
  //   } finally {
  //     this.seeking = false;
  //   }
  // }, 1);

  getClockOfMouse = (e: MouseEvent): number => {
    const p = this.getPosNormOfMouse(e);
    return this.player.sessionSummary.duration * p;
  };

  getPosNormOfMouse = (e: MouseEvent): number => {
    const rect = this.progressBar!.getBoundingClientRect();
    return (e.clientY - rect.y) / rect.height;
  };

  isMouseOnProgressBar = (e: MouseEvent): boolean => {
    if (!this.progressBar) return false;
    const rect = this.progressBar!.getBoundingClientRect();
    const p = [e.clientX - rect.x, e.clientY - rect.y];
    return p[0] >= 0 && p[0] <= rect.width && p[1] >= 0 && p[1] <= rect.height;
  };

  tocItemClicked = async (e: Event, item: t.TocItem) => {
    e.preventDefault();
    await this.seek(item.clock);
  };

  fork = async () => {
    const res = await postMessage({ type: 'confirmForkFromPlayer', clock: this.player.clock });
    if (res.value) {
      await postMessage({
        type: 'openRecorder',
        sessionId: this.player.sessionSummary.id,
        fork: true,
        forkClock: this.player.clock,
      });
    }
  };

  edit = async () => {
    const res = await postMessage({ type: 'confirmEditFromPlayer' });
    if (res.value) {
      await postMessage({ type: 'openRecorder', sessionId: this.player.sessionSummary.id });
    }
  };

  // handleMediaProgress = async (clock: number) => {
  //   console.log(!this.seeking, this.player.status, t.PlayerStatus.Playing, clock);
  //   if (!this.seeking && this.player.status === t.PlayerStatus.Playing) {
  //     await this.seek(clock);
  //   }
  // };

  isStoppedAlmostAtTheEnd(): boolean {
    return (
      this.player.status === t.PlayerStatus.Stopped && this.player.clock >= this.player.sessionSummary.duration - 0.5
    );
  }

  // TODO the problem is that media.start() or media.pause() may not take effect immediately, causing the media.start() to be
  // called multiple times.\
  // NOTE: audio element's start() returns a promise
  // enableOrDisableMedia() {
  //   if (this.media) {
  //     if (this.player.status === t.PlayerStatus.Playing) {
  //       this.media.start();
  //     } else {
  //       this.media.pause();
  //     }
  //   }
  // }

  componentDidUpdate() {
    // this.enableOrDisableMedia();
  }

  componentDidMount() {
    document.addEventListener('mousemove', this.mouseMoved);
  }

  componentWillUnmount() {
    document.removeEventListener('mousemove', this.mouseMoved);
    this.media!.stop();
  }

  render() {
    const filledStyle = { height: `${(this.player.clock / this.player.sessionSummary.duration) * 100}%` };
    const ss = this.player.sessionSummary;

    let toggleFn: () => void, toggleIcon: string;
    if (this.player.status === t.PlayerStatus.Playing) {
      [toggleFn, toggleIcon] = [this.pausePlayer, 'codicon-debug-pause'];
    } else {
      [toggleFn, toggleIcon] = [this.startPlayer, 'codicon-play'];
    }

    return (
      <Screen className="player">
        <audio id="audio"></audio>
        {this.player.status !== t.PlayerStatus.Uninitialized && (
          <div className="progress-bar" ref={this.handleProgressBarRef} onClick={this.progressBarClicked}>
            <div className="bar">
              <div className="shadow" />
              <div className="filled" style={filledStyle} />
            </div>
          </div>
        )}
        <Section className="main-section">
          <Section.Header
            title="PLAYER"
            buttons={[<Section.Header.ExitButton onClick={this.props.onExit} />]}
            collapsible
          />
          <Section.Body>
            <div className="subsection details card card-bare card-no-padding card-with-media">
              <div className="media">
                <img src={ss.author.avatar} />
              </div>
              <div className="card-content">
                <div className="title large">{ss.title || 'Untitled'}</div>
                <div className="footer">
                  <span className="footer-item large author">{ss.author.name}</span>
                </div>
              </div>
            </div>
            <div className="subsection control-toolbar">
              <div className="toggle-button-container">
                <vscode-button className="toggle-button for-player" onClick={toggleFn} appearance="icon">
                  <div className={`codicon ${toggleIcon}`} />
                </vscode-button>
              </div>
              <div className="actions">
                <vscode-button
                  appearance="icon"
                  title={
                    this.player.status === t.PlayerStatus.Playing
                      ? `Fork: record a new session starting at this point`
                      : `Fork: record a new session starting at ${lib.formatTimeSeconds(this.player.clock)}`
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
                <vscode-button appearance="icon" title="Bookmark at this point">
                  <span className="codicon codicon-bookmark" />
                </vscode-button>
                <vscode-button appearance="icon" title="Like">
                  <span className="codicon codicon-heart" />
                </vscode-button>
              </div>
              <div className="time">
                <span className="text">
                  {lib.formatTimeSeconds(this.player.clock)} / {lib.formatTimeSeconds(ss.duration)}
                </span>
              </div>
            </div>
            <div className="subsection description">
              <div className="header">
                <span className="item bold timestamp">
                  <TimeFromNow timestamp={ss.timestamp} capitalize />
                </span>
                <div className="item badge bump-left">
                  <span className="codicon codicon-eye va-top m-right_small" />
                  <span className="count">{ss.views}</span>
                </div>
                <div className="item">
                  <span className="codicon codicon-heart va-top m-right_small" />
                  <span className="count">{ss.likes}</span>
                </div>
              </div>
              <div className="body">{ss.description}</div>
            </div>
            {this.player.status === t.PlayerStatus.Uninitialized && (
              <vscode-text-field
                className="subsection"
                data-field="root"
                onInput={this.rootChanged}
                value={this.player.root}
                autofocus
              >
                Workspace
                <vscode-button slot="end" appearance="icon" title="Pick" onClick={this.pickRoot}>
                  <span className="codicon codicon-search" />
                </vscode-button>
              </vscode-text-field>
            )}
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
