import { h, Fragment, Component } from 'preact';
import { types as t, lib } from '@codecast/lib';
import * as actions from './actions';
import { updateStore } from './store';
import { JsxElement } from 'typescript';
import { EventEmitter } from 'vscode';
// import type { WebviewApi } from 'vscode-webview';
import _ from 'lodash';

type SectionProps = {
  className?: string;
  bordered?: boolean;
};

type HeaderProps = {
  title: string;
  collapsible?: boolean;
  buttons?: any[];
};

type ExitButtonProps = {
  onClick: () => void;
};

class ExitButton extends Component<ExitButtonProps> {
  render() {
    return (
      <vscode-button appearance="icon" title="Exit" onClick={this.props.onClick}>
        <span className="codicon codicon-close" />
      </vscode-button>
    );
  }
}

class Header extends Component<HeaderProps> {
  static ExitButton = ExitButton;
  render() {
    return (
      <div className={`header ${this.props.collapsible ? 'collapsible' : ''}`}>
        <span className="collapse-icon codicon codicon-chevron-down m-right_x-small va-top" />
        <h3>{this.props.title}</h3>
        {!_.isEmpty(this.props.buttons) && <div className="actions">{this.props.buttons}</div>}
      </div>
    );
  }
}

class Body extends Component {
  render() {
    return <div className="body">{this.props.children}</div>;
  }
}

export default class Section extends Component<SectionProps> {
  static Header = Header;
  static Body = Body;
  render() {
    return (
      <div className={`section ${this.props.bordered ? 'bordered' : ''} ${this.props.className || ''}`}>
        {this.props.children}
      </div>
    );
  }
}
