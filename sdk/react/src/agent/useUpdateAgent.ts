"use client";

import { useCallback, useState } from "react";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { Agent, AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateAgent}. */
export interface UseUpdateAgentReturn {
  /**
   * Update an agent: the fields `paths` names take their values from
   * `resource`, and every other field keeps its stored value. Resolves
   * with the updated resource.
   */
  readonly update: (
    resource: Agent | MessageInitShape<typeof AgentSchema>,
    paths: string[],
  ) => Promise<Agent>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset the error state to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `agent.update(resource, paths)` with
 * loading and error state.
 *
 * `resource` names the agent by `metadata.id`, and `paths` names the
 * fields the update changes (proto field paths such as
 * `spec.description`). Every field it does not name keeps its stored value, so
 * a teammate's change to another field survives the save. A agent read
 * carries `metadata.etag`: sent back, the update is refused (ABORTED,
 * reason `ETAG_MISMATCH`) if the agent changed since it was read.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateAgent();
 *
 * await update(
 *   {
 *     metadata: { id: agent.metadata!.id, etag: agent.metadata!.etag },
 *     spec: { description: "Reviews pull requests" },
 *   },
 *   ["spec.description"],
 * );
 * ```
 */
export function useUpdateAgent(): UseUpdateAgentReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (
      resource: Agent | MessageInitShape<typeof AgentSchema>,
      paths: string[],
    ): Promise<Agent> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.agent.update(resource, paths);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { update, isUpdating, error, clearError };
}
