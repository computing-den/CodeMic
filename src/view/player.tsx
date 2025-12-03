import React, { useRef, useState } from 'react';
import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
// import FakeMedia from './fake_media.jsx';
import ProgressBar from './progress_bar.jsx';
import PathField from './path_field.jsx';
import MediaToolbar, { MediaToolbarButton, MediaToolbarMenu, PrimaryAction } from './media_toolbar.jsx';
import { SessionHead } from './session_head.jsx';
import SessionDescription from './session_description.jsx';
import { CommentInput, CommentList } from './comment.jsx';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage from './api.js';
import { cn } from './misc.js';
import _ from 'lodash';
import { PictureInPicture } from './svgs.jsx';
import Cover from './cover.jsx';
import { VSCodeLink } from '@vscode/webview-ui-toolkit/react/index.js';
import { mediaManager } from './media_manager.js';
import ClipBanner from './clip_banner.jsx';

type Props = { user?: t.UserUI; player: t.PlayerUIState; session: t.SessionUIState };
export default class Player extends React.Component<Props> {
  coverHeightInterval?: any;
  // static contextType = AppContext;
  // declare context: React.ContextType<typeof AppContext>;

  seeking = false;

  load = async () => {
    await postMessage({ type: 'player/load', clock: this.props.session.history?.lastWatchedClock });
  };

  play = async () => {
    await mediaManager.prepare();
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
    await mediaManager.prepare();
    await postMessage({ type: 'player/seek', clock });
  };

  getVideoElem = (): HTMLVideoElement | undefined => {
    return document.getElementById('guide-video') as HTMLVideoElement | undefined;
  };

  getMediaContainerElem = (): HTMLElement => {
    return document.getElementById('media-container')!;
  };

  tocItemClicked = async (item: t.TocItem) => {
    if (this.props.session.loaded) {
      await this.seek(item.clock);
    }
  };

  fork = async () => {
    // TODO
    // const res = await postMessage({ type: 'confirmForkFromPlayer' });
    // if (res.value) {
    //   await postMessage({
    //     type: 'recorder/open',
    //     sessionId: this.props.session.head.id,
    //     fork: true,
    //     clock: this.props.session.clock,
    //   });
    // }
  };

  // isStoppedAlmostAtTheEnd(): boolean {
  //   return (
  //     this.props.player.state.status === t.TrackPlayerStatus.Stopped &&
  //     this.props.player.clock >= this.props.player.head.duration - 0.5
  //   );
  // }

  updateCoverContainerHeight = () => {
    const container = this.getMediaContainerElem();
    let height = 0;
    for (const child of container.children) {
      height = Math.max(height, child.getBoundingClientRect().height);
    }
    container.style.height = `${height}px`;
  };

  togglePictureInPicture = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await this.getVideoElem()!.requestPictureInPicture();
      }
    } catch (error) {
      console.error(error);
    }
  };

  sendComment = async (text: string) => {
    await postMessage({
      type: 'player/comment',
      text,
      sessionId: this.props.session.head.id,
      clock: this.props.session.clock,
    });
  };

  like = async (value: boolean) => {
    await postMessage({ type: 'player/likeSession', value });
  };

  login = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    postMessage({ type: 'account/open' });
  };
  join = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    postMessage({ type: 'account/open', join: true });
  };

  stepBackward = async () => {
    await postMessage({ type: 'player/seek', clock: this.props.session.clock - 5 });
  };

  stepForward = async () => {
    await postMessage({ type: 'player/seek', clock: this.props.session.clock + 5 });
  };

  setPlaybackRate = async (rate: number) => {
    await postMessage({ type: 'player/setPlaybackRate', rate });
  };

  componentDidUpdate(prevProps: Props) {
    this.updateCoverContainerHeight();

    if (this.props.session.loaded && !prevProps.session.loaded) {
      postMessage({ type: 'readyToLoadMedia' }).catch(console.error);
    }
  }

  componentDidMount() {
    if (this.props.session.loaded) {
      postMessage({ type: 'readyToLoadMedia' }).catch(console.error);
    }

    // window.addEventListener('resize', this.updateCoverContainerHeight);

    // Must use interval instead of listening to resize event because our cover
    // image (see the Cover component) can change if it fails to load and must
    // show the fallback photo.
    // TODO Actually, that may not be the reason. I don't know why the cover photo
    // requires a resize sometimes.
    this.coverHeightInterval = setInterval(this.updateCoverContainerHeight, 500);
    this.updateCoverContainerHeight();
  }

  componentWillUnmount() {
    mediaManager.dispose().catch(console.error);
    // window.removeEventListener('resize', this.updateCoverContainerHeight);
    clearInterval(this.coverHeightInterval);
  }

  render() {
    // const { cache } = this.context;
    const { session, user } = this.props;
    const { head, publication, local, clock } = session;

    let curOrHistoryClock = clock;
    if (!session.loaded && session.history?.lastWatchedClock) {
      curOrHistoryClock = session.history.lastWatchedClock;
    }

    return (
      <Screen className="player">
        {lib.isLoadedSession(session) && (
          <ProgressBar
            duration={head.duration}
            onSeek={this.seek}
            clock={clock}
            workspaceFocusTimeline={session.workspaceFocusTimeline}
            toc={head.toc}
            sessionTitle={head.title}
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
            <PlayerMediaToolbar
              session={session}
              curOrHistoryClock={curOrHistoryClock}
              play={this.play}
              pause={this.pause}
              load={this.load}
              stepBackward={this.stepBackward}
              stepForward={this.stepForward}
              setPlaybackRate={this.setPlaybackRate}
              togglePictureInPicture={this.togglePictureInPicture}
              getVideoElem={this.getVideoElem}
            />
            <div
              id="media-container"
              className={cn(
                'media-container subsection subsection_spaced',
                // session.loaded && 'loaded',
                // session.clock === 0 && 'at-zero',
                // session.head.hasCover && 'cover',
              )}
            >
              <Cover local={local} hasCover={head.hasCover} sessionId={head.id} />
              {head.isClip && clock === 0 && <ClipBanner />}
              <video id="guide-video" />
            </div>
            <SessionHead className="subsection subsection_spaced" head={head} />
            <SessionDescription
              className="subsection"
              head={head}
              publication={publication}
              user={user}
              onLike={this.like}
            />
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
            {/*head.toc.length > 0 && (
              <div className="subsection search">
                <VSCodeDropdown>
                  <VSCodeOption>Table of contents</VSCodeOption>
                  {
                    //<VSCodeOption>Files</VSCodeOption><VSCodeOption>Entities</VSCodeOption>
                  }
                </VSCodeDropdown>
                <VSCodeTextField placeholder="Search"></VSCodeTextField>
              </div>
              )*/}
            {head.toc.length > 0 && (
              <TableOfContent
                head={head}
                onClick={this.tocItemClicked}
                clock={curOrHistoryClock}
                loaded={session.loaded}
              />
            )}
          </Section.Body>
        </Section>
        <Section className="comments-section">
          <Section.Header title="COMMENTS" collapsible />
          <Section.Body>
            <CommentInput author={user?.username} onSend={this.sendComment} disabled={!user || !session.publication} />
            {!user && (
              <div>
                <VSCodeLink href="#" onClick={this.login}>
                  Log in
                </VSCodeLink>{' '}
                or{' '}
                <VSCodeLink href="#" onClick={this.join}>
                  join
                </VSCodeLink>{' '}
                to comment.
              </div>
            )}
            {session.publication && <CommentList comments={session.publication.comments} />}
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

type PlayerMediaToolbarProps = {
  session: t.SessionUIState;
  curOrHistoryClock: number;
  play: () => any;
  pause: () => any;
  load: () => any;
  stepBackward: () => any;
  stepForward: () => any;
  togglePictureInPicture: () => any;
  setPlaybackRate: (rate: number) => any;
  getVideoElem: () => HTMLVideoElement | undefined;
};

function PlayerMediaToolbar(props: PlayerMediaToolbarProps) {
  const { session } = props;

  let primaryAction: PrimaryAction;
  if (session.playing) {
    primaryAction = { type: 'player/pause', title: 'Pause', onClick: props.pause };
  } else if (session.loaded) {
    primaryAction = { type: 'player/play', title: 'Play', onClick: props.play };
  } else if (session.local) {
    primaryAction = { type: 'player/load', title: `Load session into ${session.workspace}`, onClick: props.load };
  } else {
    primaryAction = {
      type: 'player/download',
      title: `Download and load session into ${session.workspace}`,
      onClick: props.load,
    };
  }

  const mediaToolbarActions = _.compact([
    // {
    //   title: 'Fork: create a new session based on this one',
    //   icon: 'codicon-repo-forked',
    //   onClick: this.fork,
    // },
    // {
    //   title: 'Bookmark at this point',
    //   icon: 'codicon-bookmark',
    //   onClick: () => {
    //     console.log('TODO');
    //   },
    // },
    // publication && {
    //   title: 'Like',
    //   icon: liked ? 'codicon-heart-filled' : 'codicon-heart',
    //   onClick: () => postMessage({ type: 'player/likeSession', value: !liked }),
    // },
    <MediaToolbarButton
      title="Jump 5s backwards"
      icon="codicon-chevron-left"
      onClick={props.stepBackward}
      disabled={!session.loaded || session.clock === 0}
    />,
    <MediaToolbarButton
      title="Jump 5s forward"
      icon="codicon-chevron-right"
      onClick={props.stepForward}
      disabled={!session.loaded || session.clock === session.head.duration}
    />,
    <MediaToolbarButton
      title="Share session"
      icon="codicon-link"
      onClick={() =>
        postMessage({
          type: 'copySessionLink',
          sessionId: session.head.id,
          sessionHandle: session.head.handle,
          sessionAuthor: session.head.author,
        })
      }
    />,
    <MediaToolbarMenu
      onSync={() => postMessage({ type: 'player/syncWorkspace' })}
      onEdit={() => postMessage({ type: 'player/openInRecorder' })}
      onPiP={props.togglePictureInPicture}
      onPlaybackRate={rate => postMessage({ type: 'player/setPlaybackRate', rate })}
      canSync={session.loaded}
      // NOTE: change of video src does not trigger an update
      //       but it's ok for now, since state/props change during playback.
      canPiP={Boolean(props.getVideoElem()?.src)}
      canEdit
      showEdit
      playbackRate={session.playbackRate}
    />,
  ]);

  return (
    <MediaToolbar
      className="subsection subsection_spaced"
      primaryAction={primaryAction}
      actions={mediaToolbarActions}
      clock={props.curOrHistoryClock}
      duration={session.head.duration}
    />
  );
}

function TableOfContent(props: {
  head: t.SessionHead;
  onClick: (item: t.TocItem) => any;
  loaded: boolean;
  clock: number;
}) {
  function clicked(e: React.MouseEvent, item: t.TocItem) {
    e.preventDefault();
    props.onClick(item);
  }
  const tocIndex = _.findLastIndex(props.head.toc, item => item.clock <= props.clock);

  const EXPAND_THRESHOLD = 10;
  const [expanded, setExpanded] = useState(false);
  const expandable = props.head.toc.length > EXPAND_THRESHOLD;
  let toc = props.head.toc;
  let startIndex = 0;
  if (expandable && !expanded) {
    let cur = tocIndex === -1 ? 0 : tocIndex;
    startIndex = Math.max(0, cur - EXPAND_THRESHOLD + 3);
    toc = toc.slice(startIndex, startIndex + EXPAND_THRESHOLD);
  }

  function toggleExpansion(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setExpanded(!expanded);
  }

  return (
    <div className="subsection toc">
      {startIndex > 0 && (
        <a className="expand unstyled" href="#" onClick={toggleExpansion}>
          ...
        </a>
      )}
      {toc.map((item, i) => (
        <div
          tabIndex={0}
          className={cn(
            'item',
            props.loaded && 'selectable',
            i + startIndex === tocIndex && (props.loaded || tocIndex > 0) && 'active',
          )}
          onClick={e => clicked(e, item)}
        >
          <div className="title">{item.title}</div>
          <div className="clock">{lib.formatTimeSeconds(item.clock)}</div>
        </div>
      ))}
      <a className="expand" href="#" onClick={toggleExpansion}>
        {expanded ? 'less' : 'more'}
      </a>
    </div>
  );
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
