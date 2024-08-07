import { types as t, lib } from '@codecast/lib';
import TimeFromNow from './time_from_now.js';
import { cn } from './misc.js';
import { h, Fragment, Component } from 'preact';

export type Props = {
  className?: string;
  sessionSummary: t.SessionSummary;
};
export default class SessionDescription extends Component<Props> {
  render() {
    const { className, sessionSummary: s } = this.props;

    return (
      <div className={cn('session-description', className)}>
        <div className="header">
          <span className="item timestamp">
            <TimeFromNow timestamp={s.publishTimestamp ?? s.modificationTimestamp} capitalize />
          </span>
          <div className="item views">
            <span className="codicon codicon-eye va-top m-right_small" />
            <span className="count">{s.views}</span>
          </div>
          <div className="item likes">
            <span className="codicon codicon-heart-filled va-top m-right_small" />
            <span className="count">{s.likes}</span>
          </div>
        </div>
        <div className="body">{s.description}</div>
      </div>
    );
  }
}
