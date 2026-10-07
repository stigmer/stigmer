"use client";

/**
 * The line that names which of the person's own keys an agent's run will
 * receive, shown before the first message of a conversation on that agent.
 *
 * A run takes each value it needs from the running person's own
 * credential serving the declarer (the agent, or one of its MCP servers)
 * before anything of the organization's, so starting a conversation hands
 * the agent those values. The person is told which keys before sending.
 * It is a disclosure, not a gate: nothing is withheld and nothing is
 * asked. An agent that takes none of the person's keys, or one the viewer
 * cannot read, renders nothing.
 *
 * A conversation runs the version its session pinned, so when the host
 * names that version (`versionHash`) the keys come from the spec that
 * version stored (read by the agent's id and the hash), not from the
 * agent's current one: an author's later save that adds a key is not
 * what this conversation's next message runs. A version the agent does
 * not hold (one last written before agents were versioned) reads the
 * current spec; while the version loads, or when it cannot be read, the
 * line says nothing rather than name another version's keys.
 *
 * The keys are the ones the server would fill from the person's own
 * credentials in the conversation's organization (`runOrg`), read by
 * usePersonalKeys.
 *
 * Pinned by `__tests__/PersonalKeyDisclosure.test.tsx`.
 */

import { cn } from "@stigmer/theme";
import type { ResourceRef } from "@stigmer/sdk";
import { useRunAgentSpec } from "../agent/useRunAgentSpec.js";
import { usePersonalKeys } from "../agent/usePersonalKeys.js";

/** Props for {@link PersonalKeyDisclosure}. */
export interface PersonalKeyDisclosureProps {
  /** The agent the conversation is about to start on. */
  readonly agentRef: ResourceRef;
  /**
   * The organization the conversation runs in, by id: the person's
   * credentials there are the ones a run reads.
   */
  readonly runOrg: string;
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
 * Names the keys a run of `agentRef` takes from the person's own
 * credentials, in the order a reader scans them (sorted).
 *
 * @example
 * ```tsx
 * <PersonalKeyDisclosure agentRef={{ org: "acme", slug: "pr-reviewer" }} runOrg="org_acme" />
 * // This agent's runs use these keys of yours: GITHUB_TOKEN, LINEAR_API_KEY
 * ```
 */
export function PersonalKeyDisclosure({
  agentRef,
  runOrg,
  versionHash = "",
  className,
}: PersonalKeyDisclosureProps) {
  const { agent, spec } = useRunAgentSpec(agentRef, versionHash);
  const { keys } = usePersonalKeys(agent ?? null, spec, runOrg);

  if (keys.length === 0) return null;

  return (
    <p
      data-testid="personal-key-disclosure"
      className={cn("stg:text-xs stg:text-muted-foreground", className)}
    >
      This agent&apos;s runs use these keys of yours:{" "}
      <span className="stg:font-mono">{keys.join(", ")}</span>
    </p>
  );
}
