import _ from 'lodash';
import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';

export default class InternalTextDocument implements t.InternalDocument {
  constructor(
    public uri: string,
    public lines: string[],
    public eol: t.EndOfLine,
    public languageId: string,
  ) {}

  static fromBuffer(
    uri: string,
    arrayBuffer: Uint8Array,
    opts: { eol?: t.EndOfLine; defaultEol?: t.EndOfLine; languageId: string },
  ): InternalTextDocument {
    return InternalTextDocument.fromText(uri, new TextDecoder().decode(arrayBuffer), opts);
  }

  static fromText(
    uri: string,
    text: string,
    opts: { eol?: t.EndOfLine; defaultEol?: t.EndOfLine; languageId: string },
  ): InternalTextDocument {
    assert(opts.eol || opts.defaultEol);
    const eol = opts.eol ?? (text.match(/\r?\n/)?.[0] as t.EndOfLine | undefined) ?? opts.defaultEol!;
    const lines = text.split(/\r?\n/);
    return new InternalTextDocument(uri, lines, eol, opts.languageId);
  }

  get isEmpty(): boolean {
    return this.lines.length <= 1 && !this.lines[0];
  }

  getContent(): Uint8Array {
    return new TextEncoder().encode(this.getText());
  }

  getText(range?: t.Range): string {
    if (range) {
      assert(this.isRangeValid(range), 'InternalTextDocument getText: invalid range');
      if (range.start.line === range.end.line) {
        return this.lines[range.start.line].slice(range.start.character, range.end.character);
      } else {
        let text = this.lines[range.start.line].slice(range.start.character);
        for (let i = range.start.line + 1; i < range.end.line; i++) {
          text += this.eol + this.lines[i];
        }
        text += this.eol + this.lines[range.end.line].slice(0, range.end.character);
        return text;
      }
    } else {
      return this.lines.map(x => x).join(this.eol);
    }
  }

  isRangeValid(range: t.Range): boolean {
    return (
      range.start.line >= 0 &&
      range.start.character >= 0 &&
      range.end.line < this.lines.length &&
      range.end.character <= this.lines[range.end.line].length
    );
  }

  /**
   * Must be in increasing order and without overlaps.
   * We calculate in increasing order instead of doing it in reverse because it makes calculating
   * the line and character shifts for the reverse content changes easier.
   */
  applyContentChanges(contentChanges: t.ContentChange[], calcReverse: true): t.ContentChange[];
  applyContentChanges(contentChanges: t.ContentChange[], calcReverse: false): undefined;
  applyContentChanges(contentChanges: t.ContentChange[], calcReverse: boolean) {
    const { lines } = this;
    let revContentChanges: t.ContentChange[] | undefined;
    let totalLineShift: number = 0;
    let lastLineShifted = 0;
    let lastLineCharShift = 0;
    if (calcReverse) {
      revContentChanges = [];
    }

    for (let { range: range, text: text } of contentChanges) {
      const origRange = range;

      // Apply shifts.
      {
        const startLine = range.start.line + totalLineShift;
        const startChar = range.start.character + (lastLineShifted === startLine ? lastLineCharShift : 0);
        const endLine = range.end.line + totalLineShift;
        const endChar = range.end.character + (lastLineShifted === endLine ? lastLineCharShift : 0);
        range = { start: { line: startLine, character: startChar }, end: { line: endLine, character: endChar } };
      }

      const newLines = text.split(/\r?\n/);

      // Calculate reverse text.
      let revText: string | undefined;
      if (calcReverse) revText = this.getText(range);

      // Prepend [0, range.start.character] of the first old line to the first new line.
      const firstLinePrefix = lines[range.start.line].slice(0, range.start.character);
      newLines[0] = firstLinePrefix + newLines[0];

      // Append [range.end.character, END] of the last old line to the last new line.
      const lastLineSuffix = lines[range.end.line].slice(range.end.character);
      newLines[newLines.length - 1] += lastLineSuffix;

      const rangeLineCount = range.end.line - range.start.line + 1;
      const extraLineCount = newLines.length - rangeLineCount;

      // Insert or delete extra lines.
      if (extraLineCount > 0) {
        const extraLines = _.times(extraLineCount, () => '');
        lines.splice(range.start.line, 0, ...extraLines);
      } else if (extraLineCount < 0) {
        lines.splice(range.start.line, -extraLineCount);
      }

      // Replace lines.
      for (let i = 0; i < newLines.length; i++) {
        lines[i + range.start.line] = newLines[i];
      }

      // Calculate final position.
      const finalPosition = {
        line: range.end.line + extraLineCount,
        character: newLines[newLines.length - 1].length - lastLineSuffix.length,
      };

      // Insert into revContentChanges.
      if (revContentChanges) {
        // Calculate reverse range
        const revRange = { start: range.start, end: finalPosition };
        revContentChanges!.push({ range: revRange, text: revText! });
      }

      // Calculate shifts for next loop iteration.
      lastLineShifted = finalPosition.line;
      lastLineCharShift = finalPosition.character - origRange.end.character;
      totalLineShift += extraLineCount;
    }

    return revContentChanges;
  }

  getRange(): t.Range {
    if (!this.lines.length) return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    return {
      start: { line: 0, character: 0 },
      end: { line: this.lines.length - 1, character: this.lines[this.lines.length - 1].length },
    };
  }
}
