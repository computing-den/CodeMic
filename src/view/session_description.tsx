import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import TimeFromNow from './time_from_now.js';
import { cn } from './misc.js';
import TextToParagraphs from './text_to_paragraphs.jsx';
import { h, Fragment, Component } from 'preact';

export type Props = {
  className?: string;
  sessionHead: t.SessionHead;
};
export default class SessionDescription extends Component<Props> {
  render() {
    const { className, sessionHead: s } = this.props;

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
        <div className="body">
          <TextToParagraphs text={s.description} />
        </div>
      </div>
    );
  }
}
