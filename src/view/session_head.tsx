import { getStore } from './store.js';
import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import TextToParagraphs from './text_to_paragraphs.jsx';
import TimeFromNow from './time_from_now.jsx';
import WithAvatar from './with_avatar.jsx';
import { cn, getCoverUri } from './misc.js';
import React from 'react';
// import Selectable, * as SL from './selectable_li.jsx';
import postMessage from './api.js';
import _ from 'lodash';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { AppContext } from './app_context.jsx';

export type CommonProps = {
  className?: string;
  head: t.SessionHead;
};
export type ForListProps = CommonProps & {
  history?: t.SessionHistory;
  publication?: t.SessionPublication;
};
export type ListItemProps = ForListProps & {
  // onOpen: (id: string) => unknown;
  // onEdit: (id: string) => unknown;
  // onFork: (id: string) => unknown;
  // onLike: (id: string) => unknown;
  // onDelete: (id: string) => unknown;
};
export type NormalProps = CommonProps & {
  withAuthor?: boolean;
};

export function SessionHead({ className, withAuthor, head }: NormalProps) {
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

export type Action = { icon: string; title: string; onClick: () => unknown };
export class SessionHeadListItem extends React.Component<ListItemProps> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;

  clicked = () => postMessage({ type: 'welcome/openSessionInPlayer', sessionId: this.props.head.id });
  actionClicked = (e: React.MouseEvent, a: Action) => {
    e.preventDefault();
    e.stopPropagation();
    a.onClick?.();
  };

  render() {
    const { cache } = this.context;
    const { className, history, publication, head } = this.props;
    // const lastOpenedTimestamp = history && lib.getSessionHistoryItemLastOpenTimestamp(history);

    const actions = _.compact<Action>([
      history?.workspace && {
        icon: 'codicon-trash',
        title: 'Delete session and its data',
        onClick: () => postMessage({ type: 'welcome/deleteSession', sessionId: this.props.head.id }),
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
        onClick: () => postMessage({ type: 'welcome/openSessionInRecorder', sessionId: this.props.head.id }),
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
        {head.hasCover && (
          <div className="cover-container">
            {/*<div className="background" style={{ backgroundImage: `url(${coverUri})` }} />*/}
            <img src={getCoverUri(head.id, cache).toString()} />
          </div>
        )}
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

export type SessionHeadListProps = {
  listings: t.SessionUIListing[];
  className?: string;
};

export class SessionHeadList extends React.Component<SessionHeadListProps> {
  render() {
    const { listings } = this.props;

    const iteratee = (listing: t.SessionUIListing) =>
      (listing.history && lib.getSessionHistoryItemLastOpenTimestamp(listing.history)) || '';
    const listingsOrdered = _.orderBy(listings, iteratee, 'desc');

    return (
      <div className={cn('session-head-list', this.props.className)}>
        {listingsOrdered.map(listing => (
          <SessionHeadListItem head={listing.head} history={listing.history} publication={listing.publication} />
        ))}
      </div>
    );
  }
}
