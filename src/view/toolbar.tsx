import React from 'react';
import { cn } from './misc.js';
import _ from 'lodash';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';

export type Action =
  | {
      title: string;
      onClick?: () => void;
      disabled?: boolean;
      icon?: string;
      label?: string;
      // popover?: { id: string; body: JSX.Element };
    }
  | { separator: 'line' };

export type ToolbarProps = { actions: Action[] };

export default class Toolbar extends React.Component<ToolbarProps> {
  ref: HTMLElement | null = null;
  handleRef = (ref: HTMLElement | null) => (this.ref = ref);

  // togglePopover = (i: number) => {
  // const popover = this.ref?.querySelectorAll()
  // if (popover) {
  //   if (popover.matches(':popover-open')) {
  //     popover.hidePopover();
  //   } else {
  //     popover.showPopover();
  //   }
  // }
  // };

  render() {
    return (
      <div className="toolbar" ref={this.handleRef}>
        {this.props.actions.map((a, i) =>
          'separator' in a ? (
            <div className="separator-line" />
          ) : (
            <VSCodeButton
              appearance="icon"
              title={a.title}
              // Setting popovertarget doesn't work because vscode-button doesn't pass it along
              // to the button element.
              // onClick={a.popover ? () => this.togglePopover(i) : a.onClick}
              onClick={a.onClick}
              disabled={Boolean(a.disabled)}
            >
              {a.icon && <span className={cn(a.icon)} />}
              {a.label}
            </VSCodeButton>
          ),
        )}
        {/*this.props.actions.map(
          (a, i) =>
            'popover' in a &&
            a.popover && (
              <div key={i} popover>
                {a.popover}
              </div>
            ),
            )*/}
      </div>
    );
  }
}
