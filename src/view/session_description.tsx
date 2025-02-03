import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import TimeFromNow from './time_from_now.js';
import { cn } from './misc.js';
import TextToParagraphs from './text_to_paragraphs.jsx';
import React from 'react';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react/index.js';

export type Props = {
  className?: string;
  user?: t.UserUI;
  head: t.SessionHead;
  publication?: t.SessionPublication;
  onLike: (value: boolean) => any;
};
export default function SessionDescription(props: Props) {
  const { className, head, publication, user, onLike } = props;
  const liked = user?.metadata?.likes.includes(head.id);

  return (
    <div className={cn('session-description', className)}>
      <div className="header">
        <span className="item timestamp">
          {publication?.publishTimestamp ? (
            <>
              published <TimeFromNow timestamp={publication.publishTimestamp} />
            </>
          ) : (
            <>
              edited <TimeFromNow timestamp={head.modificationTimestamp} />
            </>
          )}
        </span>
        <>
          <div className="item views">
            <span className="codicon codicon-eye with-vscode-button-padding" />
            <span className="count">{publication?.views ?? 0}</span>
          </div>
          <div className="item likes">
            <VSCodeButton appearance="icon" title="Like" onClick={() => onLike(!liked)} disabled={!publication}>
              <span className={cn('codicon', liked ? 'codicon-heart-filled' : 'codicon-heart')} />
            </VSCodeButton>
            <span className="count">{publication?.likes ?? 0}</span>
          </div>
        </>
      </div>
      <div className="body">
        <TextToParagraphs text={head.description} />
      </div>
    </div>
  );
}
