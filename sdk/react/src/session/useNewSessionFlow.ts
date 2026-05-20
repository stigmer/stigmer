"use client";

import { useCallback, useEffect, useState } from "react";
import { getUserMessage, type McpServerUsageInput, type ResourceRef } from "@stigmer/sdk";
import type { AgentResolution } from "../agent";
import { useDefaultAgent } from "../agent";
import { useModelRegistry } from "../models";
import { parseModelKey } from "../models/registry";
import { DEFAULT_HARNESS, type HarnessOption } from "../models/harness";
import { useWorkspaceEntries, type UseWorkspaceEntriesReturn } from "../workspace";
import { useSessionVariables, type UseSessionVariablesReturn } from "../execution/useSessionVariables";
import type { SessionComposerSubmitContext } from "../composer";
import { withTimeout } from "../internal/withTimeout";
import { useCreateSession } from "./useCreateSession";
import { useCreateAgentExecution } from "../execution/useCreateAgentExecution";

const DEFAULT_AGENT_TIMEOUT_MS = 10_000;

const STORAGE_KEY_HARNESS = "stigmer:session:harness";

function modelStorageKey(harness: HarnessOption): string {
  return harness === "cursor"
    ? "stigmer:session:model:cursor"
    : "stigmer:session:model";
}

/** Options for {@link useNewSessionFlow}. */
export interface UseNewSessionFlowOptions {
  /** Organization slug. Required for session and execution creation. */
  readonly org: string;
  /**
   * Called after a session and its first execution are created successfully.
   * The consumer is responsible for navigation (e.g. `router.push`).
   */
  readonly onSessionCreated: (sessionId: string) => void;
  /**
   * Called when an error occurs during session creation.
   * The consumer can use this for toast notifications or other UI feedback.
   * If not provided, errors are still available via {@link UseNewSessionFlowReturn.submitError}.
   */
  readonly onError?: (message: string) => void;
}

/** Return value of {@link useNewSessionFlow}. */
export interface UseNewSessionFlowReturn {
  /** Currently selected harness (persisted to localStorage). */
  readonly harness: HarnessOption;
  /** Switch the harness. Resets the model if invalid for the new harness. */
  readonly setHarness: (harness: HarnessOption) => void;

  /** Currently selected model ID (persisted per-harness to localStorage). */
  readonly modelId: string | undefined;
  /** Update the selected model. Automatically persists to localStorage. */
  readonly setModelId: (id: string) => void;

  /** Currently selected agent reference, or `null` for the default agent. */
  readonly agentRef: ResourceRef | null;
  /** Update the selected agent reference. */
  readonly setAgentRef: (ref: ResourceRef | null) => void;

  /** Current agent resolution state (saved instance vs direct reference). */
  readonly resolution: AgentResolution | null;
  /** Update the agent resolution. */
  readonly setResolution: (r: AgentResolution | null) => void;

  /** Active MCP server configurations. */
  readonly mcpServerUsages: McpServerUsageInput[];
  /** Update MCP server configurations. */
  readonly setMcpServerUsages: (usages: McpServerUsageInput[]) => void;

  /** Active skill references. */
  readonly skillRefs: ResourceRef[];
  /** Update skill references. */
  readonly setSkillRefs: (refs: ResourceRef[]) => void;

  /** Workspace entries manager (git repos and local paths). */
  readonly workspace: UseWorkspaceEntriesReturn;
  /** Session variables (per-execution secrets) manager. */
  readonly sessionVariables: UseSessionVariablesReturn;

  /** `true` while the create session + execution flow is in flight. */
  readonly isSubmitting: boolean;
  /** Human-readable error from the last failed submission, or `null`. */
  readonly submitError: string | null;

  /**
   * Create a session with the first execution.
   *
   * Composes all managed state (agent, workspace, MCP servers, skills,
   * model, session variables) into the session and execution
   * creation RPCs, then calls `onSessionCreated` on success.
   *
   * The `model` parameter overrides `modelId` for this submission only
   * (used when SessionComposer passes a per-message model selection).
   */
  readonly submit: (
    message: string,
    model?: string,
    context?: SessionComposerSubmitContext,
  ) => Promise<void>;
}

/**
 * Orchestrates the "create a new session" flow.
 *
 * Manages all the state required to configure and submit a new session:
 * model selection (with localStorage persistence), agent resolution,
 * MCP server/skill selection, workspace entries, and session
 * variables. On submission, creates the session and its first execution
 * in sequence, then notifies the consumer via `onSessionCreated`.
 *
 * This hook is framework-agnostic — it works identically in Next.js,
 * Vite, Tauri, or any React environment. Navigation, toast notifications,
 * and draft-mode logic are the consumer's responsibility.
 *
 * @example
 * ```tsx
 * const flow = useNewSessionFlow({
 *   org: "acme",
 *   onSessionCreated: (id) => navigate(`/sessions/${id}`),
 *   onError: (msg) => toast.error(msg),
 * });
 *
 * <SessionComposer
 *   onSubmit={flow.submit}
 *   isSubmitting={flow.isSubmitting}
 *   org="acme"
 *   workspace={flow.workspace}
 *   agentRef={flow.agentRef}
 *   onAgentRefChange={flow.setAgentRef}
 *   onAgentResolutionChange={flow.setResolution}
 *   mcpServerUsages={flow.mcpServerUsages}
 *   onMcpServerUsagesChange={flow.setMcpServerUsages}
 *   skillRefs={flow.skillRefs}
 *   onSkillRefsChange={flow.setSkillRefs}
   *   sessionVariables={flow.sessionVariables}
 *   defaultModelId={flow.modelId}
 *   onModelChange={flow.setModelId}
 * />
 * ```
 */
export function useNewSessionFlow(
  options: UseNewSessionFlowOptions,
): UseNewSessionFlowReturn {
  const { org, onSessionCreated, onError } = options;

  const [harness, setHarnessRaw] = useState<HarnessOption>(() => {
    if (typeof window === "undefined") return DEFAULT_HARNESS;
    const stored = localStorage.getItem(STORAGE_KEY_HARNESS);
    return stored === "cursor" ? "cursor" : DEFAULT_HARNESS;
  });

  const { getModel, isLoading: isModelsLoading } = useModelRegistry({ harness });
  const { create: createSession } = useCreateSession();
  const { create: createExecution } = useCreateAgentExecution();
  const {
    agent: defaultAgent,
    isLoading: isDefaultAgentLoading,
    error: defaultAgentError,
    waitForResolution: waitForDefaultAgent,
  } = useDefaultAgent(org);
  const workspace = useWorkspaceEntries();
  const sessionVariables = useSessionVariables();

  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const [agentRef, setAgentRef] = useState<ResourceRef | null>(null);
  const [resolution, setResolution] = useState<AgentResolution | null>(null);
  const [mcpServerUsages, setMcpServerUsages] = useState<McpServerUsageInput[]>([]);
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validModelId = modelId && getModel(modelId) ? modelId : undefined;

  // Persist harness on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_HARNESS, harness);
  }, [harness]);

  const setHarness = useCallback(
    (h: HarnessOption) => {
      setHarnessRaw(h);
      const storedModel = localStorage.getItem(modelStorageKey(h));
      const plain = storedModel ? (parseModelKey(storedModel)?.modelId ?? storedModel) : undefined;
      setModelId(plain);
    },
    [],
  );

  // Restore persisted model — only after the registry has loaded so
  // getModel can actually validate the stored ID against live data.
  useEffect(() => {
    if (isModelsLoading) return;
    const stored = localStorage.getItem(modelStorageKey(harness));
    if (stored) {
      const plain = parseModelKey(stored)?.modelId ?? stored;
      if (getModel(plain)) {
        setModelId(plain);
      }
    }
  }, [getModel, harness, isModelsLoading]);

  // Persist model on change (using current harness key).
  // Strip compound keys (e.g. "cursor/default") to plain modelId before storing.
  useEffect(() => {
    if (modelId) {
      const plain = parseModelKey(modelId)?.modelId ?? modelId;
      localStorage.setItem(modelStorageKey(harness), plain);
    }
  }, [modelId, harness]);

  const submit = useCallback(
    async (
      message: string,
      selectedModel?: string,
      context?: SessionComposerSubmitContext,
    ) => {
      if (isSubmitting) return;
      if (!org) {
        const msg = "Select an organization before starting a session.";
        setSubmitError(msg);
        onError?.(msg);
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const sessionFields = {
          org,
          workspaceEntries: workspace.hasEntries
            ? workspace.toInput()
            : undefined,
          mcpServerUsages: mcpServerUsages.length > 0 ? mcpServerUsages : undefined,
          skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
          harness,
        };

        const executionFields = {
          org,
          message,
          modelName: selectedModel ?? validModelId,
          runtimeEnv: context?.runtimeEnv,
          attachments: context?.attachments,
          interactionMode: context?.interactionMode,
        };

        let sessionId: string;

        if (agentRef && resolution) {
          if (resolution.mode === "saved") {
            ({ sessionId } = await createSession({
              ...sessionFields,
              agentInstanceId: resolution.instanceId,
            }));
          } else {
            ({ sessionId } = await createSession({
              ...sessionFields,
              agentRef,
            }));
          }
        } else {
          let resolvedInstanceId = defaultAgent?.status?.defaultInstanceId;
          if (!resolvedInstanceId) {
            if (isDefaultAgentLoading) {
              const resolved = await withTimeout(
                waitForDefaultAgent(),
                DEFAULT_AGENT_TIMEOUT_MS,
                "Default agent did not load in time. Please try again.",
              );
              resolvedInstanceId = resolved?.status?.defaultInstanceId;
            } else if (defaultAgentError) {
              throw new Error(
                "Failed to load default agent. Please try again.",
              );
            }
            if (!resolvedInstanceId) {
              throw new Error(
                "No default agent available. Select an agent to start a session.",
              );
            }
          }
          ({ sessionId } = await createSession({
            ...sessionFields,
            agentInstanceId: resolvedInstanceId,
          }));
        }

        await createExecution({ ...executionFields, sessionId });
        sessionVariables.clear();
        onSessionCreated(sessionId);
      } catch (err) {
        const detail = getUserMessage(err, "Failed to start session");
        setSubmitError(detail);
        onError?.(detail);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      isSubmitting,
      org,
      harness,
      validModelId,
      workspace,
      mcpServerUsages,
      skillRefs,
      agentRef,
      resolution,
      defaultAgent,
      isDefaultAgentLoading,
      defaultAgentError,
      waitForDefaultAgent,
      createSession,
      createExecution,
      sessionVariables,
      onSessionCreated,
      onError,
    ],
  );

  return {
    harness,
    setHarness,
    modelId: validModelId,
    setModelId,
    agentRef,
    setAgentRef,
    resolution,
    setResolution,
    mcpServerUsages,
    setMcpServerUsages,
    skillRefs,
    setSkillRefs,
    workspace,
    sessionVariables,
    isSubmitting,
    submitError,
    submit,
  };
}
