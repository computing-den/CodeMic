import _ from 'lodash';
import * as t from '../../lib/types.js';
import { Range, Selection, Position } from '../../lib/types.js';
import TextDocument from './internal_text_document.js';

/**
 * The document will be the same for the entire lifetime of this text editor.
 */
export default class InternalTextEditor implements t.InternalEditor {
  constructor(
    public document: TextDocument,
    public selections: readonly Selection[] = [new Selection(new Position(0, 0), new Position(0, 0))],
    public visibleRange: Range = new Range(new Position(0, 0), new Position(1, 0)),
  ) {}

  select(selections: readonly Selection[], visibleRange: Range) {
    this.selections = selections;
    this.visibleRange = visibleRange;
  }

  scroll(visibleRange: Range) {
    this.visibleRange = visibleRange;
  }
}
