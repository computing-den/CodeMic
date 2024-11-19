import { Dispatch, RefObject, SetStateAction, useEffect } from 'react';

type ClickOutsideProps = {
  popoverRef: RefObject<HTMLElement>;
  anchorRef: RefObject<HTMLElement>;
  onClickOutside: (event: MouseEvent) => any;
};

export function useClickOutsideHandler({ popoverRef, anchorRef, onClickOutside }: ClickOutsideProps) {
  const handleClickOutside = (event: MouseEvent) => {
    if (
      popoverRef.current &&
      !popoverRef.current.contains(event.target as Node) &&
      anchorRef.current &&
      !anchorRef.current.contains(event.target as Node)
    ) {
      onClickOutside(event);
    }
  };

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
}
