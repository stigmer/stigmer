"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentResolution } from "../agent/index.js";
import { useDefaultAgent } from "../agent/index.js";
import { useStigmer } from "../hooks.js";
import { useWorkspaceEntries, type UseWorkspaceEntriesReturn } from "../workspace/index.js";
import { useSessionVariables, type UseSessionVariablesReturn } from "../execution/useSessionVariables.js";
import type { SessionComposerSubmitContext, InteractionModeOption } from "../composer/index.js";
import { fromProtoInteractionMode } from "../composer/index.js";
import { fromProtoHarness, type HarnessOption } from "../models/harness.js";
import { Harness, ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { fromProtoExecutionTarget, type ExecutionTargetOption } from "./execution-target.js";
import { useSessionConversation, type UseSessionConversationReturn } from "./useSessionConversation.js";
import { resolveExecutionRuntimeEnv, type RuntimeEnvProvider } from "./runtime-env.js";
import { useAgentRefFromSession } from "./useAgentRefFromSession.js";
import { usePersistedModel, type UsePersistedModelReturn } from "./usePersistedModel.js";
import { specMcpUsagesToInput, specSkillRefsToInput } from "./session-spec-converters.js";

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
  /**
   * Supplies host-app environment variables for every follow-up
   * execution. Evaluated once per follow-up, at send time, so
   * short-lived credentials stay fresh.
   *
   * Host values win over composer-collected env on key collisions. If
   * the provider throws, the follow-up is aborted before any optimistic
   * UI or session mutation and the error surfaces via
   * {@link UseSessionPageFlowReturn.submitError}. See
   * {@link RuntimeEnvProvider}.
   */
  readonly getRuntimeEnv?: RuntimeEnvProvider;
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

  /**
   * Composer interaction mode: `[interactionMode, setInteractionMode]`.
   *
   * Derived like {@link model}: the user's explicit override wins, otherwise
   * it reflects the latest execution's mode (so a completed Plan keeps the
   * picker on "Plan" while it awaits review), falling back to `"agent"`.
   */
  readonly interactionMode: readonly [
    InteractionModeOption,
    (mode: InteractionModeOption) => void,
  ];

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
   * Session-scoped "auto-approve tool calls" preference.
   *
   * `false` by default. Flipped to `true` when the user chooses
   * "Approve & don't ask again" at an approval gate (see {@link submitApproval}),
   * and carried into every subsequent follow-up via {@link handleSubmit}. Held in
   * memory only — reset on reload / new session, never persisted server-side.
   */
  readonly autoApproveAll: boolean;
  /**
   * Toggle the session-scoped auto-approve preference. The reversible "Turn off"
   * control in the UI calls this with `false`.
   */
  readonly setAutoApproveAll: (value: boolean) => void;

  /**
   * Submit an approval decision for a pending tool call.
   *
   * Wraps {@link UseSessionConversationReturn.submitApproval}: when the action is
   * `APPROVAL_ACTION_APPROVE_ALL`, it also flips the session-scoped
   * {@link autoApproveAll} preference so future follow-ups skip the gate. The
   * server independently auto-approves the rest of the current execution.
   */
  readonly submitApproval: UseSessionConversationReturn["submitApproval"];

  /**
   * Submit a follow-up message. Handles agent override resolution
   * (if the user changed the agent mid-session), evaluates the host
   * runtime-env provider, and delegates to `conv.sendFollowUp` with
   * all managed state. Never rejects — pre-send failures land in
   * {@link submitError}.
   */
  readonly handleSubmit: (
    message: string,
    model?: string,
    context?: SessionComposerSubmitContext,
  ) => Promise<void>;

  /**
   * Error from the most recent follow-up's pre-send work (agent
   * override resolution, host runtime-env evaluation), or `null`.
   *
   * Distinct from `conv.sendError`, which covers the create-execution
   * RPC itself. Kept as the raw `Error` so consumers can render
   * contextual guidance (e.g. secret-flow errors). Cleared at the
   * start of each submission.
   */
  readonly submitError: Error | null;

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
  const { sessionId, org, getRuntimeEnv } = options;

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

  // Interaction mode mirrors the model derivation: an explicit user override
  // wins; otherwise reflect the latest execution's mode so a completed Plan
  // keeps the composer on "Plan" until the user implements or switches. This
  // is derived state (always consistent), never an effect-synced copy.
  const lastExecInteractionMode = useMemo(
    () =>
      fromProtoInteractionMode(
        conv.completedExecutions.at(-1)?.spec?.executionConfig?.interactionMode,
      ),
    [conv.completedExecutions],
  );
  const [interactionModeOverride, setInteractionMode] =
    useState<InteractionModeOption | null>(null);
  const interactionMode: UseSessionPageFlowReturn["interactionMode"] = [
    interactionModeOverride ?? lastExecInteractionMode ?? "agent",
    setInteractionMode,
  ] as const;

  const workspace = useWorkspaceEntries();
  const sessionVariables = useSessionVariables();
  const [mcpServerUsages, setMcpServerUsages] = useState<McpServerUsageInput[]>([]);
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
  const initialSyncDone = useRef(false);

  // Session-scoped auto-approve, set at the approval gate (not pre-armed in the
  // composer). Lives only in memory for the life of this page — reset on reload.
  const [autoApproveAll, setAutoApproveAll] = useState(false);

  const submitApproval = useCallback<UseSessionConversationReturn["submitApproval"]>(
    async (toolCallId, action, comment) => {
      // "Approve & don't ask again": remember the choice for the rest of this
      // live session so future follow-ups carry auto_approve_all. The control
      // plane separately resolves the current execution's remaining gates and
      // the runner skips the gate for the rest of that run.
      if (action === ApprovalAction.APPROVE_ALL) {
        setAutoApproveAll(true);
      }
      await conv.submitApproval(toolCallId, action, comment);
    },
    [conv.submitApproval],
  );

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

  const [submitError, setSubmitError] = useState<Error | null>(null);

  const handleSubmit = useCallback(
    async (
      message: string,
      selectedModel?: string,
      context?: SessionComposerSubmitContext,
    ) => {
      setSubmitError(null);

      // Pre-send work runs before conv.sendFollowUp so a failure here
      // aborts cleanly: no optimistic pending message, no session
      // mutation. The composer fires this handler without awaiting it,
      // so a rejection would otherwise be an unhandled rejection —
      // failures must land in submitError instead.
      let agentInstanceIdOverride: string | undefined;
      let runtimeEnv: SessionComposerSubmitContext["runtimeEnv"];

      try {
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

        // Evaluated per follow-up so short-lived host credentials are
        // current; host values win over composer-collected env.
        runtimeEnv = getRuntimeEnv
          ? await resolveExecutionRuntimeEnv(getRuntimeEnv, context?.runtimeEnv)
          : context?.runtimeEnv;
      } catch (err) {
        setSubmitError(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      conv.sendFollowUp(message, {
        agentInstanceId: agentInstanceIdOverride,
        modelName: selectedModel ?? modelId,
        workspaceEntries: workspace.hasEntries
          ? workspace.toInput()
          : undefined,
        mcpServerUsages: mcpServerUsages.length > 0 ? mcpServerUsages : undefined,
        skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
        runtimeEnv,
        attachments: context?.attachments,
        interactionMode: context?.interactionMode,
        buildFromPlan: context?.buildFromPlan,
        // Sourced from the session-scoped preference set at the approval gate,
        // not from the composer (the pre-arm toggle was removed).
        autoApproveAll: autoApproveAll || undefined,
        workspaceFileRefs: context?.workspaceFileRefs,
        supersedesExecutionId: context?.supersedesExecutionId,
      });

      sessionVariables.clear();
    },
    [conv.sendFollowUp, modelId, workspace, mcpServerUsages, skillRefs, sessionVariables.clear, resolution, agentRef, sessionInstanceId, stigmer, autoApproveAll, getRuntimeEnv],
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
    interactionMode,
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
    autoApproveAll,
    setAutoApproveAll,
    submitApproval,
    handleSubmit,
    submitError,
    displayExecution,
    allExecutions,
    sandboxWorkspaceRoot,
  };
}
