"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import forms from "@/styles/forms.module.css";

type ScrollableTableProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  tip?: string;
};

export function ScrollableTable({
  children,
  className,
  style,
  tip = "Tip: scroll horizontally to see all columns →",
}: ScrollableTableProps) {
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const [showTip, setShowTip] = useState(false);

  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) return;

    const updateScrollTip = () => {
      setShowTip(tableWrap.scrollWidth > tableWrap.clientWidth + 1);
    };

    updateScrollTip();
    window.addEventListener("resize", updateScrollTip);

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollTip);
    resizeObserver?.observe(tableWrap);

    return () => {
      window.removeEventListener("resize", updateScrollTip);
      resizeObserver?.disconnect();
    };
  }, [children]);

  return (
    <>
      {showTip ? <p className={forms.tableScrollTip}>{tip}</p> : null}
      <div ref={tableWrapRef} className={[forms.tableWrap, className].filter(Boolean).join(" ")} style={style}>
        {children}
      </div>
    </>
  );
}
