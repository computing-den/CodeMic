import React, { useEffect, useState } from 'react';
import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import { SessionListings } from './session_head.jsx';
import Screen from './screen.jsx';
// import LoginBanner from './login_banner.jsx';
import Section from './section.jsx';
// import LatencyTest from './latency_test.jsx';
import postMessage from './api.js';
import _ from 'lodash';
import { VSCodeButton, VSCodeLink, VSCodeTextField } from '@vscode/webview-ui-toolkit/react';

type Props = { user?: t.UserUI; welcome: t.WelcomeUIState; earlyAccessEmail?: string };

export default function Welcome(props: Props) {
  return props.earlyAccessEmail || props.user ? (
    <WelcomeSessions {...props} />
  ) : (
    <WelcomeAskEarlyAccessEmail {...props} />
  );
}

function WelcomeAskEarlyAccessEmail(props: Props) {
  const [email, setEmail] = useState('');

  async function confirm() {
    await postMessage({ type: 'welcome/earlyAccessEmail', email });
  }

  async function keyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
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
              placeholder="name@example.com"
              autoFocus
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
          <div className="more-info-subsection subsection">
            Visit{' '}
            <a className="unstyled" href="https://CodeMic.io">
              CodeMic.io
            </a>{' '}
            for more info
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
  const current = welcome.sessions.find(s => s.group === 'current');
  const recent = welcome.sessions.filter(s => s.group === 'recent' && s.head.id !== current?.head.id);
  const featured = welcome.sessions.filter(
    s => s.group === 'remote' && s.head.id !== current?.head.id && !recent.some(r => r.head.id === s.head.id),
  );
  const empty = !current && recent.length === 0 && featured.length === 0;

  return (
    <Screen className="welcome-sessions">
      {/*<LatencyTest store={this.props.store} />*/}
      <Section className="search-section">
        <Section.Body>
          <div className="search-subsection subsection">
            <VSCodeTextField placeholder="Search" autofocus></VSCodeTextField>
            <VSCodeButton
              onClick={() => postMessage({ type: 'welcome/openNewSessionInRecorder' })}
              title="Record a new session"
            >
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
              to publish your own sessions.
            </div>
          )}
        </Section.Body>
      </Section>
      <SessionsSection user={props.user} title="WORKSPACE" listings={_.compact([current])} />
      {recent.length > 0 && <SessionsSection user={props.user} title="RECENT" listings={recent} />}
      <SessionsSection user={props.user} title="FEATURED" listings={featured} loading={welcome.loadingFeatured} />
    </Screen>
  );
}

type SessionsSectionProps = {
  user?: t.UserUI;
  title: string;
  listings: t.SessionUIListing[];
  bordered?: boolean;
  loading?: boolean;
};

function SessionsSection(props: SessionsSectionProps) {
  const clicked = (sessionId: string) => postMessage({ type: 'welcome/openSessionInPlayer', sessionId });
  const del = (sessionId: string) => postMessage({ type: 'welcome/deleteSession', sessionId });
  const edit = (sessionId: string) => postMessage({ type: 'welcome/openSessionInRecorder', sessionId });
  const like = (sessionId: string, value: boolean) => postMessage({ type: 'welcome/likeSession', sessionId, value });
  return (
    <Section className="sessions-section" bordered={props.bordered}>
      <Section.Header title={props.title} loading={props.loading} collapsible />
      <Section.Body>
        {props.listings.length > 0 && (
          <SessionListings
            user={props.user}
            listings={props.listings}
            onClick={clicked}
            onDelete={del}
            onEdit={edit}
            onLike={like}
          />
        )}
        {props.listings.length === 0 && !props.loading && <Section.Message>Empty</Section.Message>}
      </Section.Body>
    </Section>
  );
}
