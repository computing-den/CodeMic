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
import { Link } from '@vscode/webview-ui-toolkit';
import { cn } from './misc.js';

type Props = { user?: t.UserUI; welcome: t.WelcomeUIState; earlyAccessEmail?: string };

export default function Welcome(props: Props) {
  return <WelcomeSessions {...props} />;
  // return props.earlyAccessEmail || props.user ? (
  //   <WelcomeSessions {...props} />
  // ) : (
  //   <WelcomeAskEarlyAccessEmail {...props} />
  // );
}

// function WelcomeAskEarlyAccessEmail(props: Props) {
//   const [email, setEmail] = useState('');

//   async function confirm() {
//     await postMessage({ type: 'welcome/earlyAccessEmail', email });
//   }

//   async function keyDown(e: React.KeyboardEvent) {
//     if (e.key === 'Enter') {
//       await confirm();
//     }
//   }

//   return (
//     <Screen className="welcome-ask-early-access-email">
//       <Section className="main-section">
//         <Section.Body>
//           <div className="heading-subsection subsection">
//             <h1>CodeMic</h1>
//           </div>
//           <div className="fields-subsection subsection">
//             <VSCodeTextField
//               type="email"
//               value={email}
//               onInput={e => setEmail((e.target as HTMLInputElement).value)}
//               onKeyDown={keyDown}
//               placeholder="name@example.com"
//               autoFocus
//             >
//               Early access email
//             </VSCodeTextField>
//             {props.welcome.error && <p className="text-error">{props.welcome.error}</p>}
//           </div>
//           <div className="buttons-subsection subsection">
//             <VSCodeButton appearance="primary" onClick={confirm}>
//               OK
//             </VSCodeButton>
//           </div>
//           <div className="more-info-subsection subsection">
//             Visit{' '}
//             <a className="unstyled" href="https://CodeMic.io">
//               CodeMic.io
//             </a>{' '}
//             for more info
//           </div>
//         </Section.Body>
//       </Section>
//     </Screen>
//   );
// }

function WelcomeSessions(props: Props) {
  const { welcome } = props;
  const [atTop, setAtTop] = useState(true);

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
  function search(e: Event | React.FormEvent<HTMLElement>) {
    postMessage({ type: 'welcome/search', searchQuery: (e.target as HTMLInputElement).value });
  }
  const current = welcome.sessions.find(s => s.group === 'current');
  const recent = welcome.sessions.filter(s => s.group === 'recent' && s.head.id !== current?.head.id);
  const featured = welcome.sessions.filter(
    s => s.group === 'remote' && s.head.id !== current?.head.id && !recent.some(r => r.head.id === s.head.id),
  );

  useEffect(() => {
    function scrolled() {
      setAtTop(!document.scrollingElement?.scrollTop);
    }

    scrolled();
    window.addEventListener('scroll', scrolled);
    return () => window.removeEventListener('scroll', scrolled);
  }, []);

  return (
    <Screen className="welcome-sessions">
      {/*<LatencyTest store={this.props.store} />*/}
      <div className={cn('search-header', atTop && 'at-top')}>
        <VSCodeTextField placeholder="Search" autofocus value={welcome.searchQuery} onInput={search}></VSCodeTextField>
        <VSCodeButton
          onClick={() => postMessage({ type: 'welcome/openWorkspace' })}
          title="Open session"
          appearance="secondary"
        >
          <span className="codicon codicon-folder-opened" />
        </VSCodeButton>
        <VSCodeButton
          onClick={() => postMessage({ type: 'welcome/openNewSessionInRecorder' })}
          title="Record a new session"
        >
          <span className="codicon codicon-device-camera-video" />
        </VSCodeButton>
      </div>
      {!props.user && (
        <div className="signin">
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
      <SessionsSection
        user={props.user}
        title="WORKSPACE"
        listings={_.compact([current])}
        emptyMessage="No session found in workspace"
      />
      {recent.length > 0 && <SessionsSection user={props.user} title="RECENT" listings={recent} />}
      <SessionsSection
        user={props.user}
        title="FEATURED"
        listings={featured}
        loading={welcome.loadingFeatured}
        emptyMessage="Could not fetch featured sessions"
      />
    </Screen>
  );
}

type SessionsSectionProps = {
  user?: t.UserUI;
  title: string;
  emptyMessage?: string;
  listings: t.SessionUIListing[];
  bordered?: boolean;
  loading?: boolean;
};

function SessionsSection(props: SessionsSectionProps) {
  const clicked = (sessionId: string) => postMessage({ type: 'welcome/openSessionInPlayer', sessionId });
  const del = (sessionId: string) => postMessage({ type: 'welcome/deleteSession', sessionId });
  const edit = (sessionId: string) => postMessage({ type: 'welcome/openSessionInRecorder', sessionId });
  const like = (sessionId: string, value: boolean) => postMessage({ type: 'welcome/likeSession', sessionId, value });
  const share = (sessionId: string, sessionHandle: string, sessionAuthor?: string) =>
    postMessage({ type: 'copySessionLink', sessionId, sessionHandle, sessionAuthor });
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
            onShare={share}
          />
        )}
        {props.listings.length === 0 && !props.loading && props.emptyMessage && (
          <Section.Messages>
            <p>{props.emptyMessage}</p>
            {/*
            <VSCodeButton
              appearance="secondary"
              onClick={() => postMessage({ type: 'welcome/openWorkspace' })}
              title="Pick a workspace with a session"
            >
              Open session
              </VSCodeButton>*/}
          </Section.Messages>
        )}
      </Section.Body>
    </Section>
  );
}
