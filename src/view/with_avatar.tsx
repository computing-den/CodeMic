import config from './config.js';
import { URI, Utils } from 'vscode-uri';
import { cn, getAvatarUri } from './misc.js';
import React, { useEffect, useRef, useState } from 'react';
import { getStore } from './store.js';
import { userAppContext } from './app_context.jsx';
import ImgWithFallback from './img_with_fallback.jsx';

type Props = { className?: string; username?: string; small?: boolean; children: React.ReactNode };
export default function WithAvatar(props: Props) {
  const { cache } = userAppContext();

  const src = props.username && getAvatarUri(props.username, cache).toString();
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
