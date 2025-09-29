import * as lib from '../lib/lib.js';
import { cn } from './misc.js';
import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import { PopoverProps, usePopover } from './popover.jsx';
import { PictureInPicture } from './svgs.jsx';
import PopoverMenu, { PopoverMenuItem } from './popover_menu.jsx';
import _ from 'lodash';

export type CommonAction = {
  title: string;
  onClick: () => any;
  disabled?: boolean;
};

export type PrimaryAction = CommonAction & {
  type: 'recorder/record' | 'recorder/pause' | 'player/download' | 'player/load' | 'player/play' | 'player/pause';
};
export type Action = CommonAction & {
  icon?: string;
  children?: ReactNode;
};
export type Props = {
  primaryAction: PrimaryAction;
  actions: React.ReactNode;
  clock: number;
  duration?: number;
  recordingIndicator?: boolean;
  activeRecordingIndicator?: boolean;
  className?: string;
};

export default function MediaToolbar(props: Props) {
  let primaryActionIcon: string, primaryActionFor: string;
  switch (props.primaryAction.type) {
    case 'recorder/record': {
      primaryActionIcon = 'codicon-circle-large-filled';
      primaryActionFor = 'for-recorder';
      break;
    }
    case 'recorder/pause': {
      primaryActionIcon = 'codicon-debug-pause';
      primaryActionFor = 'for-recorder';
      break;
    }
    case 'player/download': {
      primaryActionIcon = 'codicon-cloud-download';
      primaryActionFor = 'for-player';
      break;
    }
    case 'player/load': {
      primaryActionIcon = 'codicon-sync';
      primaryActionFor = 'for-player';
      break;
    }
    case 'player/play': {
      primaryActionIcon = 'codicon-play';
      primaryActionFor = 'for-player';
      break;
    }
    case 'player/pause': {
      primaryActionIcon = 'codicon-debug-pause';
      primaryActionFor = 'for-player';
      break;
    }
    default:
      lib.unreachable(props.primaryAction.type);
  }

  return (
    <div className={cn('media-toolbar', props.className)}>
      <div className="primary-action-container">
        <VSCodeButton
          className={`primary-action ${primaryActionFor}`}
          onClick={props.primaryAction.onClick}
          title={props.primaryAction.title}
          appearance="icon"
          disabled={Boolean(props.primaryAction.disabled)}
        >
          <div className={`codicon ${primaryActionIcon}`} />
        </VSCodeButton>
      </div>
      <div className="actions">{props.actions}</div>
      <div className="time">
        {(props.activeRecordingIndicator || props.recordingIndicator) && (
          <span
            className={cn(
              'recording-indicator codicon codicon-circle-filled m-right_small',
              props.activeRecordingIndicator && 'active',
            )}
          />
        )}
        <span className={cn('text', props.duration === undefined && 'large')}>
          {lib.formatTimeSeconds(props.clock)}
          {props.duration === undefined ? '' : ` / ${lib.formatTimeSeconds(props.duration)}`}
        </span>
      </div>
    </div>
  );
}

function MediaToolbarButton_(props: Action, ref: React.ForwardedRef<HTMLElement>) {
  return (
    <VSCodeButton
      // @ts-ignore
      ref={ref}
      appearance="icon"
      title={props.title}
      onClick={props.onClick}
      disabled={Boolean(props.disabled)}
    >
      {props.icon && <span className={cn('codicon', props.icon)} />}
      {props.children}
    </VSCodeButton>
  );
}
export const MediaToolbarButton = React.forwardRef(MediaToolbarButton_);

export type MediaToolbarMenuProps = {
  onSync: () => void;
  onPiP: () => void;
  onEdit?: () => void;
  onPlaybackRate: (rate: number) => void;
  canPiP: boolean;
  canSync: boolean;
  canEdit: boolean;
  showEdit?: boolean;
  playbackRate: number;
};

export function MediaToolbarMenu(props: MediaToolbarMenuProps) {
  const menuButtonRef = useRef<HTMLElement>(null);
  const PopoverMenu = usePopover();

  return (
    <>
      <MediaToolbarButton
        ref={menuButtonRef}
        title="More actions"
        onClick={PopoverMenu.toggle}
        icon="codicon-kebab-vertical"
      />
      <MediaPopoverMenu
        {...props}
        popover={PopoverMenu}
        // onChange={props.setPlaybackRate}
        anchor={menuButtonRef}
        pointOnAnchor="bottom-right"
        pointOnPopover={{ x: 0.7, y: 0 }}
      />
    </>
  );
}

function MediaPopoverMenu(props: PopoverProps & MediaToolbarMenuProps) {
  const [page, setPage] = useState<'root' | 'playbackRate'>('root');

  useEffect(() => {
    if (!props.popover.isOpen) setPage('root');
  }, [props.popover.isOpen]);

  const rootPageContent: PopoverMenuItem[] = _.compact([
    {
      onClick: () => setPage('playbackRate'),
      icon: 'codicon codicon-play-circle',
      title: `Playback speed (${props.playbackRate === 1 ? 'Normal' : props.playbackRate + 'x'})`,
      closeOnClick: false,
    },
    {
      onClick: props.onSync,
      icon: 'codicon codicon-sync',
      title: 'Force sync workspace',
      disabled: !props.canSync,
    },
    {
      onClick: props.onPiP,
      icon: <PictureInPicture />,
      title: 'Picture-in-Picture',
      disabled: !props.canPiP,
    },
    props.showEdit && {
      onClick: props.onEdit,
      icon: 'codicon codicon-edit',
      title: 'Edit session',
      disabled: !props.canEdit,
    },
  ]);

  const playbackRateContent = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(v => ({
    onClick: () => props.onPlaybackRate(v),
    title: v === 1 ? 'Normal' : v + 'x',
    active: v === props.playbackRate,
  }));

  return <PopoverMenu {...props} items={page === 'root' ? rootPageContent : playbackRateContent} />;
}
