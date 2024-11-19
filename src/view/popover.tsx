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
import { produce } from 'immer';
import { useClickOutsideHandler } from './hooks';

export type RenderProps = Instance & { onClose: () => void };
export type PopoverProps = RenderProps & { children: React.ReactNode };
export type Placement = 'top' | 'below' | 'left' | 'right';
export type HookArgs = {
  render: (props: RenderProps) => React.ReactNode;
  placement: Placement;
};

type Instance = HookArgs & {
  id: string;
  anchor: RefObject<HTMLElement>;
  isOpen: boolean;
};
type Instances = Record<string, Instance>;
type ContextValue = [Instances, Dispatch<SetStateAction<Instances>>];
type HookResult = {
  id: string;
  isOpen: boolean;
  anchor: RefObject<HTMLElement>;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setIsOpen: (v: boolean) => void;
};

const PopoverContext = createContext<ContextValue>([{}, () => {}]);

export function PopoverProvider(props: { children: React.ReactNode }) {
  const [popovers, setPopovers] = useState<Instances>({});
  const contextValue = useMemo<ContextValue>(() => [popovers, setPopovers], [popovers, setPopovers]);

  function close(id: string) {
    setPopovers(popovers =>
      produce(popovers, draft => {
        draft[id].isOpen = false;
      }),
    );
  }

  return (
    <PopoverContext.Provider value={contextValue}>
      {props.children}
      {Object.values(popovers).map(p => p.render({ ...p, onClose: () => close(p.id) }))}
    </PopoverContext.Provider>
  );
}

export function usePopover(args: HookArgs): HookResult {
  const [popovers, setPopovers] = useContext(PopoverContext);
  const [id] = useState(() => crypto.randomUUID());
  const anchor = useRef(null);
  const isOpen = Boolean(popovers[id]?.isOpen);

  function open() {
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
  }

  function toggle() {
    setIsOpen(!isOpen);
  }

  function setIsOpen(v: boolean) {
    setPopovers(popovers =>
      produce(popovers, draft => {
        draft[id].isOpen = v;
      }),
    );
  }

  useEffect(() => {
    setPopovers(popovers =>
      produce(popovers, draft => {
        draft[id] = { id, anchor, isOpen, ...args };
      }),
    );

    function cleanUp() {
      setPopovers(popovers =>
        produce(popovers, draft => {
          delete draft[id];
        }),
      );
    }

    return cleanUp;
  }, []);

  return { id, isOpen, anchor, open, close, toggle, setIsOpen };
}

export default function Popover(props: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutsideHandler({ popoverRef: ref, anchorRef: props.anchor, onClickOutside: props.onClose });

  // Update position.
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

    let req = requestAnimationFrame(updatePos);

    return () => cancelAnimationFrame(req);
  }, []);

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
