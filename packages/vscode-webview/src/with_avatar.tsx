import { cn } from './misc.js';
import { h, Fragment, Component } from 'preact';

type Props = { className?: string; src: string };
export default class WithAvatar extends Component<Props> {
  render() {
    return (
      <div className={cn('with-avatar', this.props.className)}>
        <div className="avatar">
          <img src={this.props.src} />
        </div>
        <div className="body">{this.props.children}</div>
      </div>
    );
  }
}
