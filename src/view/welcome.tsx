import React, { useState } from 'react';
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

type Props = { user?: t.User; welcome: t.WelcomeUIState; earlyAccessEmail?: string };

export default function Welcome(props: Props) {
  return props.earlyAccessEmail ? <WelcomeSessions {...props} /> : <WelcomeAskEarlyAccessEmail {...props} />;
}

function WelcomeAskEarlyAccessEmail(props: Props) {
  const [email, setEmail] = useState('');

  async function confirm() {
    await postMessage({ type: 'welcome/earlyAccessEmail', email });
  }

  async function keyDown(e: React.KeyboardEvent) {
    if (e.code === 'Enter') {
      await confirm();
    }
  }

  return (
    <Screen className="welcome-ask-early-access-email">
      <Section className="main-section">
        <Section.Body>
          <div className="heading-subsection subsection">
            <h1>CodeMic</h1>
          </div>
          <div className="fields-subsection subsection">
            <VSCodeTextField
              type="email"
              value={email}
              onInput={e => setEmail((e.target as HTMLInputElement).value)}
              onKeyDown={keyDown}
              placeholder="Example: sean@computing-den.com"
            >
              Early access email
            </VSCodeTextField>
            {props.welcome.error && <p className="text-error">{props.welcome.error}</p>}
          </div>
          <div className="buttons-subsection subsection">
            <VSCodeButton appearance="primary" onClick={confirm}>
              OK
            </VSCodeButton>
          </div>
        </Section.Body>
      </Section>
    </Screen>
  );
}

function WelcomeSessions(props: Props) {
  const { welcome } = props;

  function login(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    postMessage({ type: 'account/open' });
  }
  function join(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    postMessage({ type: 'account/open', join: true });
  }
  const recent = welcome.recent.filter(h => h.id !== welcome.current?.id);
  const featured = welcome.featured.filter(
    h => h.id !== welcome.current?.id && !welcome.recent.some(r => r.id === h.id),
  );
  return (
    <Screen className="welcome-sessions">
      {/*<LatencyTest store={this.props.store} />*/}
      <Section className="search-section">
        <Section.Body>
          <div className="search-subsection subsection">
            <VSCodeTextField placeholder="Search" autofocus></VSCodeTextField>
            <VSCodeButton onClick={() => postMessage({ type: 'recorder/open' })} title="Record a new session">
              <span className="codicon codicon-device-camera-video" />
            </VSCodeButton>
          </div>
          {!props.user && (
            <div className="signin-subsection subsection">
              <VSCodeLink href="#" onClick={login}>
                Log in
              </VSCodeLink>{' '}
              or{' '}
              <VSCodeLink href="#" onClick={join}>
                join
              </VSCodeLink>{' '}
              to publish your own CodeMics.
            </div>
          )}
        </Section.Body>
      </Section>
      {welcome.current && (
        <SessionsSection title="WORKSPACE" history={welcome.history} sessionHeads={[welcome.current]} />
      )}
      {recent.length > 0 && <SessionsSection title="RECENT" history={welcome.history} sessionHeads={recent} />}
      {featured.length > 0 && <SessionsSection title="FEATURED" history={welcome.history} sessionHeads={featured} />}
      {!welcome.current && recent.length === 0 && featured.length === 0 && (
        <div className="empty">NO SESSIONS FOUND</div>
      )}
    </Screen>
  );
}

type SessionsSectionProps = {
  title: string;
  sessionHeads: t.SessionHead[];
  history: t.SessionsHistory;
  bordered?: boolean;
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
          <SessionHeadList sessionHeads={this.props.sessionHeads} history={this.props.history} />
        </Section.Body>
      </Section>
    );
  }
}
