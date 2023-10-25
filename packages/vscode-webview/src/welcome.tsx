import { h, Fragment, Component } from 'preact';
import { types as t, lib } from '@codecast/lib';
import { SessionSummaryList } from './session_summary.jsx';
import Screen from './screen.jsx';
import Section from './section.jsx';
// import LatencyTest from './latency_test.jsx';
import postMessage from './api.js';
import _ from 'lodash';

type Props = { welcome: t.WelcomeState };
export default class Welcome extends Component<Props> {
  render() {
    const { welcome } = this.props;
    return (
      <Screen className="welcome">
        {/*<LatencyTest store={this.props.store} />*/}
        <Section className="search-section">
          <Section.Body>
            <div className="search-subsection subsection">
              <vscode-text-field placeholder="Search" autofocus></vscode-text-field>
              <vscode-button onClick={() => postMessage({ type: 'recorder/open' })} title="Record a new session">
                <span className="codicon codicon-device-camera-video" />
              </vscode-button>
            </div>
          </Section.Body>
        </Section>
        <SessionsSection title="WORKSPACE" history={welcome.history} sessionSummaries={welcome.workspace} />
        <SessionsSection title="FEATURED" history={welcome.history} sessionSummaries={welcome.featured} />
      </Screen>
    );
  }
}

type SessionsSectionProps = {
  title: string;
  sessionSummaries: t.SessionSummaryMap;
  history: t.SessionHistory;
  bordered?: boolean;
};

type SessionAndHistory = { sessionSummary: t.SessionSummary; history?: t.SessionHistoryItem };

class SessionsSection extends Component<SessionsSectionProps> {
  render() {
    let sh: SessionAndHistory[] = _.map(this.props.sessionSummaries, s => ({
      sessionSummary: s,
      history: this.props.history[s.id],
    }));
    const iteratee = ({ history }: SessionAndHistory) =>
      (history && lib.getSessionHistoryItemLastOpenTimestamp(history)) || '';
    sh = _.orderBy(sh, iteratee, 'desc');

    return (
      <Section className="sessions-section" bordered={this.props.bordered}>
        <Section.Header title={this.props.title} collapsible />
        <Section.Body>
          <SessionSummaryList sessionSummaries={this.props.sessionSummaries} history={this.props.history} />
        </Section.Body>
      </Section>
    );
  }
}
