"use client";

/**
 * The spec of the agent version a conversation's next message runs.
 *
 * A conversation runs the version its session pinned, so when the caller
 * names that version (`versionHash`) the spec is the one that version
 * stored, read by the agent's id and the hash, not the agent's current
 * one: an author's later save is not what this conversation runs. A
 * version the agent does not hold (one last written before agents were
 * versioned) reads the current spec; while the version loads, or when it
 * cannot be read, the spec is `undefined` rather than another version's.
 * With no `versionHash` the next message starts the agent fresh, on its
 * current version.
 *
 * Readers: the personal-key disclosure (the keys the version declares) and
 * the conversation flows (the run defaults the version carries).
 *
 * Pinned through `composer/__tests__/PersonalKeyDisclosure.test.tsx` and
 * the flow tests that read run defaults.
 */

import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { GetAgentVersionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import { isNotFound, type ResourceRef } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { useAgent } from "./useAgent.js";

/** The pinned version's spec: absent when the agent holds no such version. */
type PinnedSpec =
  | { readonly kind: "spec"; readonly spec: AgentSpec | undefined }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown" };

/**
 * The not-yet-known answer, one reference for every render: the fetch
 * resets to its initial value whenever its inputs change, and a fresh
 * literal there would be a new state each time, re-rendering forever.
 */
const UNKNOWN: PinnedSpec = { kind: "unknown" };

/** Return value of {@link useRunAgentSpec}. */
export interface UseRunAgentSpecReturn {
  /** The agent as it is now; `null` with no agent, while loading, or when it cannot be read. */
  readonly agent: Agent | null;
  /** The spec of the version the next message runs; `undefined` until it is known. */
  readonly spec: AgentSpec | undefined;
  /** `true` while the agent itself is being read. */
  readonly isLoading: boolean;
}

/**
 * Reads the spec of the version of `agentRef` a conversation's next
 * message runs. `null` reads nothing (no agent, or a surface that may not
 * read it).
 *
 * @example
 * ```tsx
 * const { spec } = useRunAgentSpec(agentRef, session.status?.agentVersionHash);
 * ```
 */
export function useRunAgentSpec(
  agentRef: ResourceRef | null,
  versionHash = "",
): UseRunAgentSpecReturn {
  const stigmer = useStigmer();
  const { agent, isLoading } = useAgent(agentRef?.org || null, agentRef?.slug || null);
  const agentId = agent?.metadata?.id ?? "";
  const pinned = versionHash !== "";
  const { data: pinnedSpec } = useFetch<PinnedSpec>(
    pinned && agentId !== ""
      ? async () => {
          try {
            const entry = await stigmer.agent.getVersion(
              create(GetAgentVersionInputSchema, { agentId, versionHash }),
            );
            return { kind: "spec", spec: entry.specSnapshot };
          } catch (err) {
            return isNotFound(err) ? { kind: "absent" } : { kind: "unknown" };
          }
        }
      : null,
    [pinned, agentId, versionHash, stigmer],
    UNKNOWN,
  );
  const spec = !pinned
    ? agent?.spec
    : pinnedSpec.kind === "spec"
      ? pinnedSpec.spec
      : pinnedSpec.kind === "absent"
        ? agent?.spec
        : undefined;
  return { agent, spec, isLoading };
}
