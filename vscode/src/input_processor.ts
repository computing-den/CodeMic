type LineProcessor = (error: Error | undefined, line: string) => Promise<void>;

class InputProcessor {
  cb: LineProcessor;
  buf: string = '';
  isProcessing: boolean = false;
  isClosing: boolean = false;
  onClose: (() => void) | undefined;
  onClosePromise: Promise<void> | undefined;

  constructor(cb: LineProcessor) {
    this.cb = cb;
  }

  push(data: string) {
    this.buf += data;
    this.process();
  }

  async close(): Promise<void> {
    if (!this.onClosePromise) {
      this.onClosePromise = new Promise(resolve => {
        this.isClosing = true;
        this.onClose = resolve;
        this.process();
      });
    }
    return this.onClosePromise;
  }

  async process() {
    if (this.isProcessing) return;

    this.isProcessing = true;
    let start = 0;
    while (true) {
      let newLinePos = this.buf.indexOf('\n', start);
      if (newLinePos >= 0) {
        // found a line
        const line = this.buf.substring(start, newLinePos);
        start = newLinePos + 1;
        await this._gotLine(line);
      } else if (this.isClosing) {
        // send the last line and resolve the onClosePromise by calling onClose
        await this._gotLine(this.buf.substring(start));
        this.onClose?.();
        break;
      } else {
        // no more lines for now
        this.buf = this.buf.substring(start);
        break;
      }
    }
    this.isProcessing = false;
  }

  // never throws
  async _gotLine(line: string) {
    try {
      await this.cb(undefined, line);
    } catch (error: any) {
      try {
        await this.cb(error, '');
      } catch (error2: any) {
        console.error(error2);
      }
    }
  }
}

export default InputProcessor;
