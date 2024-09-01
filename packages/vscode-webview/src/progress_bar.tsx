import { types as t, lib, path } from '@codecast/lib';
import { cn } from './misc.js';
import { h, Fragment, Component } from 'preact';

export type Props = {
  className?: string;
  onSeek: (clock: number) => unknown;
  duration: number;
  clock: number;
  editorTrackFocusTimeline?: t.EditorTrackFocusTimeline;
};

export default class ProgressBar extends Component<Props> {
  ref?: Element;

  state = {
    clockUnderMouse: undefined as number | undefined,
    documentFocusUnderMouse: undefined as t.DocumentFocus | undefined,
    lineFocusUnderMouse: undefined as t.LineFocus | undefined,
  };

  setRef = (elem: Element | null) => {
    this.ref = elem || undefined;
  };

  clicked = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const clock = this.getClockOfMouse(e);
    this.props.onSeek(clock);
  };

  mouseMoved = (e: MouseEvent) => {
    if (this.isMouseOnProgressBar(e)) {
      const p = this.getPosNormOfMouse(e);
      const clock = this.props.duration * p;

      const shadow = this.ref!.querySelector('.shadow') as HTMLElement;
      shadow.style.height = `${p * 100}%`;

      const popover = this.ref!.querySelector('.popover') as HTMLElement;
      popover.style.top = `${p * 100}%`;

      const documentFocus = this.props.editorTrackFocusTimeline?.documents.find(x =>
        lib.isClockInRange(clock, x.clockRange),
      );
      const lineFocus = this.props.editorTrackFocusTimeline?.lines.find(x => lib.isClockInRange(clock, x.clockRange));

      this.setState({ clockUnderMouse: clock, documentFocusUnderMouse: documentFocus, lineFocusUnderMouse: lineFocus });
    }
  };

  getClockOfMouse = (e: MouseEvent): number => {
    return this.props.duration * this.getPosNormOfMouse(e);
  };

  getPosNormOfMouse = (e: MouseEvent): number => {
    const rect = this.ref!.getBoundingClientRect();
    return (e.clientY - rect.y) / rect.height;
  };

  isMouseOnProgressBar = (e: MouseEvent): boolean => {
    if (!this.ref) return false;
    const rect = this.ref.getBoundingClientRect();
    const p = [e.clientX - rect.x, e.clientY - rect.y];
    return p[0] >= 0 && p[0] <= rect.width && p[1] >= 0 && p[1] <= rect.height;
  };

  componentDidMount() {
    document.addEventListener('mousemove', this.mouseMoved);
  }

  componentWillUnmount() {
    document.removeEventListener('mousemove', this.mouseMoved);
  }

  render() {
    const { clockUnderMouse, documentFocusUnderMouse, lineFocusUnderMouse } = this.state;
    const filledStyle = { height: `${(this.props.clock / this.props.duration) * 100}%` };

    return (
      <div className={cn('progress-bar', this.props.className)} ref={this.setRef} onClick={this.clicked}>
        <div className="bar">
          <div className="shadow" />
          <div className="popover">
            <div className="row">
              <div className="document-focus">
                {documentFocusUnderMouse ? path.getUriShortNameOpt(documentFocusUnderMouse.uri) : '<unknown file>'}
              </div>
              <div className="clock">{lib.formatTimeSeconds(clockUnderMouse ?? 0)}</div>
            </div>
            <div className="line-focus">{lineFocusUnderMouse?.text || '<unknown text>'}</div>
          </div>
          <div className="filled" style={filledStyle} />
        </div>
      </div>
    );
  }
}
