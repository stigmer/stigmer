"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useCreateSession } from "../session/useCreateSession.js";
import { useCreateAgentExecution } from "../execution/useCreateAgentExecution.js";
import { useExecutionStream } from "../execution/useExecutionStream.js";
import { isTerminalPhase } from "../execution/execution-phases.js";
import { useConversationStoreRef } from "../internal/store/index.js";
import {
  extractWorkflowYaml,
  type ExtractedWorkflowYaml,
} from "./extract-workflow-yaml.js";
import { WORKFLOW_DIAGNOSIS_RESPONSE_SCHEMA } from "./architect-response-schema.js";

/**
 * Lifecycle phases for the workflow execution diagnosis flow.
 *
 * - `idle` — mounted, waiting for auto-start or manual trigger
 * - `starting` — creating session + execution
 * - `streaming` — agent is analyzing (tool calls, reasoning visible)
 * - `complete` — agent finished, YAML fix extracted (diff available)
 * - `ready` — agent finished without YAML (runtime error explanation),
 *   or user accepted/discarded a fix; follow-up available
 * - `error` — a failure occurred (RPC, stream)
 */
export type DiagnosePhase =
  | "idle"
  | "starting"
  | "streaming"
  | "complete"
  | "ready"
  | "error";

/** Options for {@link useDiagnoseExecutionFlow}. */
export interface UseDiagnoseExecutionFlowOptions {
  /** ID of the failed workflow execution to diagnose. */
  readonly executionId: string;
  /** Organization slug for session and execution creation. */
  readonly org: string;
  /** Current workflow YAML for diff computation (optional). */
  readonly currentWorkflowYaml?: string;
  /**
   * Whether to start diagnosis automatically on mount.
   * @default true
   */
  readonly autoStart?: boolean;
  /** Called when any step fails. Also available via the `error` return. */
  readonly onError?: (message: string) => void;
}

/** Return value of {@link useDiagnoseExecutionFlow}. */
export interface UseDiagnoseExecutionFlowReturn {
  /** Current lifecycle phase. */
  readonly phase: DiagnosePhase;
  /** Completed execution snapshots for MessageThread (chronological). */
  readonly completedExecutions: readonly AgentExecution[];
  /** Currently streaming execution, or null when idle/between turns. */
  readonly activeExecution: AgentExecution | null;
  /** `true` while the agent execution is actively streaming. */
  readonly isStreaming: boolean;
  /** Extracted YAML fix from the latest turn (null unless phase is `complete`). */
  readonly extractedYaml: string | null;
  /** Agent's explanation prose from the latest turn. */
  readonly explanation: string | null;
  /** Human-readable error message, or `null` when healthy. */
  readonly error: string | null;
  /** Start or restart the diagnosis. Callable from `idle` or `error` phases. */
  readonly diagnose: () => Promise<void>;
  /** Send a follow-up question within the same session. */
  readonly sendFollowUp: (message: string) => Promise<void>;
  /** Accept the extracted YAML fix. Returns the YAML string. Transitions to `ready`. */
  readonly acceptFix: () => string | null;
  /** Discard the extracted YAML without applying. Transitions to `ready`. */
  readonly discardFix: () => void;
  /** Reset all state to initial values. Does not delete the server-side session. */
  readonly reset: () => void;
}

const AGENT_REF = { org: "", slug: "workflow-architect" } as const;
const MIN_FOLLOWUP_LENGTH = 5;

/**
 * Behavior hook that orchestrates agent-powered workflow execution
 * diagnosis using the built-in Workflow Architect system agent.
 *
 * Manages a multi-turn conversation within a single Session:
 * - First turn creates a Session + AgentExecution with diagnosis context
 * - Subsequent turns reuse the Session (conversational context)
 * - Each turn streams agent messages via {@link useExecutionStream}
 * - YAML is extracted from agent responses via {@link extractWorkflowYaml}
 *   — presence of YAML indicates a definition fix; absence indicates a
 *   runtime error with explanation only
 *
 * Auto-starts diagnosis on mount by default (AD-B5-002). The agent uses
 * `get_workflow_execution` and `get_workflow_execution_events` MCP tools
 * to inspect the failure autonomously.
 *
 * Framework-agnostic (DD-004), referentially stable returns (DD-010).
 *
 * @example
 * ```tsx
 * const flow = useDiagnoseExecutionFlow({
 *   executionId: "wex_abc123",
 *   org: "acme",
 *   onError: (msg) => toast.error(msg),
 * });
 *
 * <WorkflowRepairCard flow={flow} onApplyFix={...} onClose={...} />
 * ```
 */
export function useDiagnoseExecutionFlow(
  options: UseDiagnoseExecutionFlowOptions,
): UseDiagnoseExecutionFlowReturn {
  const { executionId, org, autoStart = true, onError } = options;

  const [phase, setPhase] = useState<DiagnosePhase>("idle");
  const [activeExecutionId, setActiveExecutionId] = useState<string | null>(
    null,
  );
  const [completedExecutions, setCompletedExecutions] = useState<
    AgentExecution[]
  >([]);
  const [extracted, setExtracted] = useState<ExtractedWorkflowYaml | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const orgRef = useRef(org);
  orgRef.current = org;
  const executionIdRef = useRef(executionId);
  executionIdRef.current = executionId;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const sessionIdRef = useRef<string | null>(null);
  const prevTerminalRef = useRef(false);
  const autoStartedRef = useRef(false);

  const { create: createSession } = useCreateSession();
  const { create: createExecution } = useCreateAgentExecution();
  const conversationStore = useConversationStoreRef();
  const stream = useExecutionStream(activeExecutionId, {
    store: conversationStore,
  });

  // ---------------------------------------------------------------------------
  // Build the initial diagnosis message
  // ---------------------------------------------------------------------------
  const buildDiagnosisMessage = useCallback((): string => {
    return (
      `Diagnose the failed workflow execution \`${executionIdRef.current}\`.\n\n` +
      "Analyze the failure root cause using the execution status and event log.\n" +
      "If this is a workflow definition error, generate a validated fix.\n" +
      "If this is a runtime error, explain the root cause and suggest operational remediation."
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Terminal phase detection — extract YAML or transition to ready
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== "streaming") return;

    const isTerminal =
      stream.phase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED &&
      isTerminalPhase(stream.phase);

    if (isTerminal && !prevTerminalRef.current) {
      prevTerminalRef.current = true;

      if (stream.execution) {
        setCompletedExecutions((prev) => [...prev, stream.execution!]);
      }

      // Primary: read from structured output (deterministic)
      const structuredOutput = stream.execution?.status?.structuredOutput as
        | Record<string, unknown>
        | undefined;

      if (structuredOutput) {
        const action = structuredOutput.action as string | undefined;
        const yaml = structuredOutput.yaml as string | undefined;
        const explanation = structuredOutput.explanation as string | undefined;

        if (action === "fix_yaml" && yaml) {
          setExtracted({ yaml, explanation: explanation ?? "" });
          setPhase("complete");
        } else {
          // diagnosis or clarification — no YAML fix
          setPhase("ready");
        }
      } else {
        // Fallback: regex extraction (backward compat / extraction failure)
        const result = extractWorkflowYaml(stream.execution);
        if (result) {
          setExtracted(result);
          setPhase("complete");
        } else {
          setPhase("ready");
        }
      }

      setActiveExecutionId(null);
    }
  }, [phase, stream.phase, stream.execution]);

  // ---------------------------------------------------------------------------
  // Stream error surfacing
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (stream.error && phase === "streaming") {
      const msg = getUserMessage(stream.error, "Agent stream interrupted");
      setPhase("error");
      setError(msg);
      onErrorRef.current?.(msg);
    }
  }, [stream.error, phase]);

  // ---------------------------------------------------------------------------
  // Start diagnosis (initial turn)
  // ---------------------------------------------------------------------------
  const diagnose = useCallback(async () => {
    if (phase !== "idle" && phase !== "error") return;

    setPhase("starting");
    setError(null);
    setExtracted(null);
    prevTerminalRef.current = false;

    try {
      let activeSessionId = sessionIdRef.current;

      if (!activeSessionId) {
        const { sessionId: newSessionId } = await createSession({
          org: orgRef.current,
          agentRef: { ...AGENT_REF, org: orgRef.current },
        });
        sessionIdRef.current = newSessionId;
        activeSessionId = newSessionId;
      }

      const message = buildDiagnosisMessage();

      const { executionId: newExecutionId } = await createExecution({
        org: orgRef.current,
        sessionId: activeSessionId,
        message,
        structuredOutputSchema: WORKFLOW_DIAGNOSIS_RESPONSE_SCHEMA,
      });

      setActiveExecutionId(newExecutionId);
      setPhase("streaming");
    } catch (err) {
      const msg = getUserMessage(
        err,
        "Failed to start the Workflow Architect agent",
      );
      setPhase("error");
      setError(msg);
      onErrorRef.current?.(msg);
    }
  }, [phase, createSession, createExecution, buildDiagnosisMessage]);

  // ---------------------------------------------------------------------------
  // Send a follow-up question
  // ---------------------------------------------------------------------------
  const sendFollowUp = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (trimmed.length < MIN_FOLLOWUP_LENGTH) {
        setError(
          `Follow-up must be at least ${MIN_FOLLOWUP_LENGTH} characters`,
        );
        return;
      }

      if (
        phase !== "ready" &&
        phase !== "complete" &&
        phase !== "error"
      ) {
        return;
      }

      setPhase("starting");
      setError(null);
      setExtracted(null);
      prevTerminalRef.current = false;

      try {
        let activeSessionId = sessionIdRef.current;

        if (!activeSessionId) {
          const { sessionId: newSessionId } = await createSession({
            org: orgRef.current,
            agentRef: { ...AGENT_REF, org: orgRef.current },
          });
          sessionIdRef.current = newSessionId;
          activeSessionId = newSessionId;
        }

        const { executionId: newExecutionId } = await createExecution({
          org: orgRef.current,
          sessionId: activeSessionId,
          message: trimmed,
          structuredOutputSchema: WORKFLOW_DIAGNOSIS_RESPONSE_SCHEMA,
        });

        setActiveExecutionId(newExecutionId);
        setPhase("streaming");
      } catch (err) {
        const msg = getUserMessage(
          err,
          "Failed to send follow-up to the Workflow Architect agent",
        );
        setPhase("error");
        setError(msg);
        onErrorRef.current?.(msg);
      }
    },
    [phase, createSession, createExecution],
  );

  // ---------------------------------------------------------------------------
  // Accept / discard extracted YAML fix
  // ---------------------------------------------------------------------------
  const acceptFix = useCallback((): string | null => {
    if (phase !== "complete" || !extracted) return null;
    const yaml = extracted.yaml;
    setExtracted(null);
    setPhase("ready");
    return yaml;
  }, [phase, extracted]);

  const discardFix = useCallback(() => {
    if (phase !== "complete") return;
    setExtracted(null);
    setPhase("ready");
  }, [phase]);

  // ---------------------------------------------------------------------------
  // Reset all state
  // ---------------------------------------------------------------------------
  const reset = useCallback(() => {
    setPhase("idle");
    setActiveExecutionId(null);
    setCompletedExecutions([]);
    setExtracted(null);
    setError(null);
    sessionIdRef.current = null;
    prevTerminalRef.current = false;
    autoStartedRef.current = false;
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-start on mount (AD-B5-002)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (autoStart && phase === "idle" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      diagnose();
    }
  }, [autoStart, phase, diagnose]);

  // ---------------------------------------------------------------------------
  // Referentially stable return (DD-010)
  // ---------------------------------------------------------------------------
  return useMemo(
    () => ({
      phase,
      completedExecutions,
      activeExecution: stream.execution,
      isStreaming: stream.isStreaming || stream.isConnecting,
      extractedYaml: extracted?.yaml ?? null,
      explanation: extracted?.explanation ?? null,
      error,
      diagnose,
      sendFollowUp,
      acceptFix,
      discardFix,
      reset,
    }),
    [
      phase,
      completedExecutions,
      stream.execution,
      stream.isStreaming,
      stream.isConnecting,
      extracted,
      error,
      diagnose,
      sendFollowUp,
      acceptFix,
      discardFix,
      reset,
    ],
  );
}
