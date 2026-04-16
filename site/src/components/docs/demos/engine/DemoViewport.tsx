"use client";

import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { useVideoExport } from "./VideoExportContext";
import {
  DEMO_CANONICAL_WIDTH,
  DEMO_MIN_VIEWPORT_ZOOM,
  DEMO_PLAYER_CLASSES,
  DEMO_SHELL_HEIGHT,
} from "../shared/tokens";

interface DemoViewportProps {
  /**
   * Ref applied to the canonical-size inner div. Scenarios pass
   * this same ref to `<Cursor>` and `useStepInteractions` so that
   * cursor positions and scroll queries resolve against stable
   * internal dimensions.
   *
   * Optional — scenarios without cursor or scroll interactions
   * (e.g. simple playbacks) can omit it.
   */
  containerRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  className?: string;
}

/**
 * Fixed virtual viewport for interactive demos.
 *
 * Renders children at a canonical 896-wide layout and applies CSS
 * `zoom` to scale into the available page width. This guarantees
 * that cursor positions, scroll offsets, and interaction targets
 * are computed against stable internal dimensions regardless of
 * the browser viewport.
 *
 * In video-export mode the component is a transparent passthrough —
 * `DemoVideo.tsx` owns the viewport sizing and zoom.
 */
export function DemoViewport({ containerRef, children, className }: DemoViewportProps) {
  const { isVideoExport } = useVideoExport();
  const outerRef = useRef<HTMLDivElement>(null);
  const internalRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  const innerRef = containerRef ?? internalRef;

  useEffect(() => {
    if (isVideoExport) return;
    const outer = outerRef.current;
    if (!outer) return;

    const update = (entries: ResizeObserverEntry[]) => {
      const width = entries[0].contentRect.width;
      setZoom(Math.max(Math.min(width / DEMO_CANONICAL_WIDTH, 1), DEMO_MIN_VIEWPORT_ZOOM));
    };

    const ro = new ResizeObserver(update);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [isVideoExport]);

  const classes = className ? `${DEMO_PLAYER_CLASSES} ${className}` : DEMO_PLAYER_CLASSES;

  if (isVideoExport) {
    return (
      <div ref={innerRef} className={classes}>
        {children}
      </div>
    );
  }

  return (
    <div ref={outerRef} className={classes}>
      <div
        ref={innerRef}
        className="relative"
        style={{
          width: DEMO_CANONICAL_WIDTH,
          zoom,
          "--demo-shell-height": `${DEMO_SHELL_HEIGHT}px`,
        } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}
