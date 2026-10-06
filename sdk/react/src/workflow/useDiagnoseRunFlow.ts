"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useCreateSession } from "../session/useCreateSession.js";
import { useCreateAgentRun } from "../run/useCreateAgentRun.js";
import { useRunStream } from "../run/useRunStream.js";
import { isTerminalPhase } from "../run/run-phases.js";
import { useConversationStoreRef } from "../internal/store/index.js";
import {
  extractWorkflowYaml,
  type ExtractedWorkflowYaml,
} from "./extract-workflow-yaml.js";
import { WORKFLOW_DIAGNOSIS_RESPONSE_SCHEMA } from "./architect-response-schema.js";
import { workflowArchitectRef } from "./workflow-architect.js";

/**
 * Lifecycle phases for the workflow run diagnosis flow.
 *
 * - `idle` — mounted, waiting for auto-start or manual trigger
 * - `starting` — creating session + run
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

/** Options for {@link useDiagnoseRunFlow}. */
export interface UseDiagnoseRunFlowOptions {
  /** ID of the failed workflow run to diagnose. */
  readonly runId: string;
  /** Organization id for session and run creation (a slug is also accepted). */
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

/** Return value of {@link useDiagnoseRunFlow}. */
export interface UseDiagnoseRunFlowReturn {
  /** Current lifecycle phase. */
  readonly phase: DiagnosePhase;
  /** Completed run snapshots for MessageThread (chronological). */
  readonly completedRuns: readonly AgentRun[];
  /** Currently streaming run, or null when idle/between turns. */
  readonly activeRun: AgentRun | null;
  /** `true` while the agent run is actively streaming. */
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

const MIN_FOLLOWUP_LENGTH = 5;

/**
 * Behavior hook that orchestrates agent-powered workflow run
 * diagnosis using the Organization's Workflow Architect agent
 * (`workflow-architect.ts`).
 *
 * Manages a multi-turn conversation within a single Session:
 * - First turn creates a Session + AgentRun with diagnosis context
 * - Subsequent turns reuse the Session (conversational context)
 * - Each turn streams agent messages via {@link useRunStream}
 * - YAML is extracted from agent responses via {@link extractWorkflowYaml}
 *   — presence of YAML indicates a definition fix; absence indicates a
 *   runtime error with explanation only
 *
 * Auto-starts diagnosis on mount by default. The agent uses
 * `get_workflow_run` and `get_workflow_run_events` MCP tools
 * to inspect the failure autonomously.
 *
 * Framework-agnostic, referentially stable returns.
 *
 * @example
 * ```tsx
 * const flow = useDiagnoseRunFlow({
 *   executionId: "wex_abc123",
 *   org: "acme",
 *   onError: (msg) => toast.error(msg),
 * });
 *
 * <WorkflowRepairCard flow={flow} onApplyFix={...} onClose={...} />
 * ```
 */
export function useDiagnoseRunFlow(
  options: UseDiagnoseRunFlowOptions,
): UseDiagnoseRunFlowReturn {
  const { runId: executionId, org, autoStart = true, onError } = options;

  const [phase, setPhase] = useState<DiagnosePhase>("idle");
  const [activeRunId, setActiveRunId] = useState<string | null>(
    null,
  );
  const [completedRuns, setCompletedRuns] = useState<
    AgentRun[]
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

  // The flow's session and the organization it was created in: every turn
  // continues there, since a turn in a session belongs to that session's
  // organization (stigmer/stigmer#1580), even if `org` changes meanwhile.
  const sessionRef = useRef<{ readonly id: string; readonly org: string } | null>(null);
  const prevTerminalRef = useRef(false);
  const autoStartedRef = useRef(false);

  const { create: createSession } = useCreateSession();
  const { create: createExecution } = useCreateAgentRun();
  const conversationStore = useConversationStoreRef();
  const stream = useRunStream(activeRunId, {
    store: conversationStore,
  });

  // ---------------------------------------------------------------------------
  // Build the initial diagnosis message
  // ---------------------------------------------------------------------------
  const buildDiagnosisMessage = useCallback((): string => {
    return (
      `Diagnose the failed workflow run \`${executionIdRef.current}\`.\n\n` +
      "Analyze the failure root cause using the run status and event log.\n" +
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
      stream.phase !== RunPhase.RUN_PHASE_UNSPECIFIED &&
      isTerminalPhase(stream.phase);

    if (isTerminal && !prevTerminalRef.current) {
      prevTerminalRef.current = true;

      if (stream.run) {
        setCompletedRuns((prev) => [...prev, stream.run!]);
      }

      // Primary: read from structured output (deterministic)
      const structuredOutput = stream.run?.status?.structuredOutput as
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
        const result = extractWorkflowYaml(stream.run);
        if (result) {
          setExtracted(result);
          setPhase("complete");
        } else {
          setPhase("ready");
        }
      }

      setActiveRunId(null);
    }
  }, [phase, stream.phase, stream.run]);

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
      let activeSession = sessionRef.current;

      if (!activeSession) {
        const sessionOrg = orgRef.current;
        const { sessionId: newSessionId } = await createSession({
          org: sessionOrg,
          agentRef: workflowArchitectRef(sessionOrg),
        });
        activeSession = { id: newSessionId, org: sessionOrg };
        sessionRef.current = activeSession;
      }

      const message = buildDiagnosisMessage();

      const { runId: newExecutionId } = await createExecution({
        org: activeSession.org,
        sessionId: activeSession.id,
        message,
        structuredOutputSchema: WORKFLOW_DIAGNOSIS_RESPONSE_SCHEMA,
      });

      setActiveRunId(newExecutionId);
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
        let activeSession = sessionRef.current;

        if (!activeSession) {
          const sessionOrg = orgRef.current;
          const { sessionId: newSessionId } = await createSession({
            org: sessionOrg,
            agentRef: workflowArchitectRef(sessionOrg),
          });
          activeSession = { id: newSessionId, org: sessionOrg };
          sessionRef.current = activeSession;
        }

        const { runId: newExecutionId } = await createExecution({
          org: activeSession.org,
          sessionId: activeSession.id,
          message: trimmed,
          structuredOutputSchema: WORKFLOW_DIAGNOSIS_RESPONSE_SCHEMA,
        });

        setActiveRunId(newExecutionId);
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
    setActiveRunId(null);
    setCompletedRuns([]);
    setExtracted(null);
    setError(null);
    sessionRef.current = null;
    prevTerminalRef.current = false;
    autoStartedRef.current = false;
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-start on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (autoStart && phase === "idle" && !autoStartedRef.current) {
      autoStartedRef.current = true;
      diagnose();
    }
  }, [autoStart, phase, diagnose]);

  // ---------------------------------------------------------------------------
  // Referentially stable return
  // ---------------------------------------------------------------------------
  return useMemo(
    () => ({
      phase,
      completedRuns,
      activeRun: stream.run,
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
      completedRuns,
      stream.run,
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
