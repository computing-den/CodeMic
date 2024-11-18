import React from 'react';
import { cn } from './misc.js';
import _ from 'lodash';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';

type SectionProps = {
  className?: string;
  bordered?: boolean;
  children: React.ReactNode;
};

type HeaderProps = {
  title: string;
  collapsible?: boolean;
  buttons?: any[];
};

type ExitButtonProps = {
  onClick: () => void;
};

class ExitButton extends React.Component<ExitButtonProps> {
  render() {
    return (
      <VSCodeButton appearance="icon" title="Exit" onClick={this.props.onClick}>
        <span className="codicon codicon-close" />
      </VSCodeButton>
    );
  }
}

class Header extends React.Component<HeaderProps> {
  static ExitButton = ExitButton;
  render() {
    return (
      <div className={`section-header ${this.props.collapsible ? 'collapsible' : ''}`}>
        <span className="collapse-icon codicon codicon-chevron-down m-right_x-small va-top" />
        <h3>{this.props.title}</h3>
        {!_.isEmpty(this.props.buttons) && <div className="actions">{this.props.buttons}</div>}
      </div>
    );
  }
}

export type BodyProps = {
  className?: string;
  children: React.ReactNode;
  // padded?: boolean;
  // horPadded?: boolean;
  // topPadded?: boolean;
  // topPaddedSmall?: boolean;
};

export class Body extends React.Component<BodyProps> {
  render() {
    return (
      <div
        className={cn(
          'section-body',
          // this.props.padded && 'section-body_padded',
          // this.props.horPadded && 'section-body_hor-padded',
          // this.props.topPadded && 'section-body_top-padded',
          // this.props.topPaddedSmall && 'section-body_top-padded_small',
          this.props.className,
        )}
      >
        {this.props.children}
      </div>
    );
  }
}

export default class Section extends React.Component<SectionProps> {
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
