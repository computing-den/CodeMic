import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import { cn } from './misc.js';
import React, { ReactNode } from 'react';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';

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
  actions: Action[];
  clock: number;
  duration?: number;
  recordingIndicator?: boolean;
  activeRecordingIndicator?: boolean;
  className?: string;
};

export default class MediaToolbar extends React.Component<Props> {
  render() {
    let primaryActionIcon: string, primaryActionFor: string;
    switch (this.props.primaryAction.type) {
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
        lib.unreachable(this.props.primaryAction.type);
    }

    return (
      <div className={cn('media-toolbar', this.props.className)}>
        <div className="primary-action-container">
          <VSCodeButton
            className={`primary-action ${primaryActionFor}`}
            onClick={this.props.primaryAction.onClick}
            title={this.props.primaryAction.title}
            appearance="icon"
            disabled={Boolean(this.props.primaryAction.disabled)}
          >
            <div className={`codicon ${primaryActionIcon}`} />
          </VSCodeButton>
        </div>
        <div className="actions">
          {this.props.actions.map(a => (
            <VSCodeButton appearance="icon" title={a.title} onClick={a.onClick} disabled={Boolean(a.disabled)}>
              {a.icon && <span className={cn('codicon', a.icon)} />}
              {a.children}
            </VSCodeButton>
          ))}
        </div>
        <div className="time">
          {(this.props.activeRecordingIndicator || this.props.recordingIndicator) && (
            <span
              className={cn(
                'recording-indicator codicon codicon-circle-filled m-right_small',
                this.props.activeRecordingIndicator && 'active',
              )}
            />
          )}
          <span className={cn('text', this.props.duration === undefined && 'large')}>
            {lib.formatTimeSeconds(this.props.clock)}
            {this.props.duration === undefined ? '' : ` / ${lib.formatTimeSeconds(this.props.duration)}`}
          </span>
        </div>
      </div>
    );
  }
}
