"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAskAiPanel, type AskAiPanelState } from "./useAskAiPanel";

const AskAiContext = createContext<AskAiPanelState | null>(null);

/**
 * Shares one Ask AI panel across its triggers. The docs chrome mounts the
 * trigger twice (sidebar header on desktop, navbar on mobile — the two
 * breakpoints have disjoint chrome), but there must be exactly one panel and
 * one embedded chat, so the state lives here rather than in either trigger.
 *
 * Must sit inside Fumadocs' `RootProvider`: the panel pins its theme from
 * `next-themes`, which `RootProvider` mounts.
 */
export function AskAiProvider({ children }: { children: ReactNode }) {
  const panel = useAskAiPanel();
  return <AskAiContext.Provider value={panel}>{children}</AskAiContext.Provider>;
}

export function useAskAi(): AskAiPanelState {
  const panel = useContext(AskAiContext);
  if (!panel) {
    throw new Error(
      "useAskAi must be used within <AskAiProvider> — wrap the docs layout " +
        "with it (see site/src/app/docs/layout.tsx).",
    );
  }
  return panel;
}
