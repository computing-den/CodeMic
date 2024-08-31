import { h, Fragment, Component } from 'preact';
import { types as t, path, lib } from '@codecast/lib';
// import FakeMedia from './fake_media.jsx';
import ProgressBar from './progress_bar.jsx';
import PathField from './path_field.jsx';
import MediaToolbar, * as MT from './media_toolbar.jsx';
import { SessionHead } from './session_head.jsx';
import SessionDescription from './session_description.jsx';
import { CommentInput, CommentList } from './comment.jsx';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage, { setMediaManager } from './api.js';
import MediaManager from './media_manager.js';
import _ from 'lodash';

type Props = { user?: t.User; player: t.PlayerState };
export default class Player extends Component<Props> {
  seeking = false;
  mediaManager = new MediaManager();

  load = async () => {
    await postMessage({ type: 'player/load' });
  };

  play = async () => {
    await this.mediaManager.prepare(this.getVideoElem());
    await postMessage({ type: 'player/play' });
  };

  pause = async () => {
    await postMessage({ type: 'player/pause' });
  };

  // rootChanged = async (root: string) => {
  //   await postMessage({ type: 'player/update', changes: { root } });
  // };

  seek = async (clock: number) => {
    if (!this.props.player.loaded) {
      console.error(`Cannot seek track that is not loaded`);
      return;
    }
    await postMessage({ type: 'player/seek', clock });
  };

  getVideoElem = (): HTMLVideoElement => {
    return document.querySelector('#guide-video')!;
  };

  tocItemClicked = async (e: Event, item: t.TocItem) => {
    e.preventDefault();
    await this.seek(item.clock);
  };

  fork = async () => {
    const res = await postMessage({ type: 'confirmForkFromPlayer', clock: this.props.player.clock });
    if (res.value) {
      await postMessage({
        type: 'recorder/open',
        sessionId: this.props.player.sessionHead.id,
        fork: true,
        clock: this.props.player.clock,
      });
    }
  };

  edit = async () => {
    const res = await postMessage({ type: 'confirmEditFromPlayer', clock: this.props.player.clock });
    if (res.value) {
      await postMessage({ type: 'recorder/open', sessionId: this.props.player.sessionHead.id });
    }
  };

  // isStoppedAlmostAtTheEnd(): boolean {
  //   return (
  //     this.props.player.state.status === t.TrackPlayerStatus.Stopped &&
  //     this.props.player.clock >= this.props.player.sessionHead.duration - 0.5
  //   );
  // }

  updateResources() {
    const { audioTracks, videoTracks, blobsWebviewUris: webviewUris } = this.props.player;
    if (webviewUris) {
      this.mediaManager.updateResources(webviewUris, audioTracks, videoTracks);
    }
  }

  componentDidUpdate() {
    this.updateResources();
  }

  componentDidMount() {
    setMediaManager(this.mediaManager);
    this.updateResources();
  }

  componentWillUnmount() {
    this.mediaManager.close();
  }

  render() {
    const { player, user } = this.props;
    const { sessionHead: ss } = player;

    let primaryAction: MT.PrimaryAction;
    if (player.playing) {
      primaryAction = { type: 'player/pause', title: 'Pause', onClick: this.pause };
    } else if (player.loaded) {
      primaryAction = { type: 'player/play', title: 'Play', onClick: this.play };
    } else {
      const title = player.workspace
        ? `Load the project into ${player.workspace}`
        : `Select a directory and load the project into it`;
      primaryAction = { type: 'player/load', title, onClick: this.load };
    }

    const toolbarActions = [
      {
        title: player.playing
          ? `Fork: create a new project starting at this point`
          : player.clock > 0
            ? `Fork: create a new project starting at ${lib.formatTimeSeconds(player.clock)}`
            : `Fork: create a new project based on this one`,
        icon: 'codicon-repo-forked',
        onClick: this.fork,
      },
      {
        title: 'Edit: open this project in the Studio',
        icon: 'codicon-edit',
        onClick: this.edit,
      },
      {
        title: 'Bookmark at this point',
        icon: 'codicon-bookmark',
        onClick: () => {
          console.log('TODO');
        },
      },
      {
        title: 'Like',
        icon: 'codicon-heart-filled',
        onClick: () => {
          console.log('TODO');
        },
      },
    ];

    const comments: t.Comment[] = [
      {
        id: 'z',
        author: { username: 'addy', email: '', joinTimestamp: '' },
        creation_timestamp: '2024-08-21T11:28:40.042Z',
        likes: 11,
        dislikes: 0,
        text: 'Infinity loop is missing !',
      },
      {
        id: 'y',
        author: { username: 'addy', email: '', joinTimestamp: '' },
        creation_timestamp: '2024-08-21T11:23:40.042Z',
        text: "now, I won't go too far into this...\nProceeds to present a highly detailed and informative picture for the next 50 minutes.",
        likes: 8,
        dislikes: 0,
      },
      {
        id: 'x',
        author: { username: 'lukas', email: '', joinTimestamp: '' },
        creation_timestamp: '2024-08-21T11:13:40.042Z',
        text: 'Great episode!',
        likes: 3,
        dislikes: 0,
      },
      {
        id: 'a',
        author: { username: 'olivia', email: '', joinTimestamp: '' },
        creation_timestamp: '2024-08-21T10:13:40.042Z',
        text: 'Thanks for the great content',
        likes: 0,
        dislikes: 0,
      },
    ];

    return (
      <Screen className="player">
        {player.loaded && <ProgressBar duration={ss.duration} onSeek={this.seek} clock={player.clock} />}
        <Section className="main-section">
          {/*
          <Section.Header
            title="PLAYER"
            buttons={[<Section.Header.ExitButton onClick={this.props.onExit} />]}
            collapsible
          />
            */}
          <Section.Body>
            <SessionHead className="subsection subsection_spaced" sessionHead={ss} withAuthor />
            <MediaToolbar
              className="subsection subsection_spaced"
              primaryAction={primaryAction}
              actions={toolbarActions}
              clock={player.clock}
              duration={ss.duration}
            />
            <div className="subsection hide-inactive guide-video-container">
              <video id="guide-video" />
            </div>
            <SessionDescription className="subsection subsection_spaced" sessionHead={ss} />
            {/*!player.loaded && (
              <PathField
                className="subsection"
                onChange={this.rootChanged}
                value={player.workspace}
                label="Workspace"
                pickTitle="Select workspace folder"
                autoFocus
              />
              )*/}
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
            {ss.toc.length > 0 && (
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
        <Section className="comments-section">
          <Section.Header title="COMMENTS" collapsible />
          <Section.Body>
            {user && <CommentInput author={user} />}
            <CommentList comments={comments} />
          </Section.Body>
        </Section>
        {/*
        <Section className="dev-section">
          <Section.Header title="DEV" collapsible />
          <Section.Body>
            <DevTrackPlayer p={player.trackPlayerSummary} />
            {player.DEV_trackPlayerSummaries.map(p => (
              <DevTrackPlayer p={p} />
            ))}
          </Section.Body>
        </Section>
        */}
      </Screen>
    );
  }
}

// class DevTrackPlayer extends Component<{ p: t.TrackPlayerSummary }> {
//   render() {
//     const { p } = this.props;

//     return (
//       <ul className="track-player">
//         <li>
//           <b>{p.name}</b>
//         </li>
//         <li>{p.playbackRate.toFixed(3)}x</li>
//         <li>{p.clock.toFixed(3)}</li>
//         <li>{t.TrackPlayerStatus[p.state.status]}</li>
//         <li>
//           {[
//             p.state.loaded && 'loaded',
//             p.state.loading && 'loading',
//             p.state.seeking && 'seeking',
//             p.state.buffering && 'buffering',
//           ]
//             .filter(Boolean)
//             .join(', ')}
//         </li>
//       </ul>
//     );
//   }
// }
