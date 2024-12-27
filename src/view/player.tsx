import React from 'react';
import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
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
import { cn, getCoverUri } from './misc.js';
import _ from 'lodash';
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import { AppContext } from './app_context.jsx';

type Props = { user?: t.User; player: t.PlayerUIState; session: t.SessionUIState };
export default class Player extends React.Component<Props> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;

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
    if (!lib.isLoadedSession(this.props.session)) {
      console.error(`Cannot seek track that is not loaded`);
      return;
    }
    await postMessage({ type: 'player/seek', clock });
  };

  getVideoElem = (): HTMLVideoElement => {
    return document.getElementById('guide-video') as HTMLVideoElement;
  };

  getCoverContainerElem = (): HTMLElement => {
    return document.getElementById('cover-container')!;
  };

  tocItemClicked = async (e: React.MouseEvent, item: t.TocItem) => {
    e.preventDefault();
    await this.seek(item.clock);
  };

  fork = async () => {
    const res = await postMessage({ type: 'confirmForkFromPlayer' });
    if (res.value) {
      await postMessage({
        type: 'recorder/open',
        sessionId: this.props.session.head.id,
        fork: true,
        clock: this.props.session.clock,
      });
    }
  };

  edit = async () => {
    const res = await postMessage({ type: 'confirmEditFromPlayer', clock: this.props.session.clock });
    if (res.value) {
      await postMessage({ type: 'recorder/open', sessionId: this.props.session.head.id });
    }
  };

  // isStoppedAlmostAtTheEnd(): boolean {
  //   return (
  //     this.props.player.state.status === t.TrackPlayerStatus.Stopped &&
  //     this.props.player.clock >= this.props.player.sessionHead.duration - 0.5
  //   );
  // }

  updateCoverContainerHeight = () => {
    const container = this.getCoverContainerElem();
    let height = 0;
    for (const child of container.children) {
      height = Math.max(height, child.getBoundingClientRect().height);
    }
    container.style.height = `${height}px`;
  };

  updateResources() {
    this.mediaManager.updateResources(this.props.session);
  }

  componentDidUpdate() {
    this.updateResources();
    this.updateCoverContainerHeight();
  }

  componentDidMount() {
    setMediaManager(this.mediaManager);
    this.updateResources();
    this.updateCoverContainerHeight();
    window.addEventListener('resize', this.updateCoverContainerHeight);
  }

  componentWillUnmount() {
    this.mediaManager.close();
    window.removeEventListener('resize', this.updateCoverContainerHeight);
  }

  render() {
    const { cache } = this.context;
    const { session, user } = this.props;
    const { head } = session;

    let primaryAction: MT.PrimaryAction;
    if (session.playing) {
      primaryAction = { type: 'player/pause', title: 'Pause', onClick: this.pause };
    } else if (session.loaded) {
      primaryAction = { type: 'player/play', title: 'Play', onClick: this.play };
    } else {
      const title = session.workspace
        ? `Load the project into ${session.workspace}`
        : `Select a directory and load the project into it`;
      primaryAction = { type: 'player/load', title, onClick: this.load };
    }

    const toolbarActions = [
      // {
      //   title: 'Fork: create a new project based on this one',
      //   icon: 'codicon-repo-forked',
      //   onClick: this.fork,
      // },
      {
        title: 'Edit: open this project in the Studio',
        icon: 'codicon-edit',
        onClick: this.edit,
      },
      // {
      //   title: 'Bookmark at this point',
      //   icon: 'codicon-bookmark',
      //   onClick: () => {
      //     console.log('TODO');
      //   },
      // },
      {
        title: 'Like',
        icon: 'codicon-heart-filled',
        onClick: () => {
          console.log('TODO');
        },
      },
    ];

    const tocIndex = _.findLastIndex(head.toc, item => item.clock <= session.clock);

    return (
      <Screen className="player">
        {lib.isLoadedSession(session) && (
          <ProgressBar
            duration={head.duration}
            onSeek={this.seek}
            clock={session.clock}
            workspaceFocusTimeline={session.workspaceFocusTimeline}
            toc={head.toc}
          />
        )}
        <Section className="main-section">
          {/*
          <Section.Header
            title="PLAYER"
            buttons={[<Section.Header.ExitButton onClick={this.props.onExit} />]}
            collapsible
          />
            */}
          <Section.Body>
            <SessionHead className="subsection subsection_spaced" sessionHead={head} withAuthor />
            <MediaToolbar
              className="subsection subsection_spaced"
              primaryAction={primaryAction}
              actions={toolbarActions}
              clock={session.clock}
              duration={head.duration}
            />
            <div id="cover-container" className="cover-container subsection">
              {head.hasCover && <img src={getCoverUri(head.id, cache).toString()} />}
              <video id="guide-video" />
            </div>
            <SessionDescription className="subsection subsection_spaced" sessionHead={head} />
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
            <div className="subsection search">
              <VSCodeDropdown>
                <VSCodeOption>Table of contents</VSCodeOption>
                <VSCodeOption>Files</VSCodeOption>
                <VSCodeOption>Entities</VSCodeOption>
              </VSCodeDropdown>
              <VSCodeTextField placeholder="Search"></VSCodeTextField>
            </div>
            {head.toc.length > 0 && (
              <div className="subsection toc">
                {head.toc.map((item, i) => (
                  <div
                    tabIndex={0}
                    className={cn('item', i === tocIndex && session.loaded && 'active')}
                    onClick={e => this.tocItemClicked(e, item)}
                  >
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
            <CommentList comments={session.comments} />
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

// class DevTrackPlayer extends React.Component<{ p: t.TrackPlayerSummary }> {
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
