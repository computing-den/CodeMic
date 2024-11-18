import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import * as path from '../lib/path.js';
import { cn } from './misc.js';
import React from 'react';

export type Props = {
  className?: string;
  onSeek: (clock: number) => unknown;
  duration: number;
  clock: number;
  workspaceFocusTimeline?: t.WorkspaceFocusTimeline;
  toc: t.TocItem[];
};

export default class ProgressBar extends React.Component<Props> {
  ref?: Element;

  state = {
    clockUnderMouse: undefined as number | undefined,
    documentFocusUnderMouse: undefined as t.DocumentFocus | undefined,
    lineFocusUnderMouse: undefined as t.LineFocus | undefined,
  };

  setRef = (elem: Element | null) => {
    this.ref = elem || undefined;
  };

  clicked = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const clock = this.getClockOfMouse(e.nativeEvent);
    this.props.onSeek(clock);
  };

  mouseMoved = (e: MouseEvent) => {
    if (this.isMouseOnProgressBar(e)) {
      const p = this.getPosNormOfMouse(e);
      const clock = this.props.duration * p;

      const shadow = this.ref!.querySelector('.shadow') as HTMLElement;
      shadow.style.height = `${p * 100}%`;

      const popover = this.ref!.querySelector('.popover') as HTMLElement;
      const popoverRect = popover.getBoundingClientRect();
      const barRect = this.ref!.getBoundingClientRect();
      const spaceLeftAtBottom = barRect.height - e.clientY;
      const popoverMinMargin = 5;
      if (spaceLeftAtBottom < popoverRect.height + popoverMinMargin) {
        popover.style.top = `${barRect.height - popoverRect.height - popoverMinMargin}px`;
      } else {
        popover.style.top = `${p * 100}%`;
      }

      const documentFocus = this.props.workspaceFocusTimeline?.documents.find(x =>
        lib.isClockInRange(clock, x.clockRange),
      );
      const lineFocus = this.props.workspaceFocusTimeline?.lines.find(x => lib.isClockInRange(clock, x.clockRange));

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
    const tocIndicators = this.props.toc.map(item => ({
      top: `${(item.clock / this.props.duration) * 100}%`,
    }));

    return (
      <div className={cn('progress-bar', this.props.className)} ref={this.setRef}>
        <div className="popover">
          <div className="row">
            <div className="document-focus">
              {documentFocusUnderMouse ? path.getUriShortNameOpt(documentFocusUnderMouse.uri) : '...'}
            </div>
            <div className="clock">{lib.formatTimeSeconds(clockUnderMouse ?? 0)}</div>
          </div>
          <div className="line-focus">{lineFocusUnderMouse?.text || '...'}</div>
        </div>
        <div className="bar" onClick={this.clicked}>
          <div className="shadow" />
          <div className="filled" style={filledStyle} />
          {tocIndicators.map(item => (
            <div className="toc-item" style={item} />
          ))}
        </div>
      </div>
    );
  }
}
