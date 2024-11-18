import { cn } from './misc.js';
import React from 'react';
import { getStore } from './store.js';

type Props = { className?: string; username?: string; small?: boolean; children: React.ReactNode };
export default class WithAvatar extends React.Component<Props> {
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
