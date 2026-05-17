"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useCreateSession } from "../session/useCreateSession";
import { useCreateAgentExecution } from "../execution/useCreateAgentExecution";
import { useExecutionStream } from "../execution/useExecutionStream";
import { isTerminalPhase } from "../execution/execution-phases";
import { useConversationStoreRef } from "../internal/store";
import {
  extractWorkflowYaml,
  type ExtractedWorkflowYaml,
} from "./extract-workflow-yaml";

/**
 * Lifecycle phases for the workflow refinement flow.
 *
 * - `idle` — panel open, no conversation yet
 * - `starting` — creating session (first turn) + execution
 * - `streaming` — agent is working (tool calls, validation, refinement)
 * - `complete` — agent finished, YAML was extracted (diff showing)
 * - `ready` — agent finished without YAML (clarifying question / explanation),
 *   or user accepted/discarded a previous result
 * - `error` — a failure occurred (RPC, stream)
 */
export type RefinePhase =
  | "idle"
  | "starting"
  | "streaming"
  | "complete"
  | "ready"
  | "error";

/** Options for {@link useRefineWorkflowFlow}. */
export interface UseRefineWorkflowFlowOptions {
  /** Organization slug for session and execution creation. */
  readonly org: string;
  /** Live YAML from the editor. Captured via ref at send-time, not reactively. */
  readonly currentYaml: string;
  /** Called when any step fails. Also available via the `error` return. */
  readonly onError?: (message: string) => void;
}

/** Return value of {@link useRefineWorkflowFlow}. */
export interface UseRefineWorkflowFlowReturn {
  /** Current lifecycle phase. */
  readonly phase: RefinePhase;
  /** Completed execution snapshots for MessageThread (chronological). */
  readonly completedExecutions: readonly AgentExecution[];
  /** Currently streaming execution, or null when idle/between turns. */
  readonly activeExecution: AgentExecution | null;
  /** `true` while the agent execution is actively streaming. */
  readonly isStreaming: boolean;
  /** Extracted YAML from the latest turn (null unless phase is `complete`). */
  readonly extractedYaml: string | null;
  /** Agent's explanation prose from the latest turn. */
  readonly explanation: string | null;
  /** Human-readable error message, or `null` when healthy. */
  readonly error: string | null;
  /** Send a refinement instruction. Creates session on first call. */
  readonly sendInstruction: (instruction: string) => Promise<void>;
  /** Accept the extracted YAML. Returns the YAML string. Transitions to `ready`. */
  readonly acceptResult: () => string | null;
  /** Discard the extracted YAML without applying. Transitions to `ready`. */
  readonly discardResult: () => void;
  /** Reset all state to initial values. Does not delete the server-side session. */
  readonly reset: () => void;
}

const AGENT_REF = { org: "", slug: "workflow-architect" } as const;
const MIN_INSTRUCTION_LENGTH = 5;

/**
 * Behavior hook that orchestrates agent-powered workflow refinement
 * using the built-in Workflow Architect system agent.
 *
 * Manages a multi-turn conversation within a single Session:
 * - First turn creates a Session + AgentExecution
 * - Subsequent turns reuse the Session (conversational context)
 * - Each turn streams agent messages via {@link useExecutionStream}
 * - YAML is extracted from agent responses via {@link extractWorkflowYaml}
 *
 * The `currentYaml` prop is captured at send-time (ref-based, not reactive)
 * and included in the message only when it differs from the last-sent version.
 *
 * Framework-agnostic (DD-004), referentially stable returns (DD-010).
 *
 * @example
 * ```tsx
 * const flow = useRefineWorkflowFlow({
 *   org: "acme",
 *   currentYaml: editor.yaml,
 *   onError: (msg) => toast.error(msg),
 * });
 *
 * <WorkflowRefinePanel flow={flow} onAccept={...} onClose={...} />
 * ```
 */
export function useRefineWorkflowFlow(
  options: UseRefineWorkflowFlowOptions,
): UseRefineWorkflowFlowReturn {
  const { org, currentYaml, onError } = options;

  const [phase, setPhase] = useState<RefinePhase>("idle");
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [completedExecutions, setCompletedExecutions] = useState<
    AgentExecution[]
  >([]);
  const [extracted, setExtracted] = useState<ExtractedWorkflowYaml | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const orgRef = useRef(org);
  orgRef.current = org;
  const yamlRef = useRef(currentYaml);
  yamlRef.current = currentYaml;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const sessionIdRef = useRef<string | null>(null);
  const lastSentYamlRef = useRef<string | null>(null);
  const prevTerminalRef = useRef(false);

  const { create: createSession } = useCreateSession();
  const { create: createExecution } = useCreateAgentExecution();
  const conversationStore = useConversationStoreRef();
  const stream = useExecutionStream(executionId, {
    store: conversationStore,
  });

  // -------------------------------------------------------------------------
  // Terminal phase detection — extract YAML or transition to ready
  // -------------------------------------------------------------------------
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

      const result = extractWorkflowYaml(stream.execution);
      if (result) {
        setExtracted(result);
        setPhase("complete");
      } else {
        setPhase("ready");
      }

      setExecutionId(null);
    }
  }, [phase, stream.phase, stream.execution]);

  // -------------------------------------------------------------------------
  // Stream error surfacing
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (stream.error && phase === "streaming") {
      const msg = getUserMessage(stream.error, "Agent stream interrupted");
      setPhase("error");
      setError(msg);
      onErrorRef.current?.(msg);
    }
  }, [stream.error, phase]);

  // -------------------------------------------------------------------------
  // Build the message with optional YAML context
  // -------------------------------------------------------------------------
  const buildMessage = useCallback((instruction: string): string => {
    const capturedYaml = yamlRef.current;
    const yamlChanged = capturedYaml !== lastSentYamlRef.current;

    lastSentYamlRef.current = capturedYaml;

    if (yamlChanged && capturedYaml) {
      return (
        "Here is the current workflow YAML:\n\n" +
        "```yaml\n" +
        capturedYaml +
        "\n```\n\n" +
        instruction
      );
    }

    return instruction;
  }, []);

  // -------------------------------------------------------------------------
  // Send a refinement instruction
  // -------------------------------------------------------------------------
  const sendInstruction = useCallback(
    async (instruction: string) => {
      const trimmed = instruction.trim();
      if (trimmed.length < MIN_INSTRUCTION_LENGTH) {
        setError(
          `Instruction must be at least ${MIN_INSTRUCTION_LENGTH} characters`,
        );
        return;
      }

      if (
        phase !== "idle" &&
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

        const message = buildMessage(trimmed);

        const { executionId: newExecutionId } = await createExecution({
          org: orgRef.current,
          sessionId: activeSessionId,
          message,
        });

        setExecutionId(newExecutionId);
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
    },
    [phase, createSession, createExecution, buildMessage],
  );

  // -------------------------------------------------------------------------
  // Accept / discard extracted YAML
  // -------------------------------------------------------------------------
  const acceptResult = useCallback((): string | null => {
    if (phase !== "complete" || !extracted) return null;
    const yaml = extracted.yaml;
    setExtracted(null);
    setPhase("ready");
    return yaml;
  }, [phase, extracted]);

  const discardResult = useCallback(() => {
    if (phase !== "complete") return;
    setExtracted(null);
    setPhase("ready");
  }, [phase]);

  // -------------------------------------------------------------------------
  // Reset all state
  // -------------------------------------------------------------------------
  const reset = useCallback(() => {
    setPhase("idle");
    setExecutionId(null);
    setCompletedExecutions([]);
    setExtracted(null);
    setError(null);
    sessionIdRef.current = null;
    lastSentYamlRef.current = null;
    prevTerminalRef.current = false;
  }, []);

  // -------------------------------------------------------------------------
  // Referentially stable return (DD-010)
  // -------------------------------------------------------------------------
  return useMemo(
    () => ({
      phase,
      completedExecutions,
      activeExecution: stream.execution,
      isStreaming: stream.isStreaming || stream.isConnecting,
      extractedYaml: extracted?.yaml ?? null,
      explanation: extracted?.explanation ?? null,
      error,
      sendInstruction,
      acceptResult,
      discardResult,
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
      sendInstruction,
      acceptResult,
      discardResult,
      reset,
    ],
  );
}
