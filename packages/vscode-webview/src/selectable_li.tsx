import { cn } from './misc.js';
import { h, Fragment, Component } from 'preact';

export type Action = { icon: string; title: string; onClick: () => unknown };
export type Props = { className?: string; actions?: Action[]; onClick: () => unknown };
export default class SelectableLi extends Component<Props> {
  clicked = (e: Event, a: Action) => {
    e.preventDefault();
    e.stopPropagation();
    a.onClick?.();
  };

  render() {
    return (
      <li className={cn('selectable-li', this.props.className)} tabIndex={0} onClick={this.props.onClick}>
        {this.props.children}
        <div className="actions">
          {this.props.actions?.map(a => (
            <vscode-button appearance="icon" title={a.title} onClick={(e: Event) => this.clicked(e, a)}>
              <span className={`codicon ${a.icon}`} />
            </vscode-button>
          ))}
        </div>
      </li>
    );
  }
}
