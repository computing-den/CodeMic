import * as t from '../lib/types.js';
import * as path from '../lib/path.js';
import { cn } from './misc.js';
import postMessage from './api.js';
import { h, Fragment, Component } from 'preact';

export type Props = {
  className?: string;
  onChange: (value: string) => unknown;
  value?: string;
  autoFocus?: boolean;
  label?: string;
  pickTitle: string;
  disabled?: boolean;
};
export default class PathField extends Component<Props> {
  changed = async (e: InputEvent) => {
    this.props.onChange((e.target as HTMLInputElement).value);
  };

  pick = async () => {
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        defaultUri: this.props.value ? path.fileUriFromAbsPath(path.abs(this.props.value)) : undefined,
        canSelectFolders: true,
        canSelectFiles: false,
        title: this.props.pickTitle,
      },
    });
    if (uris?.length === 1) {
      if (!path.isFileUri(uris[0] as t.Uri)) {
        throw new Error(`pick: only local paths are supported. Instead received ${uris[0]}`);
      }
      this.props.onChange(path.getFileUriPath(uris[0] as t.Uri));
    }
  };

  render() {
    return (
      <vscode-text-field
        className={cn('path-field', this.props.className)}
        onInput={this.changed}
        value={this.props.value}
        autofocus={this.props.autoFocus}
        disabled={this.props.disabled}
      >
        {this.props.label}
        <vscode-button slot="end" appearance="icon" title="Pick" onClick={this.pick}>
          <span className="codicon codicon-search" />
        </vscode-button>
      </vscode-text-field>
    );
  }
}
