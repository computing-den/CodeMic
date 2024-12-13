import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import * as path from '../lib/path.js';
import { cn } from './misc.js';
import React, { useEffect, useRef, useState } from 'react';
import Popover, { PointXY, PopoverProps, usePopover } from './popover.jsx';

export type Props = {
  className?: string;
  onSeek: (clock: number) => unknown;
  duration: number;
  clock: number;
  workspaceFocusTimeline?: t.Focus[];
  toc: t.TocItem[];
};

type UnderMouse = {
  clock: number;
  yNorm: number;
  focus?: t.Focus;
};

export default function ProgressBar(props: Props) {
  const [underMouse, setUnderMouse] = useState<UnderMouse>();
  const ref = useRef<HTMLDivElement>(null);
  const focusPopover = usePopover();

  async function clicked(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const clock = props.duration * getPosNormOfMouse(e.nativeEvent);
    props.onSeek(clock);
  }

  useEffect(() => {
    function mouseMoved(e: MouseEvent) {
      if (isMouseOnProgressBar(e)) {
        const yNorm = getPosNormOfMouse(e);
        const clock = props.duration * yNorm;

        // const popover = ref.current!.querySelector('.focus-popover') as HTMLElement;
        // const popoverRect = popover.getBoundingClientRect();
        // const barRect = ref.current!.getBoundingClientRect();
        // const spaceLeftAtBottom = barRect.height - e.clientY;
        // const popoverMinMargin = 5;
        // if (spaceLeftAtBottom < popoverRect.height + popoverMinMargin) {
        //   popover.style.top = `${barRect.height - popoverRect.height - popoverMinMargin}px`;
        // } else {
        //   popover.style.top = `${yNorm * 100}%`;
        // }

        const focus = lib.findFocusByClock(props.workspaceFocusTimeline ?? [], clock);

        setUnderMouse({ yNorm, clock, focus });
      }
    }

    document.addEventListener('mousemove', mouseMoved);
    return () => document.removeEventListener('mousemove', mouseMoved);
  }, []);

  function getPosNormOfMouse(e: MouseEvent): number {
    const rect = ref.current!.getBoundingClientRect();
    return (e.clientY - rect.y) / rect.height;
  }

  function isMouseOnProgressBar(e: MouseEvent): boolean {
    if (!ref) return false;
    const rect = ref.current!.getBoundingClientRect();
    const yNorm = [e.clientX - rect.x, e.clientY - rect.y];
    return yNorm[0] >= 0 && yNorm[0] <= rect.width && yNorm[1] >= 0 && yNorm[1] <= rect.height;
  }

  const filledStyle = { height: `${(props.clock / props.duration) * 100}%` };
  const tocIndicators = props.toc.map(item => ({
    top: `${(item.clock / props.duration) * 100}%`,
  }));

  return (
    <div className={cn('progress-bar', props.className)} ref={ref}>
      <Popover
        popover={focusPopover}
        className="progress-bar-focus-popover"
        anchor={ref}
        pointOnPopover="center-right"
        pointOnAnchor={{ x: 0.4, y: underMouse?.yNorm ?? 0 }}
        showOnAnchorHover
      >
        <div className="row">
          <div className="document-focus">{underMouse?.focus ? path.getUriShortNameOpt(underMouse.focus.uri) : ''}</div>
          <div className="clock">{lib.formatTimeSeconds(underMouse?.clock ?? 0)}</div>
        </div>
        <div className="line-focus">{underMouse?.focus?.text || ''}</div>
      </Popover>
      <div className="bar" onClick={clicked}>
        <div className="shadow" style={{ height: `${(underMouse?.yNorm ?? 0) * 100}%` }} />
        <div className="filled" style={filledStyle} />
        {tocIndicators.map(item => (
          <div className="toc-item" style={item} />
        ))}
      </div>
    </div>
  );
}
