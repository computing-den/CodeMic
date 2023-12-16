import { h, Fragment, Component } from 'preact';
import { types as t, lib } from '@codecast/lib';
import Screen from './screen.jsx';
import Section from './section.jsx';
import postMessage from './api.js';
import _ from 'lodash';

type Props = { user?: t.User; account: t.AccountState };
export default class Account extends Component<Props> {
  fieldChanged = async (field: keyof t.AccountUpdate, value: any) => {
    await postMessage({ type: 'account/update', changes: { [field]: value } });
  };
  emailChanged = (e: InputEvent) => this.fieldChanged('email', (e.target as HTMLInputElement).value);
  usernameChanged = (e: InputEvent) => this.fieldChanged('username', (e.target as HTMLInputElement).value);
  passwordChanged = (e: InputEvent) => this.fieldChanged('password', (e.target as HTMLInputElement).value);
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

  keyDown = async (e: KeyboardEvent) => {
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
    const { email, username, password, join, error } = account;

    const wrap = (body: h.JSX.Element) => (
      <Screen className="account">
        <Section className="main-section">
          <Section.Body>
            <div className="heading-subsection subsection">
              <h1>CodeCast</h1>
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
            Logged in as <b>{user.username}</b>
          </p>
          <p>
            <vscode-link href="#" onClick={this.logout}>
              Log out
            </vscode-link>
          </p>
        </div>,
      );
    }

    return wrap(
      <>
        <div className="fields-subsection subsection">
          <vscode-text-field
            value={username}
            onInput={this.usernameChanged}
            onKeyDown={this.keyDown}
            placeholder="Example: sean_shirazi"
            autoFocus
          >
            Username
          </vscode-text-field>
          <vscode-text-field
            value={password}
            onInput={this.passwordChanged}
            onKeyDown={this.keyDown}
            type="password"
            placeholder="At least 8 characters"
          >
            Password
          </vscode-text-field>
          {join && (
            <vscode-text-field
              value={email}
              onInput={this.emailChanged}
              onKeyDown={this.keyDown}
              placeholder="Example: sean@computing-den.com"
            >
              Email
            </vscode-text-field>
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="buttons-subsection subsection">
          <vscode-button appearance={join ? 'primary' : 'secondary'} onClick={this.join}>
            Join
          </vscode-button>
          <vscode-button appearance={join ? 'secondary' : 'primary'} onClick={this.login}>
            Log in
          </vscode-button>
        </div>
      </>,
    );
  }
}
