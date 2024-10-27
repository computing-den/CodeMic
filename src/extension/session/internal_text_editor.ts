import _ from 'lodash';
import * as t from '../../lib/types.js';
import TextDocument from './internal_text_document.js';
import { makeSelectionN, makeRangeN } from './internal_helpers.js';

/**
 * The document will be the same for the entire lifetime of this text editor.
 */
export default class InternalTextEditor implements t.InternalEditor {
  constructor(
    public document: TextDocument,
    public selections: t.Selection[] = [makeSelectionN(0, 0, 0, 0)],
    public visibleRange: t.Range = makeRangeN(0, 0, 1, 0),
  ) {}

  select(selections: t.Selection[], visibleRange: t.Range) {
    this.selections = selections;
    this.visibleRange = visibleRange;
  }

  scroll(visibleRange: t.Range) {
    this.visibleRange = visibleRange;
  }
}
