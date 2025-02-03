import React, { useEffect, useRef, useState } from 'react';

type Props = { className?: string; src?: string; fallback: string };
export default function ImgWithFallback(props: Props) {
  // const { cache } = userAppContext();
  const ref = useRef<HTMLImageElement>(null);
  const prevSrcRef = useRef(props.src);
  const [showFallback, setShowFallback] = useState(!props.src);

  useEffect(() => {
    if (prevSrcRef.current !== props.src) {
      setShowFallback(!props.src);
      prevSrcRef.current = props.src;
    }

    ref.current!.onerror = () => setShowFallback(true);
    return () => {
      if (ref.current) ref.current.onerror = null;
    };
  }, [props.src]);

  return <img className={props.className} src={showFallback ? props.fallback : props.src} ref={ref} />;
}
