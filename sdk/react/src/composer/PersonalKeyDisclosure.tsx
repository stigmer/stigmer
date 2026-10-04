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
 * A conversation runs the version its session pinned, so when the host
 * names that version (`versionHash`) the keys come from the spec that
 * version stored, not from the agent's current one: an author's later
 * save that adds a key is not what this conversation's next message
 * runs. A version the history does not hold (an agent last written
 * before agents were versioned) reads the current spec; while the history
 * loads, or when it cannot be read, the line says nothing rather than
 * name another version's keys.
 *
 * Pinned by `__tests__/PersonalKeyDisclosure.test.tsx`.
 */

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceRef } from "@stigmer/sdk";
import { useAgent } from "../agent/useAgent.js";
import { useAgentVersions } from "../agent/useAgentVersions.js";

/** Props for {@link PersonalKeyDisclosure}. */
export interface PersonalKeyDisclosureProps {
  /** The agent the conversation is about to start on. */
  readonly agentRef: ResourceRef;
  /**
   * The version the conversation is pinned to, when it already has one:
   * the keys are read from that version's spec. Omitted for a
   * conversation not yet started, which pins the current version.
   */
  readonly versionHash?: string;
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
export function PersonalKeyDisclosure({
  agentRef,
  versionHash = "",
  className,
}: PersonalKeyDisclosureProps) {
  const { agent } = useAgent(agentRef.org || null, agentRef.slug || null);
  const pinned = versionHash !== "";
  const history = useAgentVersions(
    pinned ? agentRef.org || null : null,
    pinned ? agentRef.slug || null : null,
  );
  const historyUnknown = pinned && (history.isLoading || history.error !== null);
  const spec = historyUnknown
    ? undefined
    : ((pinned ? history.getSpec(versionHash) : null) ?? agent?.spec);
  const keys = useMemo(() => Object.keys(spec?.env ?? {}).sort(), [spec]);

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
