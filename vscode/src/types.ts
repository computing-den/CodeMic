// export type Recording = {
//   name: string;
//   hash: string;
//   time: number;
//   formatVersion: number;
//   cmds: Cmd[];
// };

import * as vscode from 'vscode';

// export type CcUri = {
//   scheme: string;
//   path: string;
// };

// export type CcPos = { line: number; col: number };
// export type CcSelection = { anchor: CcPos; active: CcPos };
// export type CcRange = { start: CcPos; end: CcPos };
// export type CcLineRange = { start: number; end: number };

export type Event =
  | StopEvent
  | TextChangeEvent
  | OpenDocumentEvent
  | ShowDocumentEvent
  | SelectEvent
  | ScrollEvent
  | SaveEvent
  | ReverseEvent;

export type StopEvent = {
  type: 'stop';
  clock: number;
};

export type TextChangeEvent = {
  type: 'textChange';
  clock: number;
  uri: vscode.Uri;
  text: string;
  range: vscode.Range;
  selections: vscode.Selection[];
  revText: string;
  revRange: vscode.Range;
  revSelections: vscode.Selection[];
};

export type OpenDocumentEvent = {
  type: 'openDocument';
  clock: number;
  uri: vscode.Uri;
  text: string;
  eol: vscode.EndOfLine;
};

export type ShowDocumentEvent = {
  type: 'showDocument';
  clock: number;
  uri: vscode.Uri;
  selections: vscode.Selection[];
  revUri?: vscode.Uri;
  revSelections: vscode.Selection[];
};

export type SelectEvent = {
  type: 'select';
  clock: number;
  uri: vscode.Uri;
  selections: vscode.Selection[];
  visibleRange: vscode.Range;
  revSelections: vscode.Selection[];
  revVisibleRange: vscode.Range;
};

export type ScrollEvent = {
  type: 'scroll';
  clock: number;
  uri: vscode.Uri;
  visibleRange: vscode.Range;
  revVisibleRange: vscode.Range;
};

export type SaveEvent = {
  type: 'save';
  clock: number;
  uri: vscode.Uri;
};

export type ReverseEvent = {
  type: 'reverse';
  clock: number;
  event: Event;
};
