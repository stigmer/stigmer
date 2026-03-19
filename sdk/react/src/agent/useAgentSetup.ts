"use client";

import { useCallback, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { EnvVarInput, ResourceRef } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ListAgentInstancesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStigmer } from "../hooks";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment";
import type { AgentEnvFormVariable } from "./AgentEnvForm";

const PERSONAL_LABEL = "stigmer.ai/personal";
const FOR_AGENT_LABEL = "stigmer.ai/for-agent";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discriminated result returned by {@link useAgentSetup.resolveAgent} and
 * {@link useAgentSetup.submitEnvVars}.
 *
 * - `"ready"` — the agent can be used immediately. `instanceId` is the
 *   personal instance when one was resolved, or `null` when the agent has
 *   no `env_spec` (the backend will use the default instance).
 * - `"needsEnvVars"` — the agent requires environment variables that the
 *   user has not yet provided. Render {@link AgentEnvForm} with
 *   `missingVariables` and call {@link submitEnvVars} on form submission.
 */
export type AgentSetupResult =
  | {
      readonly status: "ready";
      readonly agentRef: ResourceRef;
      readonly instanceId: string | null;
      readonly agentName: string;
    }
  | {
      readonly status: "needsEnvVars";
      readonly agentRef: ResourceRef;
      readonly agentName: string;
      readonly missingVariables: AgentEnvFormVariable[];
    };

export interface UseAgentSetupReturn {
  /**
   * Evaluate whether an agent is ready to use or needs env var collection.
   *
   * Fetches the full agent to read its `env_spec`, checks for an existing
   * personal instance, and diffs env_spec keys against the personal
   * environment. Returns `"ready"` when the agent can be used immediately,
   * or `"needsEnvVars"` when the caller should present {@link AgentEnvForm}.
   */
  readonly resolveAgent: (ref: ResourceRef) => Promise<AgentSetupResult>;

  /**
   * Complete the env var collection flow for the pending agent.
   *
   * Creates or updates the personal environment with the provided values,
   * then creates a personal agent instance linked to that environment.
   * Must only be called after {@link resolveAgent} returned `"needsEnvVars"`.
   */
  readonly submitEnvVars: (
    values: Record<string, EnvVarInput>,
  ) => Promise<AgentSetupResult & { status: "ready" }>;

  /** `true` while {@link resolveAgent} or {@link submitEnvVars} is in-flight. */
  readonly isResolving: boolean;

  /** Error message from the most recent failed operation, or `null`. */
  readonly error: string | null;
  readonly clearError: () => void;
}

interface PendingAgent {
  readonly agent: Agent;
  readonly agentRef: ResourceRef;
}

/**
 * Layer 2 behavior hook that encapsulates the agent selection and
 * personal environment resolution flow.
 *
 * When a user picks an agent in the {@link AgentPicker}, this hook
 * determines whether the agent requires credentials (via its `env_spec`),
 * checks what the user has already provided in their personal environment,
 * and either reports the agent as ready or identifies the missing variables
 * so the caller can render {@link AgentEnvForm}.
 *
 * Composes {@link usePersonalEnvironment} for personal environment
 * operations and calls the Stigmer client directly for agent and
 * agent instance queries.
 *
 * Pass `null` as `org` to disable all operations (stable no-op).
 *
 * This is a **Profile B** hook for direct Stigmer users. Platform
 * builders who pre-provision environments and instances should use the
 * Layer 1 building blocks directly.
 *
 * @example
 * ```tsx
 * const agentSetup = useAgentSetup("acme");
 *
 * const result = await agentSetup.resolveAgent({
 *   org: "acme", slug: "code-reviewer",
 * });
 *
 * if (result.status === "needsEnvVars") {
 *   // Render AgentEnvForm with result.missingVariables
 *   // On form submit:
 *   const ready = await agentSetup.submitEnvVars(formValues);
 *   console.log(ready.instanceId);
 * }
 * ```
 */
export function useAgentSetup(org: string | null): UseAgentSetupReturn {
  const stigmer = useStigmer();
  const personalEnv = usePersonalEnvironment(org);

  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  const pendingRef = useRef<PendingAgent | null>(null);

  const resolveAgent = useCallback(
    async (ref: ResourceRef): Promise<AgentSetupResult> => {
      if (!org) {
        throw new Error(
          "useAgentSetup: cannot resolve agent when org is null.",
        );
      }

      setIsResolving(true);
      setError(null);
      pendingRef.current = null;

      try {
        const agent = await stigmer.agent.getByReference(ref);
        const agentName = agent.metadata?.name ?? ref.slug;
        const envSpecData = agent.spec?.envSpec?.data;

        if (!envSpecData || Object.keys(envSpecData).length === 0) {
          return { status: "ready", agentRef: ref, instanceId: null, agentName };
        }

        // Agent has env_spec — check for existing personal instance.
        const agentLabel = `${ref.org}/${ref.slug}`;
        const instanceList = await stigmer.agentInstance.list(
          create(ListAgentInstancesRequestSchema, {
            org,
            labels: {
              [PERSONAL_LABEL]: "true",
              [FOR_AGENT_LABEL]: agentLabel,
            },
          }),
        );

        if (instanceList.items.length > 0) {
          const existingId = instanceList.items[0].metadata!.id;
          return { status: "ready", agentRef: ref, instanceId: existingId, agentName };
        }

        // No personal instance — check which env vars are missing.
        const existingKeys = new Set(
          Object.keys(personalEnv.environment?.spec?.data ?? {}),
        );

        const missingVariables: AgentEnvFormVariable[] = [];
        for (const [key, value] of Object.entries(envSpecData)) {
          if (!existingKeys.has(key)) {
            missingVariables.push({
              key,
              isSecret: value.isSecret,
              ...(value.description && { description: value.description }),
            });
          }
        }

        if (missingVariables.length === 0) {
          // All variables present — create personal instance directly.
          const env = await personalEnv.getOrCreate();
          const envRef: ResourceRef = {
            org,
            slug: env.metadata!.name,
            kind: ApiResourceKind.environment,
          };

          const instance = await stigmer.agentInstance.create({
            name: `${ref.slug}-personal`,
            org,
            agentId: agent.metadata!.id,
            labels: {
              [PERSONAL_LABEL]: "true",
              [FOR_AGENT_LABEL]: agentLabel,
            },
            environmentRefs: [envRef],
          });

          return {
            status: "ready",
            agentRef: ref,
            instanceId: instance.metadata!.id,
            agentName,
          };
        }

        // Missing variables — caller should show the env form.
        pendingRef.current = { agent, agentRef: ref };
        return { status: "needsEnvVars", agentRef: ref, agentName, missingVariables };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to resolve agent";
        setError(message);
        throw err;
      } finally {
        setIsResolving(false);
      }
    },
    [org, stigmer, personalEnv],
  );

  const submitEnvVars = useCallback(
    async (
      values: Record<string, EnvVarInput>,
    ): Promise<AgentSetupResult & { status: "ready" }> => {
      const pending = pendingRef.current;
      if (!pending) {
        throw new Error(
          "useAgentSetup: no pending agent. Call resolveAgent() first " +
            "and ensure it returned status 'needsEnvVars'.",
        );
      }
      if (!org) {
        throw new Error(
          "useAgentSetup: cannot submit env vars when org is null.",
        );
      }

      setIsResolving(true);
      setError(null);

      try {
        const { agent, agentRef } = pending;
        const agentName = agent.metadata?.name ?? agentRef.slug;

        const env = await personalEnv.getOrCreate();
        await personalEnv.addVariables(values);

        const agentLabel = `${agentRef.org}/${agentRef.slug}`;
        const envRef: ResourceRef = {
          org,
          slug: env.metadata!.name,
          kind: ApiResourceKind.environment,
        };

        const instance = await stigmer.agentInstance.create({
          name: `${agentRef.slug}-personal`,
          org,
          agentId: agent.metadata!.id,
          labels: {
            [PERSONAL_LABEL]: "true",
            [FOR_AGENT_LABEL]: agentLabel,
          },
          environmentRefs: [envRef],
        });

        pendingRef.current = null;
        return {
          status: "ready",
          agentRef,
          instanceId: instance.metadata!.id,
          agentName,
        };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to complete agent setup";
        setError(message);
        throw err;
      } finally {
        setIsResolving(false);
      }
    },
    [org, stigmer, personalEnv],
  );

  return { resolveAgent, submitEnvVars, isResolving, error, clearError };
}
