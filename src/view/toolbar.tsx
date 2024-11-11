import { h, Fragment, Component } from 'preact';
import { cn } from './misc.js';
import _ from 'lodash';

export type Action = {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  icon: string;
};

export type ToolbarProps = { actions: Action[] };

export default class Toolbar extends Component<ToolbarProps> {
  render() {
    return (
      <div className="toolbar">
        {this.props.actions.map(a => (
          <vscode-button appearance="icon" title={a.title} onClick={a.onClick} disabled={Boolean(a.disabled)}>
            <span className={cn('codicon', a.icon)} />
          </vscode-button>
        ))}
      </div>
    );
  }
}
