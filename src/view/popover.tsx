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

export type RenderProps = PopoverData;
export type PopoverProps = RenderProps & { children: React.ReactNode };
export type Placement = 'top' | 'below' | 'left' | 'right';
export type HookArgs = {
  render: (props: RenderProps) => React.ReactNode;
  placement: Placement;
};
type PopoverData = HookArgs & {
  id: string;
  anchor: RefObject<HTMLElement>;
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
    function update(recipe: (popover: PopoverData) => PopoverData) {
      setPopovers(popovers => ({ ...popovers, [id]: recipe(popovers[id]) }));
    }

    popover = {
      ...initArgs,
      id,
      isOpen: false,
      anchor,
      open() {
        update(popover => ({ ...popover, isOpen: true }));
      },
      close() {
        update(popover => ({ ...popover, isOpen: false }));
      },
      toggle() {
        update(popover => ({ ...popover, isOpen: !popover.isOpen }));
      },
      setIsOpen(v: boolean) {
        update(popover => ({ ...popover, isOpen: v }));
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
  useEffect(() => {
    function updatePos() {
      if (ref.current && props.anchor.current) {
        // TODO use props.placement
        const rect = props.anchor.current.getBoundingClientRect();
        ref.current.style.top = `${rect.bottom}px`;
        ref.current.style.left = `${rect.left}px`;
      }

      req = requestAnimationFrame(updatePos);
    }

    let req = 0;
    if (props.isOpen) requestAnimationFrame(updatePos);

    return () => cancelAnimationFrame(req);
  }, [props.isOpen]);

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
