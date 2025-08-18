import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import { cn } from './misc.js';
import React, { ReactNode, RefObject, useEffect, useRef, useState } from 'react';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';
import Popover, { PopoverProps, usePopover } from './popover.jsx';
import { PictureInPicture } from './svgs.jsx';

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
  const menuPopover = usePopover();

  return (
    <>
      <MediaToolbarButton
        ref={menuButtonRef}
        title="More actions"
        onClick={menuPopover.toggle}
        icon="codicon-kebab-vertical"
      />
      <MenuPopover
        {...props}
        popover={menuPopover}
        // onChange={props.setPlaybackRate}
        anchor={menuButtonRef}
        pointOnAnchor="bottom-right"
        pointOnPopover={{ x: 0.7, y: 0 }}
      />
    </>
  );
}

function MenuPopover(props: PopoverProps & MediaToolbarMenuProps) {
  const [page, setPage] = useState<'root' | 'playbackRate'>('root');

  useEffect(() => {
    if (!props.popover.isOpen) setPage('root');
  }, [props.popover.isOpen]);

  const rootPageContent = (
    <>
      <MenuItem
        onClick={() => {
          // props.onSync();
          setPage('playbackRate');
        }}
        icon="codicon-play-circle"
        title={`Playback speed (${props.playbackRate === 1 ? 'Normal' : props.playbackRate + 'x'})`}
      />
      <MenuItem
        onClick={() => {
          props.onSync();
          props.popover.close();
        }}
        icon="codicon-sync"
        title="Force sync workspace"
        disabled={!props.canSync}
      />
      <MenuItem
        onClick={() => {
          props.onPiP();
          props.popover.close();
        }}
        customIcon={<PictureInPicture />}
        title="Picture-in-Picture"
        disabled={!props.canPiP}
      />
      {props.showEdit && (
        <MenuItem
          onClick={() => {
            props.onEdit?.();
            props.popover.close();
          }}
          icon="codicon-edit"
          title="Edit session"
          disabled={!props.canEdit}
        />
      )}
    </>
  );

  const playbackRateContent = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(v => (
    <MenuItem
      onClick={() => {
        props.onPlaybackRate(v);
        props.popover.close();
      }}
      title={v === 1 ? 'Normal' : v + 'x'}
      active={v === props.playbackRate}
    />
  ));

  return (
    <Popover {...props} className="media-toolbar-menu">
      {page === 'root' ? rootPageContent : playbackRateContent}
    </Popover>
  );
}

function MenuItem(props: {
  onClick: () => void;
  disabled?: boolean;
  icon?: string;
  customIcon?: React.ReactNode;
  title: string;
  active?: boolean;
}) {
  return (
    <a
      href="#"
      onClick={e => {
        e.preventDefault();
        e.stopPropagation();
        if (!props.disabled) props.onClick();
      }}
      className={cn('unstyled menu-item', props.disabled && 'disabled', props.active && 'active')}
    >
      {(props.icon && <span className={cn('codicon', props.icon)} />) || props.customIcon || <span />}
      <span className="title">{props.title}</span>
    </a>
  );
}
