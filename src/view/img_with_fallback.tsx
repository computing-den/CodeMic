import React, { useEffect, useRef, useState } from 'react';

type Props = { className?: string; src?: string; fallback: string };
export default function ImgWithFallback(props: Props) {
  // const { cache } = userAppContext();
  const ref = useRef<HTMLImageElement>(null);
  const [showFallback, setShowFallback] = useState(!props.src);

  useEffect(() => {
    if (!props.src) return;

    // ref.current!.onload = function () {
    //   setShowFallback(false);
    // };

    ref.current!.onerror = () => setShowFallback(true);
    return () => {
      if (ref.current) ref.current.onerror = null;
    };
  }, [props.src]);

  return <img className={props.className} src={showFallback ? props.fallback : props.src} ref={ref} />;
}
