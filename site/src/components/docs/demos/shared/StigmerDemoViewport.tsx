"use client";

import type { ReactNode, RefObject } from "react";
import { DemoViewport, SCENAR_CLASS } from "@scenar/react";
import { DEMO_PLAYER_CLASSES, DEMO_SHELL_HEIGHT } from "./tokens";

interface StigmerDemoViewportProps {
  containerRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  className?: string;
}

/**
 * Stigmer-specific wrapper around Scenar's DemoViewport.
 *
 * Injects the `not-prose` class (MDX isolation), the canonical shell
 * height, the standard player wrapper classes, and the `scenar dark`
 * scope so `--scenar-*` tokens resolve for shell components.
 */
export function StigmerDemoViewport({
  containerRef,
  children,
  className,
}: StigmerDemoViewportProps) {
  const classes = `${SCENAR_CLASS} dark${className ? ` ${className}` : ""}`;

  return (
    <DemoViewport
      containerRef={containerRef}
      className={classes}
      wrapperClassName={DEMO_PLAYER_CLASSES}
      shellHeight={DEMO_SHELL_HEIGHT}
    >
      {children}
    </DemoViewport>
  );
}
