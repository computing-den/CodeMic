import React from 'react';
import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import { SessionHeadList } from './session_head.jsx';
import Screen from './screen.jsx';
// import LoginBanner from './login_banner.jsx';
import Section from './section.jsx';
// import LatencyTest from './latency_test.jsx';
import postMessage from './api.js';
import _ from 'lodash';
import { VSCodeButton, VSCodeLink, VSCodeTextField } from '@vscode/webview-ui-toolkit/react';

type Props = { user?: t.User; welcome: t.WelcomeUIState };
export default class Welcome extends React.Component<Props> {
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

  render() {
    const { welcome } = this.props;
    return (
      <Screen className="welcome">
        {/*<LatencyTest store={this.props.store} />*/}
        <Section className="search-section">
          <Section.Body>
            <div className="search-subsection subsection">
              <VSCodeTextField placeholder="Search" autofocus></VSCodeTextField>
              <VSCodeButton onClick={() => postMessage({ type: 'recorder/open' })} title="Record a new session">
                <span className="codicon codicon-device-camera-video" />
              </VSCodeButton>
            </div>
            {!this.props.user && (
              <div className="signin-subsection subsection">
                <VSCodeLink href="#" onClick={this.login}>
                  Log in
                </VSCodeLink>{' '}
                or{' '}
                <VSCodeLink href="#" onClick={this.join}>
                  join
                </VSCodeLink>{' '}
                to publish your own CodeMics.
              </div>
            )}
          </Section.Body>
        </Section>
        <SessionsSection
          title="WORKSPACE"
          history={welcome.history}
          sessionHeads={welcome.workspace}
          coverPhotosUris={welcome.coverPhotosUris}
        />
        <SessionsSection
          title="FEATURED"
          history={welcome.history}
          sessionHeads={welcome.featured}
          coverPhotosUris={welcome.coverPhotosUris}
        />
      </Screen>
    );
  }
}

type SessionsSectionProps = {
  title: string;
  sessionHeads: t.SessionHead[];
  history: t.SessionsHistory;
  bordered?: boolean;
  coverPhotosUris: t.UriMap;
};

type SessionAndHistory = { sessionHead: t.SessionHead; history?: t.SessionHistory };

class SessionsSection extends React.Component<SessionsSectionProps> {
  render() {
    let sh: SessionAndHistory[] = _.map(this.props.sessionHeads, s => ({
      sessionHead: s,
      history: this.props.history[s.id],
    }));
    const iteratee = ({ history }: SessionAndHistory) =>
      (history && lib.getSessionHistoryItemLastOpenTimestamp(history)) || '';
    sh = _.orderBy(sh, iteratee, 'desc');

    return (
      <Section className="sessions-section" bordered={this.props.bordered}>
        <Section.Header title={this.props.title} collapsible />
        <Section.Body>
          <SessionHeadList
            sessionHeads={this.props.sessionHeads}
            history={this.props.history}
            coverPhotosUris={this.props.coverPhotosUris}
          />
        </Section.Body>
      </Section>
    );
  }
}
