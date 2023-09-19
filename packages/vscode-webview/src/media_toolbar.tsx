import { types as t, lib } from '@codecast/lib';
import { cn } from './misc.js';
import { h, Fragment, Component } from 'preact';

export type CommonAction = {
  title: string;
  onClick: () => void;
};

export type PrimaryAction = CommonAction & {
  type: 'record' | 'pauseRecording' | 'play' | 'pausePlaying';
};
export type Action = CommonAction & {
  icon: string;
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

export default class MediaToolbar extends Component<Props> {
  render() {
    let primaryActionIcon: string, primaryActionFor: string;
    switch (this.props.primaryAction.type) {
      case 'record': {
        primaryActionIcon = 'codicon-circle-large-filled';
        primaryActionFor = 'for-recorder';
        break;
      }
      case 'pauseRecording': {
        primaryActionIcon = 'codicon-debug-pause';
        primaryActionFor = 'for-recorder';
        break;
      }
      case 'play': {
        primaryActionIcon = 'codicon-play';
        primaryActionFor = 'for-player';
        break;
      }
      case 'pausePlaying': {
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
          <vscode-button
            className={`primary-action ${primaryActionFor}`}
            onClick={this.props.primaryAction.onClick}
            title={this.props.primaryAction.title}
            appearance="icon"
          >
            <div className={`codicon ${primaryActionIcon}`} />
          </vscode-button>
        </div>
        <div className="actions">
          {this.props.actions.map(a => (
            <vscode-button appearance="icon" title={a.title} onClick={a.onClick}>
              <span className={cn('codicon', a.icon)} />
            </vscode-button>
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
