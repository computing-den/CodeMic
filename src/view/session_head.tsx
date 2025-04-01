import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import TimeFromNow from './time_from_now.jsx';
import WithAvatar from './with_avatar.jsx';
import { cn } from './misc.js';
import React from 'react';
// import Selectable, * as SL from './selectable_li.jsx';
// import postMessage from './api.js';
import _ from 'lodash';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import Cover from './cover.jsx';

export type SessionHeadProps = {
  className?: string;
  head: t.SessionHead;
  withAuthor?: boolean;
};

export function SessionHead({ className, withAuthor, head }: SessionHeadProps) {
  return (
    <WithAvatar className={cn('session-head', className)} username={head.author}>
      <div className="title">{head.title || 'Untitled'}</div>
      {withAuthor && (
        <div className="footer">
          <span className="footer-item author">{head.author || 'anonymous'}</span>
        </div>
      )}
    </WithAvatar>
  );
}

export type SessionListingProps = {
  className?: string;
  user?: t.UserUI;
  listing: t.SessionUIListing;
  onClick: (id: string) => any;
  onDelete: (id: string) => any;
  onEdit: (id: string) => any;
  onLike: (id: string, value: boolean) => any;
};
export type Action = { icon: string; title: string; onClick: () => unknown };
export function SessionListing(props: SessionListingProps) {
  const { head, publication, local, workspace, history } = props.listing;

  const actionClicked = (e: React.MouseEvent, a: Action) => {
    e.preventDefault();
    e.stopPropagation();
    a.onClick?.();
  };

  const lastOpenedTimestamp = history && lib.getSessionHistoryItemLastOpenTimestamp(history);
  const liked = props.user?.metadata?.likes.includes(head.id);

  const actions = _.compact<Action>([
    workspace && {
      icon: 'codicon-trash',
      title: 'Delete session and its data',
      onClick: () => props.onDelete(head.id),
    },
    // {
    //   icon: 'codicon-repo-forked',
    //   title: 'Fork: create a new session based on this one',
    //   onClick: () => props.onFork(head.id)
    // },
    {
      icon: 'codicon-edit',
      title: 'Edit: open this session in the Studio',
      onClick: () => props.onEdit(head.id),
    },
    publication && {
      icon: liked ? 'codicon-heart-filled' : 'codicon-heart',
      title: 'Like',
      onClick: () => props.onLike(head.id, !liked),
    },
  ]);

  return (
    <div className={cn('session-listing', props.className)} onClick={() => props.onClick(head.id)} tabIndex={0}>
      <div className="cover-container">
        <Cover local={local} head={head} />
        <div className="duration">{lib.formatTimeSeconds(head.duration)}</div>
      </div>
      <WithAvatar username={head.author} className="caption" small>
        <div className="title">{head.title || 'Untitled'}</div>
        {/*head.description && (
            <div className="description">
              <TextToParagraphs text={head.description} />
            </div>
            )*/}
        {lastOpenedTimestamp && (
          <div className="footer">
            <span className="footer-item timestamp">
              Last opened <TimeFromNow timestamp={lastOpenedTimestamp} />
            </span>
          </div>
        )}
        {publication?.publishTimestamp && (
          <div className="footer">
            <span className="footer-item timestamp">
              Published <TimeFromNow timestamp={publication.publishTimestamp} />
            </span>
          </div>
        )}
        <div className="footer">
          <span className="footer-item author">{head.author || 'anonymous'}</span>
          {publication?.publishTimestamp && (
            <>
              <div className="footer-item badge">
                <span className="codicon codicon-eye va-top m-right_small" />
                <span className="count">{publication.views}</span>
              </div>
              <div className="footer-item badge">
                <span
                  className={cn('codicon va-top m-right_small', liked ? 'codicon-heart-filled' : 'codicon-heart')}
                />
                <span className="count">{publication.likes}</span>
              </div>
            </>
          )}
        </div>
        <div className="actions">
          {actions.map(a => (
            <VSCodeButton appearance="icon" title={a.title} onClick={e => actionClicked(e, a)}>
              <span className={`codicon ${a.icon}`} />
            </VSCodeButton>
          ))}
        </div>
      </WithAvatar>
    </div>
  );
}

export type SessionListingsProps = {
  className?: string;
  user?: t.UserUI;
  listings: t.SessionUIListing[];
  onClick: (id: string) => any;
  onDelete: (id: string) => any;
  onEdit: (id: string) => any;
  onLike: (id: string, value: boolean) => any;
};

export function SessionListings(props: SessionListingsProps) {
  const { className, listings, ...rest } = props;
  return (
    <div className={cn('session-listings', className)}>
      {listings.map(listing => (
        <SessionListing listing={listing} {...rest} />
      ))}
    </div>
  );
}
