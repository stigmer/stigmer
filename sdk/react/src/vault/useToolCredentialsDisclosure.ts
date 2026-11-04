"use client";

/**
 * When a surface's "Tool credentials" section is open: the one rule the
 * channel connect dialogs' section and the chat-link dialog's share.
 *
 * For an agent whose run uses tools, naming a vault is essential
 * configuration, not an advanced option, so the section is open at first
 * paint when the run is known to use tools or a vault is already named.
 * Whether a run uses tools can be known only once its subagents are read
 * (`useRunUsesTools`); when that reading lands `true` after the first
 * paint, the section opens then, once, unless the person has already
 * opened or shut it: their choice stands. It never shuts by itself. With
 * the reading cached across mounts, a late opening happens only on the
 * first reading of an agent's subagents.
 *
 * Internal: each section draws its own body.
 *
 * Pinned by the sections' tests (`ConnectSlackDialog.test.tsx`,
 * `ChatLinkDialog.test.tsx`).
 */

import { useCallback, useMemo, useState } from "react";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { useRunUsesTools } from "../agent/useRunUsesTools.js";

/** Return value of {@link useToolCredentialsDisclosure}. */
export interface ToolCredentialsDisclosure {
  /** Whether the section is open. */
  readonly expanded: boolean;
  /** The person opens or shuts the section; from then on, only they do. */
  readonly toggle: () => void;
}

/**
 * Behaviour hook for a "Tool credentials" section of `agent`'s surface;
 * `hasVaults` is whether the surface names a vault when the section mounts.
 */
export function useToolCredentialsDisclosure(agent: Agent, hasVaults: boolean): ToolCredentialsDisclosure {
  const usesTools = useRunUsesTools(agent);
  const [expanded, setExpanded] = useState(usesTools === true || hasVaults);
  // Settled once the person opens or shuts it, or it has opened by itself.
  const [settled, setSettled] = useState(false);

  // The reading landed after the first paint: open, once, during this
  // render, so the section never paints shut first.
  if (usesTools === true && !expanded && !settled) {
    setExpanded(true);
    setSettled(true);
  }

  const toggle = useCallback(() => {
    setSettled(true);
    setExpanded((open) => !open);
  }, []);

  return useMemo(() => ({ expanded, toggle }), [expanded, toggle]);
}
