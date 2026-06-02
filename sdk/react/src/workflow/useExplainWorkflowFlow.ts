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
import { WORKFLOW_ARCHITECT_RESPONSE_SCHEMA } from "./architect-response-schema";

/**
 * Lifecycle phases for the workflow explain flow.
 *
 * Simplified single-turn flow (no multi-turn, no YAML extraction):
 * - `idle` — not started
 * - `starting` — creating session + execution
 * - `streaming` — agent is working
 * - `complete` — explanation received
 * - `error` — something failed
 */
export type ExplainPhase = "idle" | "starting" | "streaming" | "complete" | "error";

/** Options for {@link useExplainWorkflowFlow}. */
export interface UseExplainWorkflowFlowOptions {
  /** Organization slug. */
  readonly org: string;
  /** Current workflow YAML to explain. */
  readonly currentYaml: string;
  /** Called on error. */
  readonly onError?: (message: string) => void;
}

/** Return value of {@link useExplainWorkflowFlow}. */
export interface UseExplainWorkflowFlowReturn {
  readonly phase: ExplainPhase;
  readonly explanation: string | null;
  readonly execution: AgentExecution | null;
  readonly isStreaming: boolean;
  readonly error: string | null;
  readonly explain: () => Promise<void>;
  readonly reset: () => void;
}

const AGENT_REF = { org: "", slug: "workflow-architect" } as const;

const EXPLAIN_PROMPT_PREFIX =
  "Please explain the following workflow in plain language. " +
  "Describe what each task does, how data flows between them, " +
  "and any branching or error handling logic. " +
  "Do NOT suggest any changes — just explain what it does.\n\n";

/**
 * Behavior hook for the "Explain Workflow" feature.
 *
 * Single-turn flow using the `workflow-architect` agent with
 * `action: "no_changes"` (explanation only, no YAML returned).
 *
 * @since T14 (AI-Assisted Workflow Creation)
 */
export function useExplainWorkflowFlow(
  options: UseExplainWorkflowFlowOptions,
): UseExplainWorkflowFlowReturn {
  const { org, currentYaml, onError } = options;

  const [phase, setPhase] = useState<ExplainPhase>("idle");
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const orgRef = useRef(org);
  orgRef.current = org;
  const yamlRef = useRef(currentYaml);
  yamlRef.current = currentYaml;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const prevTerminalRef = useRef(false);

  const { create: createSession } = useCreateSession();
  const { create: createExecution } = useCreateAgentExecution();
  const conversationStore = useConversationStoreRef();
  const stream = useExecutionStream(executionId, {
    store: conversationStore,
  });

  // Terminal phase detection — extract explanation
  useEffect(() => {
    if (phase !== "streaming") return;

    const isTerminal =
      stream.phase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED &&
      isTerminalPhase(stream.phase);

    if (isTerminal && !prevTerminalRef.current) {
      prevTerminalRef.current = true;

      const structuredOutput = stream.execution?.status?.structuredOutput as
        | Record<string, unknown>
        | undefined;

      if (structuredOutput?.explanation) {
        setExplanation(structuredOutput.explanation as string);
      }

      setPhase("complete");
      setExecutionId(null);
    }
  }, [phase, stream.phase, stream.execution]);

  // Stream error surfacing
  useEffect(() => {
    if (stream.error && phase === "streaming") {
      const msg = getUserMessage(stream.error, "Agent stream interrupted");
      setPhase("error");
      setError(msg);
      onErrorRef.current?.(msg);
    }
  }, [stream.error, phase]);

  const explain = useCallback(async () => {
    if (phase !== "idle" && phase !== "error" && phase !== "complete") return;

    setPhase("starting");
    setError(null);
    setExplanation(null);
    prevTerminalRef.current = false;

    try {
      const { sessionId } = await createSession({
        org: orgRef.current,
        agentRef: { ...AGENT_REF, org: orgRef.current },
      });

      const message =
        EXPLAIN_PROMPT_PREFIX +
        "```yaml\n" +
        yamlRef.current +
        "\n```";

      const { executionId: newExecId } = await createExecution({
        org: orgRef.current,
        sessionId,
        message,
        structuredOutputSchema: WORKFLOW_ARCHITECT_RESPONSE_SCHEMA,
      });

      setExecutionId(newExecId);
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
  }, [phase, createSession, createExecution]);

  const reset = useCallback(() => {
    setPhase("idle");
    setExecutionId(null);
    setExplanation(null);
    setError(null);
    prevTerminalRef.current = false;
  }, []);

  return useMemo(
    () => ({
      phase,
      explanation,
      execution: stream.execution,
      isStreaming: stream.isStreaming || stream.isConnecting,
      error,
      explain,
      reset,
    }),
    [phase, explanation, stream.execution, stream.isStreaming, stream.isConnecting, error, explain, reset],
  );
}
