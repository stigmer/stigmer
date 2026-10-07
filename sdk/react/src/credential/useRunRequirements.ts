"use client";

/**
 * useRunRequirements: what a run of an agent needs, per declarer (the
 * agent's own keys, each MCP server's, each workspace repository host's),
 * read once per agent version and repository set. The assignments editor
 * lists these rows; the readiness hooks read them against what a surface
 * assigns or what a person holds.
 *
 * An MCP server that cannot be read is left out rather than failing the
 * read: the rows advise a surface's owner and must never block the
 * surface they advise. The server's own check at run create still names
 * any value that is missing.
 */
import { useMemo } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { readRunRequirements, type Requirement } from "./requirements.js";

/** Options for {@link useRunRequirements}. */
export interface UseRunRequirementsOptions {
  /** Repository URLs the run's workspace clones; each host brings its token. */
  readonly repositoryUrls?: readonly string[];
}

/** Return value of {@link useRunRequirements}. */
export interface UseRunRequirementsReturn {
  /** Every requirement, in declarer order; empty while loading or with no agent. */
  readonly requirements: readonly Requirement[];
  /** `true` while the agent's MCP servers are being read. */
  readonly isLoading: boolean;
  /** Error from the read, or `null`. */
  readonly error: Error | null;
}

const NONE: Requirement[] = [];

/**
 * Data hook that reads the requirements of a run of `agent`. Pass `null`
 * to skip.
 *
 * @example
 * ```tsx
 * const { requirements } = useRunRequirements(agent);
 * ```
 */
export function useRunRequirements(
  agent: Agent | null,
  options?: UseRunRequirementsOptions,
): UseRunRequirementsReturn {
  const stigmer = useStigmer();
  const agentKey = agent
    ? `${agent.metadata?.id ?? ""}@${agent.status?.audit?.specAudit?.updatedAt?.seconds ?? ""}`
    : "";
  const urls = options?.repositoryUrls;
  const urlsKey = (urls ?? []).join("\n");

  const { data, isLoading, error } = useFetch(
    agent
      ? async () =>
          (
            await readRunRequirements(stigmer, agent, {
              repositoryUrls: urlsKey === "" ? [] : urlsKey.split("\n"),
              unreadableServer: "skip",
            })
          ).requirements
      : null,
    [agentKey, urlsKey, stigmer],
    NONE,
  );

  return useMemo(
    () => ({ requirements: agent ? data : NONE, isLoading: agent !== null && isLoading, error }),
    [agent, data, isLoading, error],
  );
}
