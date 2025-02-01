import config from './config.js';
import { URI, Utils } from 'vscode-uri';
import { cn, getCoverCacheUri } from './misc.js';
import React from 'react';
import ImgWithFallback from './img_with_fallback.jsx';
import { SessionHead } from '../lib/types.js';
import { useAppContext } from './app_context.js';

type Props = { className?: string; head: SessionHead; local: boolean };

export default function Cover(props: Props) {
  const { cache } = useAppContext();

  let src: string | undefined;
  if (props.head.hasCover) {
    src = props.local
      ? getCoverCacheUri(props.head.id, cache).toString()
      : `${config.server}/session-cover?id=${props.head.id}`;
  }

  const fallback = Utils.joinPath(URI.parse(config.extensionWebviewUri), 'resources', 'default-cover.png').toString();

  return <ImgWithFallback className={props.className} src={src} fallback={fallback} />;
}
