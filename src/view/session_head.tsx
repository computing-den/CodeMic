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
  sessionHead: t.SessionHead;
};
export type ForListProps = CommonProps & {
  history?: t.SessionHistory;
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

export function SessionHead({ className, withAuthor, sessionHead: s }: NormalProps) {
  return (
    <WithAvatar className={cn('session-head', className)} username={s.author}>
      <div className="title">{s.title || 'Untitled'}</div>
      {withAuthor && (
        <div className="footer">
          <span className="footer-item author">{s.author || 'anonymous'}</span>
        </div>
      )}
    </WithAvatar>
  );
}

export type Action = { icon: string; title: string; onClick: () => unknown };
export class SessionHeadListItem extends React.Component<ListItemProps> {
  static contextType = AppContext;
  declare context: React.ContextType<typeof AppContext>;

  clicked = () => postMessage({ type: 'player/open', sessionId: this.props.sessionHead.id });
  actionClicked = (e: React.MouseEvent, a: Action) => {
    e.preventDefault();
    e.stopPropagation();
    a.onClick?.();
  };

  render() {
    const { cache } = this.context;
    const { className, history, sessionHead: s } = this.props;
    const lastOpenedTimestamp = history && lib.getSessionHistoryItemLastOpenTimestamp(history);

    const actions = _.compact<Action>([
      /*!this.props.sessionHead.publishTimestamp*/ true && {
        icon: 'codicon-trash',
        title: 'Delete',
        onClick: () => postMessage({ type: 'deleteSession', sessionId: this.props.sessionHead.id }),
      },
      // {
      //   icon: 'codicon-repo-forked',
      //   title: 'Fork: create a new project based on this one',
      //   onClick: () =>
      //     postMessage({
      //       type: 'recorder/open',
      //       sessionId: this.props.sessionHead.id,
      //       fork: true,
      //     }),
      // },
      {
        icon: 'codicon-edit',
        title: 'Edit: open this project in the Studio',
        onClick: () => postMessage({ type: 'recorder/open', sessionId: this.props.sessionHead.id }),
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
    //     sessionHead={this.props.sessionHead}
    //     history={this.props.history}
    //     coverUri={this.props.coverUri}
    //   />
    // );
    // }

    return (
      <div className={cn('session-head-list-item', className)} onClick={this.clicked} tabIndex={0}>
        {s.hasCover && (
          <div className="cover-container">
            {/*<div className="background" style={{ backgroundImage: `url(${coverUri})` }} />*/}
            <img src={getCoverUri(s.id, cache).toString()} />
          </div>
        )}
        <WithAvatar username={s.author} className="caption" small>
          <div className="title">{s.title || 'Untitled'}</div>
          {/*s.description && (
            <div className="description">
              <TextToParagraphs text={s.description} />
            </div>
            )*/}
          {/*lastOpenedTimestamp && (
            <div className="footer">
              <span className="footer-item timestamp">
                Last opened <TimeFromNow timestamp={lastOpenedTimestamp} />
              </span>
            </div>
            )*/}
          {/*s.publishTimestamp && (
            <div className="footer">
              <span className="footer-item timestamp">
                Published <TimeFromNow timestamp={s.publishTimestamp} />
              </span>
            </div>
            )*/}
          <div className="footer">
            <span className="footer-item author">{s.author || 'anonymous'}</span>
            {/*s.publishTimestamp && (
              <>
                <div className="footer-item badge">
                  <span className="codicon codicon-eye va-top m-right_small" />
                  <span className="count">{s.views}</span>
                </div>
                <div className="footer-item badge">
                  <span className="codicon codicon-heart-filled va-top m-right_small" />
                  <span className="count">{s.likes}</span>
                </div>
              </>
              )*/}
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
  sessionHeads: t.SessionHead[];
  history: t.SessionsHistory;
  className?: string;
};
type SHPair = [t.SessionHead, t.SessionHistory];

export class SessionHeadList extends React.Component<SessionHeadListProps> {
  render() {
    const iteratee = ([s, h]: [t.SessionHead, t.SessionHistory]) =>
      (h && lib.getSessionHistoryItemLastOpenTimestamp(h)) || '';

    let pairs: SHPair[] = _.map(this.props.sessionHeads, s => [s, this.props.history[s.id]] as SHPair);
    pairs = _.orderBy(pairs, iteratee, 'desc');

    return (
      <div className={cn('session-head-list', this.props.className)}>
        {pairs.map(([sessionHead, history]) => (
          <SessionHeadListItem history={history} sessionHead={sessionHead} />
        ))}
      </div>
    );
  }
}
