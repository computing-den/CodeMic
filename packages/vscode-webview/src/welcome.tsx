import { h, Fragment, Component } from 'preact';
import { types as t, lib } from '@codecast/lib';
import Screen from './screen.jsx';
import Section from './section.jsx';
import TimeFromNow from './time_from_now.js';
import * as actions from './actions';
import _ from 'lodash';

type Props = { store: t.Store; onExit: () => void };
export default class Welcome extends Component<Props> {
  // openPlayer = async (uri?: t.Uri) => {
  //   await actions.openPlayer(uri);
  // };

  componentDidMount() {}

  render() {
    const { workspace, featured, history } = this.props.store.welcome;
    return (
      <Screen className="welcome">
        <Section className="search-section">
          <Section.Body>
            <vscode-text-field placeholder="Search" autofocus></vscode-text-field>
            <vscode-button onClick={() => actions.openRecorder()} title="Record a new session">
              <span className="codicon codicon-device-camera-video" />
            </vscode-button>
          </Section.Body>
        </Section>
        <SessionsSection title="WORKSPACE" history={history} sessions={workspace} />
        <SessionsSection title="FEATURED" history={history} sessions={featured} />
      </Screen>
    );

    // return (
    //   <div className="screen welcome">
    //     <div className="section">
    //       <h2>Start</h2>
    //       <ul className="unstyled">
    //         <li>
    //           <vscode-link href="#" onClick={this.openRecorder}>
    //             <span className="codicon codicon-device-camera-video va-top m-right" />
    //             Record new session
    //           </vscode-link>
    //         </li>
    //         <li>
    //           <vscode-link href="#" onClick={() => this.openPlayer()}>
    //             <span className="codicon codicon-folder-opened va-top m-right" />
    //             Open session
    //           </vscode-link>
    //         </li>
    //       </ul>
    //     </div>
    //     <div className="section recent">
    //       <h2>Recent</h2>
    //       <ul className="unstyled">
    //         {recentFiles.map(({ name, dir, uri }) => (
    //           <li>
    //             <vscode-link href="#" onClick={() => this.openPlayer(uri)}>
    //               {name}
    //             </vscode-link>
    //             {dir}
    //           </li>
    //         ))}
    //       </ul>
    //     </div>
    //   </div>
    // );
  }
}

type SessionsSectionProps = {
  title: string;
  sessions: t.SessionSummaryMap;
  history: t.SessionHistory;
  bordered?: boolean;
};

type SessionAndHistory = { session: t.SessionSummary; history?: t.SessionHistoryItem }[];

class SessionsSection extends Component<SessionsSectionProps> {
  render() {
    let sessionAndHistory: SessionAndHistory = _.map(this.props.sessions, session => ({
      session,
      history: this.props.history[session.id],
    }));
    sessionAndHistory = _.orderBy(
      sessionAndHistory,
      [({ history }) => (history && lib.getSessionHistoryItemLastOpenTimestamp(history)) || ''],
      ['desc'],
    );

    return (
      <Section className="sessions-section" bordered={this.props.bordered}>
        <Section.Header title={this.props.title} collapsible />
        <Section.Body>
          {sessionAndHistory.map(({ session, history }) => (
            <SessionItem history={history} session={session} />
          ))}
        </Section.Body>
      </Section>
    );
  }
}

type SessionItemProps = {
  session: t.SessionSummary;
  history?: t.SessionHistoryItem;
};

class SessionItem extends Component<SessionItemProps> {
  openPlayer = (e: Event) => {
    e.stopPropagation();
    actions.openPlayer(this.props.session.id);
  };
  editSession = (e: Event) => {
    e.stopPropagation();
    actions.openRecorder(this.props.session.id);
  };
  forkSession = (e: Event) => {
    e.stopPropagation();
    actions.openRecorder(this.props.session.id, true);
  };
  render() {
    const { session, history } = this.props;

    const lastOpenedTimestamp = history && lib.getSessionHistoryItemLastOpenTimestamp(history);

    return (
      <div className="card card-bare card-with-media has-hover-actions session-item" onClick={this.openPlayer}>
        <div className="media">
          <img src={session.author.avatar} />
        </div>
        <div className="card-content">
          <div className="title">{session.title || 'Untitled'}</div>
          <div className="description">{session.description || 'No Description'}</div>
          <div className="footer">
            <span className="footer-item timestamp">
              {lastOpenedTimestamp ? (
                <span>
                  Last opened <TimeFromNow timestamp={lastOpenedTimestamp} />
                </span>
              ) : (
                <TimeFromNow timestamp={session.timestamp} capitalize />
              )}
            </span>
          </div>
          <div className="footer">
            <span className="footer-item author">{session.author.name}</span>
            <div className="footer-item badge">
              <span className="codicon codicon-eye va-top m-right_small" />
              <span className="count">{session.views}</span>
            </div>
            <div className="footer-item badge">
              <span className="codicon codicon-heart va-top m-right_small" />
              <span className="count">{session.likes}</span>
            </div>
          </div>
          <div className="hover-actions">
            <vscode-button appearance="icon" title="Play" onClick={this.openPlayer}>
              <span className="codicon codicon-play" />
            </vscode-button>
            <vscode-button
              appearance="icon"
              title="Fork: create a new session based on this one"
              onClick={this.forkSession}
            >
              <span className="codicon codicon-repo-forked" />
            </vscode-button>
            <vscode-button
              appearance="icon"
              title="Edit: continue recording and editing this session"
              onClick={this.editSession}
            >
              <span className="codicon codicon-edit" />
            </vscode-button>
            <vscode-button appearance="icon" title="Delete this session">
              <span className="codicon codicon-close" />
            </vscode-button>
          </div>
        </div>
      </div>
    );
  }
}
