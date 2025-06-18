import _ from 'lodash';
import * as t from '../../lib/types.js';
import { Range, LineRange, Selection, Position } from '../../lib/lib.js';
import TextDocument from './internal_text_document.js';

/**
 * The document will be the same for the entire lifetime of this text editor.
 */
export default class InternalTextEditor implements t.InternalEditor {
  constructor(
    public uri: string,
    public document?: TextDocument,
    public selections: Selection[] = [new Selection(new Position(0, 0), new Position(0, 0))],
    public visibleRange: LineRange = new LineRange(0, 1),
  ) {}

  get currentLine(): number {
    return this.selections[0]?.active.line ?? 0;
  }

  get currentLineText(): string {
    return this.document?.lines[this.currentLine] ?? '';
  }

  select(selections: Selection[]) {
    this.selections = selections;
  }

  scroll(visibleRange: LineRange) {
    this.visibleRange = visibleRange;
  }
}
