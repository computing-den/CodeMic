import React, {
  createContext,
  Dispatch,
  RefObject,
  SetStateAction,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useClickOutsideHandler } from './hooks.js';
import _ from 'lodash';
import assert from '../lib/assert.js';
import ReactDOM from 'react-dom';

export type HorizontalPlacement = 'left' | 'right' | 'center';
export type VerticalPlacement = 'above' | 'below';
export type PointXY = { x: number; y: number };
// export type HookArgs = {
//   // render: (props: RenderProps) => React.ReactNode;

// };
export type PointName = keyof typeof pointNameToXY;
export const pointNameToXY = {
  'top-left': { x: 0, y: 0 },
  'top-center': { x: 0.5, y: 0 },
  'top-right': { x: 1, y: 0 },
  'center-right': { x: 1, y: 0.5 },
  'bottom-right': { x: 1, y: 1 },
  'bottom-center': { x: 0.5, y: 1 },
  'bottom-left': { x: 0, y: 1 },
  'center-left': { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
} as const;
export const pointNames = Object.keys(pointNameToXY) as PointName[];

export type PopoverData = {
  id: string;
  // anchor: RefObject<HTMLElement>;
  // ref: RefObject<HTMLElement>
  // content: React.ReactNode;
  // pointOnPopover: PointXY | PointName;
  // pointOnAnchor: PointXY | PointName;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setIsOpen: (v: boolean) => void;
};
type PopoversData = Record<string, PopoverData>;
type ContextValue = [PopoversData, Dispatch<SetStateAction<PopoversData>>];

const PopoverContext = createContext<ContextValue>([{}, () => {}]);

export function PopoverProvider(props: { children: React.ReactNode }) {
  const [popovers, setPopovers] = useState<PopoversData>({});
  const contextValue = useMemo<ContextValue>(() => [popovers, setPopovers], [popovers, setPopovers]);

  return (
    <PopoverContext.Provider value={contextValue}>
      {props.children}
      {/*Object.values(popovers).map(p => p.content)*/}
    </PopoverContext.Provider>
  );
}

/**
 * initArgs are only used during initialization and any changes to them
 * are ignored.
 */
export function usePopover(): PopoverData {
  const [popovers, setPopovers] = useContext(PopoverContext);
  const [id] = useState(() => crypto.randomUUID());

  // Get or create popover.
  let popover = popovers[id];
  if (!popover) {
    function update(recipe: ((popover: PopoverData) => PopoverData) | Partial<PopoverData>) {
      setPopovers(popovers => {
        const popover = typeof recipe === 'function' ? recipe(popovers[id]) : { ...popovers[id], ...recipe };
        assert(popover.id === id);
        return { ...popovers, [id]: popover };
      });
    }

    popover = {
      id,
      isOpen: false,
      open() {
        update({ isOpen: true });
      },
      close() {
        update({ isOpen: false });
      },
      toggle() {
        update(popover => ({ ...popover, isOpen: !popover.isOpen }));
      },
      setIsOpen(v: boolean) {
        update({ isOpen: v });
      },
    };
  }

  // Add it to popovers on mount and remove it on unmount.
  useEffect(() => {
    // Avoid calling setPopovers to prevent re-rendering.
    setPopovers(popovers => ({ ...popovers, [id]: popover }));

    return () => setPopovers(popovers => _.omit(popovers, id));
  }, []);

  return popover;
}

// export function popoverPortal(node: React.ReactNode) {
//   ReactDOM.createPortal(<SpeedControlPopover popover={slowDownPopover}
//                            onConfirm={slowDown} title="Slow down"
//     />, ref.current)
// }

export type PopoverProps = {
  className?: string;
  popover: PopoverData;
  anchor: RefObject<HTMLElement>;
  pointOnPopover?: PointXY | PointName;
  pointOnAnchor?: PointXY | PointName;
  children?: React.ReactNode;
  showOnAnchorHover?: boolean;
};
export default function Popover(props: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutsideHandler({ popoverRef: ref, anchorRef: props.anchor, onClickOutside: props.popover.close });

  const isOpen = props.popover.isOpen;
  const pointOnAnchor = castPoint(props.pointOnAnchor ?? 'bottom-left');
  const pointOnPopover = castPoint(props.pointOnPopover ?? 'top-left');

  // Update position when isOpen.
  //  _____________
  // |             |
  // |             |            Anchor
  // |   (.5, 1)   |
  // |______X______|______
  //        | (0, 0)      |
  //        |             |
  //        |             |     Popover
  //        |_____________|
  //
  useLayoutEffect(() => {
    function updatePosContinuously() {
      if (ref.current && props.anchor.current) {
        const popoverRect = ref.current.getBoundingClientRect();
        const anchorRect = props.anchor.current.getBoundingClientRect();

        const left = anchorRect.left + anchorRect.width * pointOnAnchor.x - popoverRect.width * pointOnPopover.x;
        const top = anchorRect.top + anchorRect.height * pointOnAnchor.y - popoverRect.height * pointOnPopover.y;

        // Clip.
        // There should be a maximum shift beyond which we must not push the popover.
        // Otherwise, while scrolling down for example, a popover can get stuck at
        // the top of the window.
        if (left + popoverRect.width > document.documentElement.clientWidth) {
          // TODO Shift to the left
        }
        if (left < 0) {
          // TODO Shift to the right
        }
        if (top + popoverRect.height > document.documentElement.clientHeight) {
          // TODO Shift to the top
        }
        if (top < 0) {
          // TODO Shift to the bottom
        }

        ref.current.style.left = `${left}px`;
        ref.current.style.top = `${top}px`;
      }

      req = requestAnimationFrame(updatePosContinuously);
    }

    let req = 0;
    if (isOpen) updatePosContinuously();

    return () => cancelAnimationFrame(req);
  }, [isOpen, pointOnAnchor, pointOnPopover]);

  useEffect(() => {
    let timeoutId = 0;
    function mouseOver(e: MouseEvent) {
      timeoutId++;
      props.popover.open();
    }
    function mouseOut(e: MouseEvent) {
      const id = timeoutId;
      setTimeout(() => {
        if (id === timeoutId) {
          props.popover.close();
        }
      }, 500);
    }

    const elem = props.anchor.current;
    if (props.showOnAnchorHover && elem) {
      elem.addEventListener('mouseover', mouseOver);
      elem.addEventListener('mouseout', mouseOut);
      return () => {
        timeoutId++;
        elem.removeEventListener('mouseover', mouseOver);
        elem.removeEventListener('mouseout', mouseOut);
      };
    }
  }, [props.showOnAnchorHover, props.anchor.current]);

  // function keyDown(e: React.KeyboardEvent) {
  //   if (e.key === 'Escape') {
  //     props.onClose();
  //   }
  // }

  return ReactDOM.createPortal(
    <div
      id={props.popover.id}
      ref={ref}
      className={`popover ${props.popover.isOpen ? 'open' : ''} ${props.className || ''}`}
      tabIndex={-1}
    >
      {props.children}
    </div>,
    document.getElementById('popovers')!,
    props.popover.id,
  );
}

function castPoint(point: PointXY | PointName): PointXY {
  return typeof point === 'string' ? pointNameToXY[point] : point;
}
