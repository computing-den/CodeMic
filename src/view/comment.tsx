import * as t from '../lib/types.js';
import TextToParagraphs from './text_to_paragraphs.jsx';
import TimeFromNow from './time_from_now.jsx';
import WithAvatar from './with_avatar.jsx';
import { cn } from './misc.js';
import React, { useState } from 'react';
import postMessage from './api.js';
import _ from 'lodash';
import { VSCodeButton, VSCodeTextArea } from '@vscode/webview-ui-toolkit/react';

export type CommentProps = {
  className?: string;
  comment: t.Comment;
};
export class Comment extends React.Component<CommentProps> {
  render() {
    const { className, comment } = this.props;

    return (
      <WithAvatar className={cn('comment', className)} username={comment.author}>
        <div className="text">
          <TextToParagraphs text={comment.text} />
        </div>
        <div className="footer">
          <span className="footer-item">
            {comment.author} <TimeFromNow timestamp={comment.creationTimestamp} />
          </span>
          {/*
          <div className="footer-item badge">
            <span className="codicon codicon-reply va-top m-right_small" />
          </div>
          <div className="footer-item badge">
            <span className="codicon codicon-thumbsup va-top m-right_small" />
            <span className="count">{comment.likes}</span>
          </div>
          <div className="footer-item badge">
            <span className="codicon codicon-thumbsdown va-top m-right_small" />
            <span className="count">{comment.dislikes}</span>
            </div>*/}
        </div>
      </WithAvatar>
    );
  }
}

// export class SelectableLiComment extends React.Component<CommentProps> {
//   actions: SL.Action[] = [
//     {
//       icon: 'codicon-reply',
//       title: 'Reply',
//       onClick: () => {
//         console.log('TODO');
//       },
//     },
//     {
//       icon: 'codicon-thumbsup',
//       title: 'Like',
//       onClick: () => {
//         console.log('TODO');
//       },
//     },
//     {
//       icon: 'codicon-thumbsdown',
//       title: 'Dislike',
//       onClick: () => {
//         console.log('TODO');
//       },
//     },
//   ];

//   render() {
//     return (
//       <SelectableLi
//         className={cn('comment-list-item', this.props.className)}
//         actions={this.actions}
//         onClick={() => console.log('TODO')}
//       >
//         <Comment {...this.props} />
//       </SelectableLi>
//     );
//   }
// }

export type CommentListProps = { comments?: t.Comment[]; className?: string };
export function CommentList(props: CommentListProps) {
  const comments = _.orderBy(props.comments, c => c.creationTimestamp, 'desc');
  return (
    <div className={cn('comment-list', props.className)}>
      {comments.map(comment => (
        <Comment comment={comment} />
      ))}
    </div>
  );
}

export type CommentInputProps = {
  className?: string;
  author?: string;
  onSend: (text: string) => any;
  disabled?: boolean;
};
export function CommentInput(props: CommentInputProps) {
  const [text, setText] = useState('');

  async function send() {
    await props.onSend(text);
    setText('');
  }

  function cancel() {
    setText('');
  }

  function keyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      send();
    } else if (e.key === 'Escape') {
      cancel();
    }
  }

  return (
    <WithAvatar className={cn('comment-input', props.className)} username={props.author}>
      <VSCodeTextArea
        rows={2}
        resize="vertical"
        value={text}
        onInput={e => setText((e.target as HTMLInputElement).value)}
        placeholder="Leave a comment"
        onKeyDown={keyDown}
        disabled={props.disabled}
      />
      {text.trim() && (
        <div className="buttons">
          <VSCodeButton appearance="secondary" onClick={cancel}>
            Cancel
          </VSCodeButton>
          <VSCodeButton appearance="primary" onClick={send}>
            Send
          </VSCodeButton>
        </div>
      )}
    </WithAvatar>
  );
}
