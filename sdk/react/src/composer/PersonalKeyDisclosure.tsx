"use client";

/**
 * The line that names which keys an agent will read from the person's
 * personal environment, shown before the first message of a conversation
 * on that agent.
 *
 * Every run of an agent fills the keys the agent declares
 * (`agent.spec.env`) from the running person's personal environment, so
 * starting a conversation hands the agent those values. The person is
 * told which keys before sending, from the declarations the agent
 * already publishes. It is a disclosure, not a gate: nothing is withheld
 * and nothing is asked. An agent that declares no keys, or one the viewer
 * cannot read, renders nothing.
 *
 * Pinned by `__tests__/PersonalKeyDisclosure.test.tsx`.
 */

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceRef } from "@stigmer/sdk";
import { useAgent } from "../agent/useAgent.js";

/** Props for {@link PersonalKeyDisclosure}. */
export interface PersonalKeyDisclosureProps {
  /** The agent the conversation is about to start on. */
  readonly agentRef: ResourceRef;
  /** Additional CSS classes for the line. */
  readonly className?: string;
}

/**
 * Names the keys `agentRef` declares, in the order a reader scans them
 * (sorted), as the keys the agent can read from the person's personal
 * environment.
 *
 * @example
 * ```tsx
 * <PersonalKeyDisclosure agentRef={{ org: "acme", slug: "pr-reviewer" }} />
 * // This agent can read these keys from your personal environment: GITHUB_TOKEN, LINEAR_API_KEY
 * ```
 */
export function PersonalKeyDisclosure({ agentRef, className }: PersonalKeyDisclosureProps) {
  const { agent } = useAgent(agentRef.org || null, agentRef.slug || null);
  const keys = useMemo(
    () => Object.keys(agent?.spec?.env ?? {}).sort(),
    [agent],
  );

  if (keys.length === 0) return null;

  return (
    <p
      data-testid="personal-key-disclosure"
      className={cn("stg:text-xs stg:text-muted-foreground", className)}
    >
      This agent can read these keys from your personal environment:{" "}
      <span className="stg:font-mono">{keys.join(", ")}</span>
    </p>
  );
}
