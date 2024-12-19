import React from 'react';
import * as t from '../lib/types.js';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage from './api.js';
import _ from 'lodash';
import moment from 'moment';
import { VSCodeButton, VSCodeLink, VSCodeTextField } from '@vscode/webview-ui-toolkit/react';

type Props = { user?: t.User; account: t.AccountUIState };
export default class Account extends React.Component<Props> {
  fieldChanged = async (field: keyof t.AccountUpdate, value: any) => {
    await postMessage({ type: 'account/update', changes: { [field]: value } });
  };
  credentialsChanged = async (field: keyof t.Credentials, value: any) => {
    const credentials = { ...this.props.account.credentials, [field]: value };
    await postMessage({ type: 'account/update', changes: { credentials } });
  };
  emailChanged = (e: Event | React.FormEvent<HTMLElement>) =>
    this.credentialsChanged('email', (e.target as HTMLInputElement).value);
  usernameChanged = (e: Event | React.FormEvent<HTMLElement>) =>
    this.credentialsChanged('username', (e.target as HTMLInputElement).value);
  passwordChanged = (e: Event | React.FormEvent<HTMLElement>) =>
    this.credentialsChanged('password', (e.target as HTMLInputElement).value);
  login = async () => {
    await postMessage({ type: 'account/login' });
  };
  logout = async () => {
    await postMessage({ type: 'account/logout' });
  };
  join = async () => {
    if (!this.props.account.join) {
      await this.fieldChanged('join', true);
      return;
    }
    await postMessage({ type: 'account/join' });
  };

  keyDown = async (e: React.KeyboardEvent) => {
    if (e.code === 'Enter') {
      if (this.props.account.join) {
        await this.join();
      } else {
        await this.login();
      }
    }
  };

  render() {
    const { user, account } = this.props;
    const { credentials, join, error } = account;

    const wrap = (body: JSX.Element) => (
      <Screen className="account">
        <Section className="main-section">
          <Section.Body>
            <div className="heading-subsection subsection">
              <h1>CodeMic</h1>
            </div>
            {body}
          </Section.Body>
        </Section>
      </Screen>
    );

    if (user) {
      return wrap(
        <div className="user-subsection subsection">
          <p>
            Logged in as <b>{user.username}.</b>
          </p>
          <p>Joined on {moment(user.joinTimestamp).format('DD MMM YYYY')}.</p>
          <p>
            <VSCodeLink href="#" onClick={this.logout}>
              Log out
            </VSCodeLink>
          </p>
        </div>,
      );
    }

    return wrap(
      <>
        <div className="fields-subsection subsection">
          <VSCodeTextField
            value={credentials.username}
            onInput={this.usernameChanged}
            onKeyDown={this.keyDown}
            placeholder="Example: sean_shirazi"
            autoFocus
          >
            Username
          </VSCodeTextField>
          <VSCodeTextField
            value={credentials.password}
            onInput={this.passwordChanged}
            onKeyDown={this.keyDown}
            type="password"
            placeholder="At least 8 characters"
          >
            Password
          </VSCodeTextField>
          {join && (
            <VSCodeTextField
              value={credentials.email}
              onInput={this.emailChanged}
              onKeyDown={this.keyDown}
              placeholder="Example: sean@computing-den.com"
            >
              Email
            </VSCodeTextField>
          )}
          {error && <p className="text-error">{error}</p>}
        </div>
        <div className="buttons-subsection subsection">
          <VSCodeButton appearance={join ? 'primary' : 'secondary'} onClick={this.join}>
            Join
          </VSCodeButton>
          <VSCodeButton appearance={join ? 'secondary' : 'primary'} onClick={this.login}>
            Log in
          </VSCodeButton>
        </div>
      </>,
    );
  }
}
