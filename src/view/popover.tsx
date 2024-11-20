import React, {
  createContext,
  Dispatch,
  RefObject,
  SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useClickOutsideHandler } from './hooks';
import _ from 'lodash';
import assert from '../lib/assert';

export type RenderProps = PopoverData;
export type PopoverProps = RenderProps & { children: React.ReactNode };
export type HorizontalPlacement = 'left' | 'right' | 'center';
export type VerticalPlacement = 'above' | 'below';
export type PointXY = { x: number; y: number };
export type HookArgs = {
  render: (props: RenderProps) => React.ReactNode;
  pointOnPopover?: PointXY | PointName;
  pointOnAnchor?: PointXY | PointName;
  isOpen?: boolean;
};
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

type PopoverData = HookArgs & {
  id: string;
  anchor: RefObject<HTMLElement>;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setIsOpen: (v: boolean) => void;
  update: (recipe: ((popover: PopoverData) => PopoverData) | Partial<PopoverData>) => void;
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
      {Object.values(popovers).map(p => p.render(p))}
    </PopoverContext.Provider>
  );
}

/**
 * initArgs are only used during initialization and any changes to them
 * are ignored.
 */
export function usePopover(initArgs: HookArgs): PopoverData {
  const [popovers, setPopovers] = useContext(PopoverContext);
  const [id] = useState(() => crypto.randomUUID());
  const anchor = useRef<HTMLElement>(null);

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
      ...initArgs,
      id,
      isOpen: initArgs.isOpen ?? false,
      anchor,
      update,
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
    setPopovers(popovers => ({ ...popovers, [id]: popover }));

    return () => setPopovers(popovers => _.omit(popovers, id));
  }, []);

  return popover;
}

export default function Popover(props: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutsideHandler({ popoverRef: ref, anchorRef: props.anchor, onClickOutside: props.close });

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
  useEffect(() => {
    function updatePos() {
      if (ref.current && props.anchor.current) {
        const popoverRect = ref.current.getBoundingClientRect();
        const anchorRect = props.anchor.current.getBoundingClientRect();
        const pointOnAnchor = castPoint(props.pointOnAnchor ?? 'bottom-left');
        const pointOnPopover = castPoint(props.pointOnPopover ?? 'top-left');

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

      req = requestAnimationFrame(updatePos);
    }

    let req = 0;
    if (props.isOpen) requestAnimationFrame(updatePos);

    return () => cancelAnimationFrame(req);
  }, [props.isOpen, props.pointOnAnchor, props.pointOnPopover]);

  // function keyDown(e: React.KeyboardEvent) {
  //   if (e.key === 'Escape') {
  //     props.onClose();
  //   }
  // }

  return (
    <div id={props.id} ref={ref} className={`popover ${props.isOpen ? 'open' : ''}`} tabIndex={-1}>
      {props.children}
    </div>
  );
}

function castPoint(point: PointXY | PointName): PointXY {
  return typeof point === 'string' ? pointNameToXY[point] : point;
}
