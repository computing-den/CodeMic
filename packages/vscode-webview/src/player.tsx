import { h, Fragment, Component } from 'preact';
import { types as t, path, lib } from '@codecast/lib';
// import FakeMedia from './fake_media.jsx';
import ProgressBar from './progress_bar.jsx';
import PathField from './path_field.jsx';
import MediaToolbar, * as MT from './media_toolbar.jsx';
import { SessionSummary } from './session_summary.jsx';
import SessionDescription from './session_description.jsx';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage, { mediaApi } from './api.js';
import _ from 'lodash';

type Props = { player: t.PlayerState };
export default class Player extends Component<Props> {
  seeking = false;

  load = async () => {
    await postMessage({ type: 'player/load' });
  };

  play = async () => {
    await mediaApi.prepareAll();
    await postMessage({ type: 'player/play' });
  };

  pause = async () => {
    await postMessage({ type: 'player/pause' });
  };

  rootChanged = async (root: string) => {
    await postMessage({ type: 'player/update', changes: { root } });
  };

  seek = async (clock: number) => {
    if (!this.props.player.isLoaded) {
      console.error(`Cannot seek track that is not loaded`);
      return;
    }
    await postMessage({ type: 'player/seek', clock });
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
        sessionId: this.props.player.sessionSummary.id,
        fork: { clock: this.props.player.clock },
      });
    }
  };

  edit = async () => {
    const res = await postMessage({ type: 'confirmEditFromPlayer' });
    if (res.value) {
      await postMessage({ type: 'recorder/open', sessionId: this.props.player.sessionSummary.id });
    }
  };

  // isStoppedAlmostAtTheEnd(): boolean {
  //   return (
  //     this.props.player.state.status === t.TrackPlayerStatus.Stopped &&
  //     this.props.player.clock >= this.props.player.sessionSummary.duration - 0.5
  //   );
  // }

  componentDidUpdate() {
    mediaApi.loadOrDisposeAudioTracks(this.props.player.audioTracks, this.props.player.webviewUris);
  }

  componentDidMount() {
    console.log('Player componentDidMount');
    mediaApi.loadOrDisposeAudioTracks(this.props.player.audioTracks, this.props.player.webviewUris);
  }

  componentWillUnmount() {
    mediaApi.disposeAll();
  }

  render() {
    const { player } = this.props;
    const { sessionSummary: ss } = player;

    let primaryAction: MT.PrimaryAction;
    if (player.isPlaying) {
      primaryAction = { type: 'player/pause', title: 'Pause', onClick: this.pause };
    } else if (player.isLoaded) {
      primaryAction = { type: 'player/play', title: 'Play', onClick: this.play };
    } else {
      const title = player.root
        ? `Load the project into ${player.root}`
        : `Select a directory and load the project into it`;
      primaryAction = { type: 'player/load', title, onClick: this.load };
    }

    const toolbarActions = [
      {
        title: player.isPlaying
          ? `Fork: create a new project starting at this point`
          : `Fork: create a new project starting at ${lib.formatTimeSeconds(player.clock)}`,
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
        icon: 'codicon-heart',
        onClick: () => {
          console.log('TODO');
        },
      },
    ];

    return (
      <Screen className="player">
        {player.isLoaded && <ProgressBar duration={ss.duration} onSeek={this.seek} clock={player.clock} />}
        <Section className="main-section">
          {/*
          <Section.Header
            title="PLAYER"
            buttons={[<Section.Header.ExitButton onClick={this.props.onExit} />]}
            collapsible
          />
            */}
          <Section.Body>
            <SessionSummary className="subsection subsection_spaced" sessionSummary={ss} withAuthor />
            <MediaToolbar
              className="subsection subsection_spaced"
              primaryAction={primaryAction}
              actions={toolbarActions}
              clock={player.clock}
              duration={ss.duration}
            />
            <SessionDescription className="subsection subsection_spaced" sessionSummary={ss} />
            {!player.isLoaded && (
              <PathField
                className="subsection"
                onChange={this.rootChanged}
                value={player.root}
                label="Workspace"
                pickTitle="Select workspace folder"
                autoFocus
              />
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
