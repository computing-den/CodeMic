import config from './config.js';
import { URI, Utils } from 'vscode-uri';
import { cn, getCoverCacheUri } from './misc.js';
import React, { memo } from 'react';
import ImgWithFallback from './img_with_fallback.jsx';
import { useAppContext } from './app_context.js';

type Props = { className?: string; hasCover: boolean; sessionId: string; local: boolean };

export default memo(function Cover(props: Props) {
  const { cache } = useAppContext();

  let src: string | undefined;
  if (props.hasCover) {
    src = props.local
      ? getCoverCacheUri(props.sessionId, cache).toString()
      : `${config.server}/session-cover?id=${props.sessionId}`;
  }

  const fallback = Utils.joinPath(URI.parse(config.extensionWebviewUri), 'resources', 'default-cover.png').toString();

  return <ImgWithFallback className={cn('session-cover', props.className)} src={src} fallback={fallback} />;
});
