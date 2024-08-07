import { types as t, lib } from '@codecast/lib';
import TimeFromNow from './time_from_now.jsx';
import WithAvatar from './with_avatar.jsx';
import { cn } from './misc.js';
import { h, Fragment, Component } from 'preact';
import SelectableLi, * as SL from './selectable_li.jsx';
import postMessage from './api.js';
import _ from 'lodash';

export type CommonProps = {
  className?: string;
  sessionSummary: t.SessionSummary;
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

export class SessionSummary extends Component<NormalProps> {
  render() {
    const { className, withAuthor, sessionSummary: s } = this.props;

    return (
      <WithAvatar className={cn('session-summary', className)} src={this.props.sessionSummary.author?.avatar}>
        <div className="title">{s.title || 'Untitled'}</div>
        {withAuthor && (
          <div className="footer">
            <span className="footer-item author">{s.author?.username || 'anonymous'}</span>
          </div>
        )}
      </WithAvatar>
    );
  }
}

export class SessionSummaryForList extends Component<ForListProps> {
  render() {
    const { className, history, sessionSummary: s } = this.props;
    const lastOpenedTimestamp = history && lib.getSessionHistoryItemLastOpenTimestamp(history);

    return (
      <WithAvatar className={cn('session-summary for-list', className)} src={this.props.sessionSummary.author?.avatar}>
        <div className="title">{s.title || 'Untitled'}</div>
        {s.description && <div className="description">{s.description}</div>}
        {lastOpenedTimestamp && (
          <div className="footer">
            <span className="footer-item timestamp">
              Last opened <TimeFromNow timestamp={lastOpenedTimestamp} />
            </span>
          </div>
        )}
        {s.publishTimestamp && (
          <div className="footer">
            <span className="footer-item timestamp">
              Published <TimeFromNow timestamp={s.publishTimestamp} />
            </span>
          </div>
        )}
        <div className="footer">
          <span className="footer-item author">{s.author?.username || 'anonymous'}</span>
          {s.publishTimestamp && (
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
          )}
        </div>
      </WithAvatar>
    );
  }
}

export class SessionSummaryListItem extends Component<ListItemProps> {
  clicked = () => postMessage({ type: 'player/open', sessionId: this.props.sessionSummary.id });
  actions: SL.Action[] = [
    // {
    //   icon: 'codicon-play',
    //   title: 'Play',
    //   onClick: () => postMessage({ type: 'player/open', sessionId: this.props.sessionSummary.id }),
    // },
    {
      icon: 'codicon-repo-forked',
      title: 'Fork: create a new project based on this one',
      onClick: () =>
        postMessage({
          type: 'recorder/open',
          sessionId: this.props.sessionSummary.id,
          fork: true,
        }),
    },
    {
      icon: 'codicon-edit',
      title: 'Edit: open this project in the Studio',
      onClick: () => postMessage({ type: 'recorder/open', sessionId: this.props.sessionSummary.id }),
    },
    {
      icon: 'codicon-heart-filled',
      title: 'Like',
      onClick: () => {
        console.log('TODO');
      },
    },
    {
      icon: 'codicon-close',
      title: 'Delete',
      onClick: () => postMessage({ type: 'deleteSession', sessionId: this.props.sessionSummary.id }),
    },
  ];

  render() {
    return (
      <SelectableLi
        className={cn('session-summary-list-item', this.props.className)}
        actions={this.actions}
        onClick={this.clicked}
      >
        <SessionSummaryForList sessionSummary={this.props.sessionSummary} history={this.props.history} />
      </SelectableLi>
    );
  }
}

export type SessionSummaryListProps = {
  sessionSummaries: t.SessionSummary[];
  history: t.SessionsHistory;
  className?: string;
};
type SHPair = [t.SessionSummary, t.SessionHistory];

export class SessionSummaryList extends Component<SessionSummaryListProps> {
  render() {
    const iteratee = ([s, h]: [t.SessionSummary, t.SessionHistory]) =>
      (h && lib.getSessionHistoryItemLastOpenTimestamp(h)) || '';
    let pairs: SHPair[] = _.map(this.props.sessionSummaries, s => [s, this.props.history[s.id]]);
    pairs = _.orderBy(pairs, iteratee, 'desc');

    return (
      <ul className={cn('unstyled session-summary-list', this.props.className)}>
        {pairs.map(([sessionSummary, history]) => (
          <SessionSummaryListItem history={history} sessionSummary={sessionSummary} />
        ))}
      </ul>
    );
  }
}
