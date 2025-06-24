import _ from 'lodash';
import * as t from '../../lib/types.js';
import TextDocument from './internal_text_document.js';

/**
 * The document will be the same for the entire lifetime of this text editor.
 */
export default class InternalTextEditor implements t.InternalEditor {
  constructor(
    public uri: string,
    public document?: TextDocument,
    public selections: t.Selection[] = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
    public visibleRange: t.LineRange = { start: 0, end: 1 },
  ) {}

  get currentLine(): number {
    return this.selections[0]?.active.line ?? 0;
  }

  get currentLineText(): string {
    return this.document?.lines[this.currentLine] ?? '';
  }

  select(selections: t.Selection[]) {
    this.selections = selections;
  }

  scroll(visibleRange: t.LineRange) {
    this.visibleRange = visibleRange;
  }
}
