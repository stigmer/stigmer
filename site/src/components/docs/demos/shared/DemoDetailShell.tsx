"use client";

import type { ReactNode } from "react";
import { DEMO_DETAIL_CLASSES } from "./tokens";
import { useDocsColorMode } from "./useDocsColorMode";

interface DemoDetailShellProps {
  children: ReactNode;
}

/**
 * Scoping container for standalone SDK component demos (detail views).
 *
 * Provides the `.stgm` theme scope and forwards the docs reader's
 * current color mode as `data-stgm-color-mode`, so the SDK component
 * inside follows the docs light/dark theme — the same wiring
 * `StigmerProvider` performs in a real host application.
 */
export function DemoDetailShell({ children }: DemoDetailShellProps) {
  const colorMode = useDocsColorMode();

  return (
    <div className={DEMO_DETAIL_CLASSES} data-stgm-color-mode={colorMode}>
      {children}
    </div>
  );
}
