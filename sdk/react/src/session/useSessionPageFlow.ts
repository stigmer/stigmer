"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import type { AgentResolution } from "../agent";
import { useDefaultAgent } from "../agent";
import { useStigmer } from "../hooks";
import { useWorkspaceEntries, type UseWorkspaceEntriesReturn } from "../workspace";
import { useSessionVariables, type UseSessionVariablesReturn } from "../execution/useSessionVariables";
import type { SessionComposerSubmitContext } from "../composer";
import { fromProtoHarness, type HarnessOption } from "../models/harness";
import { Harness, ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { fromProtoExecutionTarget, type ExecutionTargetOption } from "./execution-target";
import { useSessionConversation, type UseSessionConversationReturn } from "./useSessionConversation";
import { useAgentRefFromSession } from "./useAgentRefFromSession";
import { usePersistedModel, type UsePersistedModelReturn } from "./usePersistedModel";
import { specMcpUsagesToInput, specSkillRefsToInput } from "./session-spec-converters";

/**
 * Well-known Daytona sandbox workspace root. Used as the SDK safety-net
 * normalization target for cloud sessions (git-repo workspace entries).
 */
const DAYTONA_WORKSPACE_ROOT = "/home/daytona/workspace";

/** Options for {@link useSessionPageFlow}. */
export interface UseSessionPageFlowOptions {
  /** Session ID to load and manage. */
  readonly sessionId: string;
  /** Organization slug. */
  readonly org: string;
}

/** Return value of {@link useSessionPageFlow}. */
export interface UseSessionPageFlowReturn {
  /** Full conversation state from `useSessionConversation`. */
  readonly conv: UseSessionConversationReturn;

  /**
   * Session's execution harness (read-only, derived from session spec).
   *
   * Use this to:
   * - Filter the model selector for follow-up messages
   * - Render a harness badge in the session header
   *
   * Defaults to `"native"` while the session is loading.
   */
  readonly harness: HarnessOption;

  /**
   * Where session activities execute (read-only, derived from session spec).
   *
   * `"local"` when the client's embedded runner handles activities,
   * `"cloud"` when the server provisions a sandbox, or `undefined`
   * when the server decides (UNSPECIFIED).
   */
  readonly executionTarget: ExecutionTargetOption | undefined;

  /** Persisted model selection: `[modelId, setModelId]`. */
  readonly model: UsePersistedModelReturn;

  /** Currently selected agent reference (derived from session, or overridden by user). */
  readonly agentRef: ResourceRef | null;
  /** Update the agent reference for future follow-ups. */
  readonly setAgentRef: (ref: ResourceRef | null) => void;
  /** Current agent resolution state. */
  readonly resolution: AgentResolution | null;
  /** Update the agent resolution. */
  readonly setResolution: (r: AgentResolution | null) => void;
  /**
   * `true` when the session's agent is the org's default agent.
   * Used to render the agent chip as non-removable in the composer.
   */
  readonly isDefaultAgent: boolean;

  /** Active MCP server configurations for follow-ups. */
  readonly mcpServerUsages: McpServerUsageInput[];
  /** Update MCP server configurations. */
  readonly setMcpServerUsages: (usages: McpServerUsageInput[]) => void;

  /** Active skill references for follow-ups. */
  readonly skillRefs: ResourceRef[];
  /** Update skill references. */
  readonly setSkillRefs: (refs: ResourceRef[]) => void;

  /** Workspace entries manager (synced from session on load). */
  readonly workspace: UseWorkspaceEntriesReturn;
  /** Session variables (per-execution secrets) manager. */
  readonly sessionVariables: UseSessionVariablesReturn;

  /**
   * Submit a follow-up message. Handles agent override resolution
   * (if the user changed the agent mid-session) and delegates to
   * `conv.sendFollowUp` with all managed state.
   */
  readonly handleSubmit: (
    message: string,
    model?: string,
    context?: SessionComposerSubmitContext,
  ) => Promise<void>;

  /**
   * The most relevant execution for sidebar display — the active
   * streaming execution, or the last completed one.
   */
  readonly displayExecution: UseSessionConversationReturn["activeStreamExecution"];

  /**
   * All executions for widget display (completed + active stream).
   */
  readonly allExecutions: UseSessionConversationReturn["completedExecutions"];

  /**
   * Sandbox workspace root for file path normalization, or `undefined`
   * when the session has no git-repo workspace entries.
   */
  readonly sandboxWorkspaceRoot: string | undefined;
}

/**
 * Orchestrates the session page experience.
 *
 * Composes `useSessionConversation` with agent resolution, workspace
 * synchronization, model persistence, and follow-up submission logic.
 * Returns everything a session page needs to render its UI without
 * duplicating domain orchestration.
 *
 * Framework-agnostic — works identically in Next.js, Vite, Tauri, or
 * any React environment. The consumer provides layout, error states,
 * and loading skeletons.
 *
 * @example
 * ```tsx
 * const flow = useSessionPageFlow({ sessionId: "ses_abc", org: "acme" });
 *
 * if (flow.conv.isLoading) return <Spinner />;
 * if (flow.conv.loadError) return <ErrorView error={flow.conv.loadError} />;
 *
 * return (
 *   <>
 *     <MessageThread
 *       executions={flow.conv.completedExecutions}
 *       activeStreamExecution={flow.conv.activeStreamExecution}
 *       sandboxWorkspaceRoot={flow.sandboxWorkspaceRoot}
 *     />
 *     <SessionComposer
 *       onSubmit={flow.handleSubmit}
 *       isSubmitting={flow.conv.isSending}
 *       disabled={!flow.conv.canSendFollowUp}
 *       workspace={flow.workspace}
 *       agentRef={flow.agentRef}
 *       onAgentRefChange={flow.setAgentRef}
 *       onAgentResolutionChange={flow.setResolution}
 *       defaultModelId={flow.model[0]}
 *       onModelChange={flow.model[1]}
 *     />
 *   </>
 * );
 * ```
 */
export function useSessionPageFlow(
  options: UseSessionPageFlowOptions,
): UseSessionPageFlowReturn {
  const { sessionId, org } = options;

  const stigmer = useStigmer();
  const conv = useSessionConversation(sessionId, org);
  const harness: HarnessOption = fromProtoHarness(
    conv.session?.spec?.harness ?? Harness.UNSPECIFIED,
  );
  const executionTarget: ExecutionTargetOption | undefined = fromProtoExecutionTarget(
    conv.session?.spec?.executionTarget ?? ExecutionTarget.UNSPECIFIED,
  );
  const [persistedModelId, setPersistedModelId] = usePersistedModel({ harness });

  const lastExecModelId = useMemo(() => {
    const lastExec = conv.completedExecutions.at(-1);
    return lastExec?.spec?.executionConfig?.modelName || undefined;
  }, [conv.completedExecutions]);

  const modelId = persistedModelId ?? lastExecModelId;
  const model: UsePersistedModelReturn = [modelId, setPersistedModelId] as const;

  const workspace = useWorkspaceEntries();
  const sessionVariables = useSessionVariables();
  const [mcpServerUsages, setMcpServerUsages] = useState<McpServerUsageInput[]>([]);
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
  const initialSyncDone = useRef(false);

  // -------------------------------------------------------------------------
  // Agent — derive from session, allow mid-session changes
  // -------------------------------------------------------------------------

  const sessionInstanceId = conv.session?.spec?.agentInstanceId ?? null;
  const { agentRef: derivedAgentRef } = useAgentRefFromSession(sessionInstanceId);
  const { agent: defaultAgent, isLoading: isDefaultAgentLoading } = useDefaultAgent(org);

  const [agentRef, setAgentRef] = useState<ResourceRef | null>(null);
  const [resolution, setResolution] = useState<AgentResolution | null>(null);
  const [isDefaultAgent, setIsDefaultAgent] = useState(false);
  const [agentInitDone, setAgentInitDone] = useState(false);

  if (!agentInitDone && derivedAgentRef && sessionInstanceId && !isDefaultAgentLoading) {
    setAgentInitDone(true);
    setAgentRef(derivedAgentRef);
    setResolution({ mode: "saved", instanceId: sessionInstanceId });

    const isDefault =
      defaultAgent &&
      derivedAgentRef.org === defaultAgent.metadata?.org &&
      derivedAgentRef.slug === defaultAgent.metadata?.slug;
    setIsDefaultAgent(!!isDefault);
  }

  // -------------------------------------------------------------------------
  // Session spec sync — hydrate workspace, MCP servers, and skills on first load
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!conv.session || initialSyncDone.current) return;
    initialSyncDone.current = true;

    const spec = conv.session.spec;

    // Workspace entries
    const protoEntries = spec?.workspaceEntries ?? [];
    for (const entry of protoEntries) {
      if (entry.source?.source.case === "gitRepo") {
        const { url, branch } = entry.source.source.value;
        workspace.addGitRepo(url, branch || undefined);
      } else if (entry.source?.source.case === "localPath") {
        workspace.addLocalPath(entry.source.source.value.path);
      }
    }

    // MCP server usages
    const mcpInputs = specMcpUsagesToInput(spec);
    if (mcpInputs?.length) {
      setMcpServerUsages(mcpInputs);
    }

    // Skill references
    const skillInputs = specSkillRefsToInput(spec);
    if (skillInputs?.length) {
      setSkillRefs(skillInputs);
    }
  }, [conv.session, workspace]);

  // -------------------------------------------------------------------------
  // Follow-up submission with agent override
  // -------------------------------------------------------------------------

  const handleSubmit = useCallback(
    async (
      message: string,
      selectedModel?: string,
      context?: SessionComposerSubmitContext,
    ) => {
      let agentInstanceIdOverride: string | undefined;

      if (resolution) {
        if (
          resolution.mode === "saved" &&
          resolution.instanceId !== sessionInstanceId
        ) {
          agentInstanceIdOverride = resolution.instanceId;
        } else if (resolution.mode === "direct" && agentRef) {
          const agent = await stigmer.agent.getByReference(agentRef);
          const defaultId = agent.status?.defaultInstanceId;
          if (defaultId && defaultId !== sessionInstanceId) {
            agentInstanceIdOverride = defaultId;
          }
        }
      }

      conv.sendFollowUp(message, {
        agentInstanceId: agentInstanceIdOverride,
        modelName: selectedModel ?? modelId,
        workspaceEntries: workspace.hasEntries
          ? workspace.toInput()
          : undefined,
        mcpServerUsages: mcpServerUsages.length > 0 ? mcpServerUsages : undefined,
        skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
        runtimeEnv: context?.runtimeEnv,
        attachments: context?.attachments,
        interactionMode: context?.interactionMode,
        autoApproveAll: context?.autoApproveAll,
        workspaceFileRefs: context?.workspaceFileRefs,
      });

      sessionVariables.clear();
    },
    [conv.sendFollowUp, modelId, workspace, mcpServerUsages, skillRefs, sessionVariables.clear, resolution, agentRef, sessionInstanceId, stigmer],
  );

  // -------------------------------------------------------------------------
  // Derived display state
  // -------------------------------------------------------------------------

  const displayExecution = useMemo(() => {
    if (conv.activeStreamExecution) return conv.activeStreamExecution;
    const completed = conv.completedExecutions;
    return completed.length > 0 ? completed[completed.length - 1] : null;
  }, [conv.activeStreamExecution, conv.completedExecutions]);

  const allExecutions = useMemo(
    () => [
      ...conv.completedExecutions,
      ...(conv.activeStreamExecution ? [conv.activeStreamExecution] : []),
    ],
    [conv.completedExecutions, conv.activeStreamExecution],
  );

  const sandboxWorkspaceRoot = useMemo(() => {
    const entries = conv.workspaceEntries;
    const hasGitRepo = entries.some(
      (e) => e.source?.source.case === "gitRepo",
    );
    return hasGitRepo ? DAYTONA_WORKSPACE_ROOT : undefined;
  }, [conv.workspaceEntries]);

  return {
    conv,
    harness,
    executionTarget,
    model,
    agentRef,
    setAgentRef,
    resolution,
    setResolution,
    isDefaultAgent,
    mcpServerUsages,
    setMcpServerUsages,
    skillRefs,
    setSkillRefs,
    workspace,
    sessionVariables,
    handleSubmit,
    displayExecution,
    allExecutions,
    sandboxWorkspaceRoot,
  };
}
