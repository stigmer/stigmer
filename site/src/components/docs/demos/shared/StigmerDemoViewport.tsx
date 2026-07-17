"use client";

import type { ReactNode, RefObject } from "react";
import { DemoViewport, SCENAR_CLASS } from "@scenar/react";
import {
  DEMO_CANONICAL_WIDTH,
  DEMO_MIN_VIEWPORT_ZOOM,
  DEMO_PLAYER_CLASSES,
  DEMO_SHELL_HEIGHT,
} from "./tokens";
import { useDocsColorMode } from "./useDocsColorMode";

interface StigmerDemoViewportProps {
  containerRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  className?: string;
}

/**
 * Stigmer-specific wrapper around Scenar's DemoViewport.
 *
 * Injects the `not-prose` class (MDX isolation), the canonical shell
 * height, the standard player wrapper classes, and the `scenar` scope
 * so `--scenar-*` tokens resolve for shell components. The `dark`
 * modifier follows the docs reader's theme so the player chrome
 * matches the demo content inside it.
 *
 * All sizing (canonical width, minimum zoom, shell height) is passed
 * explicitly from `tokens.ts` so that file is the single source of
 * truth — never rely on `DemoViewport`'s internal defaults, which
 * could drift across Scenar releases.
 */
export function StigmerDemoViewport({
  containerRef,
  children,
  className,
}: StigmerDemoViewportProps) {
  const colorMode = useDocsColorMode();
  const classes = `${SCENAR_CLASS}${colorMode === "dark" ? " dark" : ""}${className ? ` ${className}` : ""}`;

  return (
    <DemoViewport
      containerRef={containerRef}
      className={classes}
      wrapperClassName={DEMO_PLAYER_CLASSES}
      canonicalWidth={DEMO_CANONICAL_WIDTH}
      minZoom={DEMO_MIN_VIEWPORT_ZOOM}
      shellHeight={DEMO_SHELL_HEIGHT}
    >
      {children}
    </DemoViewport>
  );
}
