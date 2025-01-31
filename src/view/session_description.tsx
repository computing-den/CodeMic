import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import TimeFromNow from './time_from_now.js';
import { cn } from './misc.js';
import TextToParagraphs from './text_to_paragraphs.jsx';
import React from 'react';

export type Props = {
  className?: string;
  head: t.SessionHead;
  publication?: t.SessionPublication;
};
export default class SessionDescription extends React.Component<Props> {
  render() {
    const { className, head, publication } = this.props;

    return (
      <div className={cn('session-description', className)}>
        <div className="header">
          <span className="item timestamp">
            <TimeFromNow timestamp={publication?.publishTimestamp ?? head.modificationTimestamp} capitalize />
          </span>
          {publication && (
            <>
              <div className="item views">
                <span className="codicon codicon-eye va-top m-right_small" />
                <span className="count">{publication.views}</span>
              </div>
              <div className="item likes">
                <span className="codicon codicon-heart-filled va-top m-right_small" />
                <span className="count">{publication.likes}</span>
              </div>
            </>
          )}
        </div>
        <div className="body">
          <TextToParagraphs text={head.description} />
        </div>
      </div>
    );
  }
}
