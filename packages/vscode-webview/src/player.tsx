import { h, Fragment, Component } from 'preact';
import { types as t, path, lib } from '@codecast/lib';
// import FakeMedia from './fake_media.jsx';
import Media from './media.jsx';
import ProgressBar from './progress_bar.jsx';
import PathField from './path_field.jsx';
import MediaToolbar, * as MT from './media_toolbar.jsx';
import { SessionSummary } from './session_summary.jsx';
import SessionDescription from './session_description.jsx';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage from './api.js';
import _ from 'lodash';

type Props = { player: t.PlayerState };
export default class Player extends Component<Props> {
  // media = new Media();
  seeking = false;

  startPlayer = async () => {
    if (this.props.player.status === t.PlayerStatus.Uninitialized) {
      if (this.props.player.root) {
        await postMessage({ type: 'play' });
      } else {
        // TODO show error to user
        console.error('Select a workspace folder');
      }
    } else {
      if (this.isStoppedAlmostAtTheEnd()) await this.seek(0);
      await postMessage({ type: 'play' });
    }
  };

  pausePlayer = async () => {
    await postMessage({ type: 'pausePlayer' });
  };

  rootChanged = async (root: string) => {
    await postMessage({ type: 'updatePlayer', changes: { root } });
  };

  seek = async (clock: number) => {
    if (this.props.player.status === t.PlayerStatus.Uninitialized) {
      console.error('Workspace not populated yet');
      return;
    }
    await postMessage({ type: 'seekPlayer', clock });
  };

  tocItemClicked = async (e: Event, item: t.TocItem) => {
    e.preventDefault();
    await this.seek(item.clock);
  };

  fork = async () => {
    const res = await postMessage({ type: 'confirmForkFromPlayer', clock: this.props.player.clock });
    if (res.value) {
      await postMessage({
        type: 'openRecorder',
        sessionId: this.props.player.sessionSummary.id,
        fork: true,
        forkClock: this.props.player.clock,
      });
    }
  };

  edit = async () => {
    const res = await postMessage({ type: 'confirmEditFromPlayer' });
    if (res.value) {
      await postMessage({ type: 'openRecorder', sessionId: this.props.player.sessionSummary.id });
    }
  };

  isStoppedAlmostAtTheEnd(): boolean {
    return (
      this.props.player.status === t.PlayerStatus.Stopped &&
      this.props.player.clock >= this.props.player.sessionSummary.duration - 0.5
    );
  }

  componentWillUnmount() {
    // this.media!.stop();
  }

  render() {
    const { player } = this.props;
    const { sessionSummary: ss } = player;

    let primaryAction: MT.PrimaryAction;
    if (player.status === t.PlayerStatus.Playing) {
      primaryAction = { type: 'pausePlaying', title: 'Pause', onClick: this.pausePlayer };
    } else {
      primaryAction = { type: 'play', title: 'Play', onClick: this.startPlayer };
    }

    const toolbarActions = [
      {
        title:
          player.status === t.PlayerStatus.Playing
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
        <audio id="audio"></audio>
        {player.status !== t.PlayerStatus.Uninitialized && (
          <ProgressBar duration={ss.duration} onSeek={this.seek} clock={player.clock} />
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
            <SessionSummary className="subsection subsection_spaced" sessionSummary={ss} withAuthor />
            <MediaToolbar
              className="subsection subsection_spaced"
              primaryAction={primaryAction}
              actions={toolbarActions}
              clock={player.clock}
              duration={ss.duration}
            />
            <SessionDescription className="subsection subsection_spaced" sessionSummary={ss} />
            {player.status === t.PlayerStatus.Uninitialized && (
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
      </Screen>
    );
  }
}
