import * as t from '../lib/types.js';
import { cn } from './misc.js';
import postMessage from './api.js';
import React from 'react';
import { VSCodeButton, VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import { URI } from 'vscode-uri';

export type Props = {
  className?: string;
  onChange: (value: string) => unknown;
  value?: string;
  autoFocus?: boolean;
  pickTitle: string;
  disabled?: boolean;
  placeholder?: string;
  children: React.ReactNode;
};
export default class PathField extends React.Component<Props> {
  changed = async (e: Event | React.FormEvent<HTMLElement>) =>
    this.props.onChange((e.target as HTMLInputElement).value);

  pick = async () => {
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        defaultUri: this.props.value ? URI.file(this.props.value).toString() : undefined,
        canSelectFolders: true,
        canSelectFiles: false,
        title: this.props.pickTitle,
        canSelectMany: false,
      },
    });
    if (uris?.length === 1) {
      if (URI.parse(uris[0]).scheme !== 'file') {
        throw new Error(`pick: only local paths are supported. Instead received ${uris[0]}`);
      }
      this.props.onChange(URI.parse(uris[0]).fsPath);
    }
  };

  render() {
    return (
      <VSCodeTextField
        className={cn('path-field', this.props.className)}
        onInput={this.changed}
        value={this.props.value}
        autofocus={this.props.autoFocus}
        disabled={this.props.disabled}
        placeholder={this.props.placeholder}
      >
        {this.props.children}
        <VSCodeButton slot="end" appearance="icon" title="Pick" onClick={this.pick}>
          <span className="codicon codicon-search" />
        </VSCodeButton>
      </VSCodeTextField>
    );
  }
}
