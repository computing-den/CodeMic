import { types as t, lib } from '@codecast/lib';
import TextToParagraphs from './text_to_paragraphs.jsx';
import TimeFromNow from './time_from_now.jsx';
import WithAvatar from './with_avatar.jsx';
import { cn } from './misc.js';
import { h, Fragment, Component } from 'preact';
import postMessage from './api.js';
import _ from 'lodash';

export type CommentProps = {
  className?: string;
  comment: t.Comment;
};
export class Comment extends Component<CommentProps> {
  render() {
    const { className, comment } = this.props;

    return (
      <WithAvatar className={cn('comment', className)} src={comment.author.avatar}>
        <div className="text">
          <TextToParagraphs text={comment.text} />
        </div>
        <div className="footer">
          <span className="footer-item">
            {comment.author.username} <TimeFromNow timestamp={comment.creation_timestamp} />
          </span>
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
          </div>
        </div>
      </WithAvatar>
    );
  }
}

// export class SelectableLiComment extends Component<CommentProps> {
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

export type CommentListProps = { comments: t.Comment[]; className?: string };
export class CommentList extends Component<CommentListProps> {
  render() {
    const { comments, className } = this.props;

    return (
      <div className={cn('comment-list', className)}>
        {comments.map(comment => (
          <Comment comment={comment} />
        ))}
      </div>
    );
  }
}

export type CommentInputProps = {
  className?: string;
  author: t.UserSummary;
};
export class CommentInput extends Component<CommentInputProps> {
  state = {
    text: '',
  };

  textChanged = async (e: InputEvent) => this.setState({ text: (e.target as HTMLInputElement).value });

  render() {
    const { className, author } = this.props;
    const { text } = this.state;

    return (
      <WithAvatar className={cn('comment-input', className)} src={author.avatar}>
        <vscode-text-area
          rows={2}
          resize="vertical"
          value={text}
          onInput={this.textChanged}
          placeholder="Leave a comment"
        ></vscode-text-area>
      </WithAvatar>
    );
  }
}
