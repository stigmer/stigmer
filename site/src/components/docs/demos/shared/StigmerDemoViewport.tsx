"use client";

import type { ReactNode, RefObject } from "react";
import { DemoViewport } from "@scenar/react";
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
 * height, and the standard player wrapper classes so individual
 * scenarios don't need to repeat Stigmer token plumbing.
 */
export function StigmerDemoViewport({
  containerRef,
  children,
  className,
}: StigmerDemoViewportProps) {
  return (
    <DemoViewport
      containerRef={containerRef}
      className={className}
      wrapperClassName={DEMO_PLAYER_CLASSES}
      shellHeight={DEMO_SHELL_HEIGHT}
    >
      {children}
    </DemoViewport>
  );
}
