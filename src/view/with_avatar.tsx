import { cn } from './misc.js';
import { h, Fragment, Component } from 'preact';
import { getStore } from './store.js';

type Props = { className?: string; username?: string; small?: boolean };
export default class WithAvatar extends Component<Props> {
  render() {
    const { className, username, children, small } = this.props;
    return (
      <div className={cn('with-avatar', small && 'small', className)}>
        <div className="avatar">
          <img src={`${getStore().server}/avatars/${username}`} />
        </div>
        <div className="body">{children}</div>
      </div>
    );
  }
}
