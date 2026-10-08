"use client";

/**
 * The agent version a conversation runs, beside the version its agent is
 * at now, and the one act that moves the conversation forward.
 *
 * A session pins the version of its agent it started on
 * (`session.status.agentVersionHash`), so an author's later save never
 * changes an open conversation under the person in it. This hook reads
 * that pin and the agent's current version (`agent.status.versionHash`)
 * and reports the conversation outdated when the two differ; moving it is
 * the caller's explicit act ({@link UseSessionAgentVersionReturn.update}),
 * never a side effect of reading.
 *
 * The agent is read by the id the session pinned (`status.agentId`), not
 * by its slug: a slug deleted and taken by another agent must not make a
 * live conversation look outdated against an agent it never ran. Labels
 * come from the agent's version history (a tag where the version has
 * one, else a short hash), read once per agent. An agent the viewer can
 * no longer read, or one deleted since, reports nothing outdated.
 *
 * Pinned by `__tests__/useSessionAgentVersion.test.tsx`.
 */

import { useCallback, useMemo, useState } from "react";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { toError } from "../internal/toError.js";
import { agentVersionLabel, useAgentVersions } from "../agent/useAgentVersions.js";
import { usePersonalKeys } from "../agent/usePersonalKeys.js";

/** Options for {@link useSessionAgentVersion}. */
export interface UseSessionAgentVersionOptions {
  /**
   * Whether to read the agent at all. `false` (the guest audience, whose
   * token cannot read the agent) reports an agent-less, never-outdated
   * state and makes no request.
   */
  readonly enabled: boolean;
  /**
   * Moves the session to its agent's current version and reads it again;
   * `useSessionConversation`'s `moveToCurrentAgentVersion`.
   */
  readonly moveToCurrentVersion: () => Promise<void>;
}

/** Return value of {@link useSessionAgentVersion}. */
export interface UseSessionAgentVersionReturn {
  /** The version the session pins; `""` when it names no agent or has not loaded. */
  readonly pinnedHash: string;
  /** The agent's current version; `""` until the agent loads, or when it cannot be read. */
  readonly currentHash: string;
  /** The agent's display name (its name, else its slug); `""` until it loads. */
  readonly agentName: string;
  /**
   * The keys the agent's current version reads from the person's My
   * vault (usePersonalKeys: its declared keys, minus its servers'
   * OAuth variables, and none for an agent of another organization than
   * the session's), sorted: what an update hands the agent. Empty while
   * the conversation is current (no update to name them for), and until
   * the agent and its servers load.
   */
  readonly currentPersonalKeys: readonly string[];
  /**
   * `true` when the pin and the agent's current version are both known and
   * differ: the conversation runs an older version than the agent's author
   * last saved.
   */
  readonly isOutdated: boolean;
  /** How a version hash reads: its tag when it has one, else a short hash. */
  readonly labelOf: (versionHash: string) => string;
  /** Move the conversation to the agent's current version. Never rejects; failures land in {@link updateError}. */
  readonly update: () => Promise<void>;
  /** `true` while {@link update} is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last {@link update}, or `null`. */
  readonly updateError: Error | null;
}

/**
 * Reads the agent version `session` pins against its agent's current
 * version. See the module header for the rules.
 *
 * @example
 * ```tsx
 * const version = useSessionAgentVersion(conv.session, {
 *   enabled: true,
 *   moveToCurrentVersion: conv.moveToCurrentAgentVersion,
 * });
 * if (version.isOutdated) {
 *   return <button onClick={version.update}>Update</button>;
 * }
 * ```
 */
export function useSessionAgentVersion(
  session: Session | null,
  options: UseSessionAgentVersionOptions,
): UseSessionAgentVersionReturn {
  const { enabled, moveToCurrentVersion } = options;
  const stigmer = useStigmer();
  const pinnedHash = session?.status?.agentVersionHash ?? "";
  const agentId = enabled ? (session?.status?.agentId ?? "") : "";

  const { data: agent, refetch: refetchAgent } = useFetch(
    agentId !== ""
      ? async () => {
          try {
            return await stigmer.agent.get(agentId);
          } catch {
            // Deleted since, or no longer readable by this viewer: nothing
            // to compare against, so nothing is offered.
            return null;
          }
        }
      : null,
    [agentId, stigmer],
    null,
  );

  const { versions } = useAgentVersions(
    agent?.metadata?.org || null,
    agent?.metadata?.slug || null,
  );

  const currentHash = agent?.status?.versionHash ?? "";
  const agentName = agent?.metadata?.name || agent?.metadata?.slug || "";
  const isOutdated =
    pinnedHash !== "" && currentHash !== "" && pinnedHash !== currentHash;
  // The keys are named only beside the update control, so the agent's
  // servers are read only while the conversation is outdated.
  const { keys: currentPersonalKeys } = usePersonalKeys(
    isOutdated ? (agent ?? null) : null,
    agent?.spec,
    session?.metadata?.org ?? "",
  );

  const labelOf = useCallback(
    (versionHash: string) => agentVersionLabel(versions, versionHash),
    [versions],
  );

  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<Error | null>(null);

  const update = useCallback(async (): Promise<void> => {
    setIsUpdating(true);
    setUpdateError(null);
    try {
      await moveToCurrentVersion();
      // The author may have saved again since the agent was read.
      refetchAgent();
    } catch (err) {
      setUpdateError(toError(err));
    } finally {
      setIsUpdating(false);
    }
  }, [moveToCurrentVersion, refetchAgent]);

  return useMemo(
    () => ({
      pinnedHash,
      currentHash,
      agentName,
      currentPersonalKeys,
      isOutdated,
      labelOf,
      update,
      isUpdating,
      updateError,
    }),
    [
      pinnedHash,
      currentHash,
      agentName,
      currentPersonalKeys,
      isOutdated,
      labelOf,
      update,
      isUpdating,
      updateError,
    ],
  );
}
