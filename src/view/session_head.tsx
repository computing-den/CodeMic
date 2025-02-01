import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import TimeFromNow from './time_from_now.jsx';
import WithAvatar from './with_avatar.jsx';
import { cn } from './misc.js';
import React from 'react';
// import Selectable, * as SL from './selectable_li.jsx';
import postMessage from './api.js';
import _ from 'lodash';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { AppContext } from './app_context.jsx';
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
  listing: t.SessionUIListing;
};
export type Action = { icon: string; title: string; onClick: () => unknown };
export class SessionListing extends React.Component<SessionListingProps> {
  // static contextType = AppContext;
  // declare context: React.ContextType<typeof AppContext>;

  clicked = () => postMessage({ type: 'welcome/openSessionInPlayer', sessionId: this.props.listing.head.id });
  actionClicked = (e: React.MouseEvent, a: Action) => {
    e.preventDefault();
    e.stopPropagation();
    a.onClick?.();
  };

  render() {
    const { className, listing } = this.props;
    const { head, publication, local, workspace } = listing;
    // const lastOpenedTimestamp = history && lib.getSessionHistoryItemLastOpenTimestamp(history);

    const actions = _.compact<Action>([
      workspace && {
        icon: 'codicon-trash',
        title: 'Delete session and its data',
        onClick: () => postMessage({ type: 'welcome/deleteSession', sessionId: head.id }),
      },
      // {
      //   icon: 'codicon-repo-forked',
      //   title: 'Fork: create a new project based on this one',
      //   onClick: () =>
      //     postMessage({
      //       type: 'recorder/open',
      //       sessionId: this.props.head.id,
      //       fork: true,
      //     }),
      // },
      {
        icon: 'codicon-edit',
        title: 'Edit: open this project in the Studio',
        onClick: () => postMessage({ type: 'welcome/openSessionInRecorder', sessionId: head.id }),
      },
      {
        icon: 'codicon-heart-filled',
        title: 'Like',
        onClick: () => {
          console.log('TODO');
        },
      },
    ]);

    // return (
    //   <SessionHeadForList
    //     head={this.props.head}
    //     history={this.props.history}
    //     coverUri={this.props.coverUri}
    //   />
    // );
    // }

    return (
      <div className={cn('session-head-list-item', className)} onClick={this.clicked} tabIndex={0}>
        <div className="cover-container">
          <Cover local={local} head={head} />
        </div>
        <WithAvatar username={head.author} className="caption" small>
          <div className="title">{head.title || 'Untitled'}</div>
          {/*head.description && (
            <div className="description">
              <TextToParagraphs text={head.description} />
            </div>
            )*/}
          {/*lastOpenedTimestamp && (
            <div className="footer">
              <span className="footer-item timestamp">
                Last opened <TimeFromNow timestamp={lastOpenedTimestamp} />
              </span>
            </div>
            )*/}
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
                  <span className="codicon codicon-heart-filled va-top m-right_small" />
                  <span className="count">{publication.likes}</span>
                </div>
              </>
            )}
          </div>
          <div className="actions">
            {actions.map(a => (
              <VSCodeButton appearance="icon" title={a.title} onClick={e => this.actionClicked(e, a)}>
                <span className={`codicon ${a.icon}`} />
              </VSCodeButton>
            ))}
          </div>
        </WithAvatar>
      </div>
    );
  }
}

export type SessionListingsProps = {
  listings: t.SessionUIListing[];
  className?: string;
};

export class SessionListings extends React.Component<SessionListingsProps> {
  render() {
    const { listings } = this.props;

    const iteratee = (listing: t.SessionUIListing) =>
      (listing.history && lib.getSessionHistoryItemLastOpenTimestamp(listing.history)) || '';
    const listingsOrdered = _.orderBy(listings, iteratee, 'desc');

    return (
      <div className={cn('session-head-list', this.props.className)}>
        {listingsOrdered.map(listing => (
          <SessionListing listing={listing} />
        ))}
      </div>
    );
  }
}
