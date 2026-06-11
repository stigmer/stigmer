"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Resource kinds that support the `updateVisibility` RPC. */
export type VisibilityResourceKind =
  | "skill"
  | "agent"
  | "mcpServer"
  | "workflow"
  | "agentInstance"
  | "workflowInstance";

/** Return value of {@link useUpdateVisibility}. */
export interface UseUpdateVisibilityReturn {
  /**
   * Call the `updateVisibility` RPC for the specified resource.
   * Resolves when the server confirms the change.
   */
  readonly updateVisibility: (
    visibility: ApiResourceVisibility,
  ) => Promise<void>;
  /** `true` while the RPC is in flight. */
  readonly isPending: boolean;
  /** The last error from the RPC, or `null`. */
  readonly error: Error | null;
}

/**
 * Behavior hook that updates the visibility of a resource.
 *
 * Supports blueprints (Agent, Workflow, Skill, MCP Server) with the
 * full private/org/public/platform spectrum, and instances
 * (AgentInstance, WorkflowInstance) with private/org/public.
 *
 * Wraps the generated `stigmer.{kind}.updateVisibility()` SDK method
 * with loading and error state management. The hook is stateless with
 * respect to the resource — the caller is responsible for refreshing
 * the resource after a successful update (e.g., via `refetch` from
 * the corresponding data hook).
 *
 * Pass `null` for `resourceId` to produce a stable no-op (useful when
 * the resource hasn't loaded yet).
 *
 * @example
 * ```tsx
 * const { updateVisibility, isPending } = useUpdateVisibility("workflow", workflow.metadata.id);
 *
 * <VisibilitySelector
 *   visibility={workflow.metadata.visibility}
 *   options={options}
 *   onVisibilityChange={updateVisibility}
 *   isPending={isPending}
 * />
 * ```
 */
export function useUpdateVisibility(
  kind: VisibilityResourceKind,
  resourceId: string | null,
): UseUpdateVisibilityReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const updateVisibility = useCallback(
    async (visibility: ApiResourceVisibility) => {
      if (!resourceId) return;

      setIsPending(true);
      setError(null);

      try {
        const input = create(UpdateVisibilityInputSchema, {
          resourceId,
          visibility,
        });

        switch (kind) {
          case "skill":
            await stigmer.skill.updateVisibility(input);
            break;
          case "agent":
            await stigmer.agent.updateVisibility(input);
            break;
          case "mcpServer":
            await stigmer.mcpServer.updateVisibility(input);
            break;
          case "workflow":
            await stigmer.workflow.updateVisibility(input);
            break;
          case "agentInstance":
            await stigmer.agentInstance.updateVisibility(input);
            break;
          case "workflowInstance":
            await stigmer.workflowInstance.updateVisibility(input);
            break;
        }
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [kind, resourceId, stigmer],
  );

  return { updateVisibility, isPending, error };
}
