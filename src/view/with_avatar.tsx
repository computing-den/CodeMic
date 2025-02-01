import config from './config.js';
import { URI, Utils } from 'vscode-uri';
import { cn } from './misc.js';
import React from 'react';
import ImgWithFallback from './img_with_fallback.jsx';

type Props = { className?: string; username?: string; small?: boolean; children: React.ReactNode };
export default function WithAvatar(props: Props) {
  const src = props.username && `${config.server}/avatar?username=${props.username}`;
  const fallback = Utils.joinPath(URI.parse(config.extensionWebviewUri), 'resources', 'default-avatar.png').toString();

  return (
    <div className={cn('with-avatar', props.small && 'small', props.className)}>
      <div className="avatar">
        <ImgWithFallback src={src} fallback={fallback} />
      </div>
      <div className="body">{props.children}</div>
    </div>
  );
}
