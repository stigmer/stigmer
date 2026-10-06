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
import { WORKFLOW_ARCHITECT_RESPONSE_SCHEMA } from "./architect-response-schema.js";
import { workflowArchitectRef } from "./workflow-architect.js";

/**
 * Lifecycle phases for the workflow explain flow.
 *
 * Simplified single-turn flow (no multi-turn, no YAML extraction):
 * - `idle` — not started
 * - `starting` — creating session + run
 * - `streaming` — agent is working
 * - `complete` — explanation received
 * - `error` — something failed
 */
export type ExplainPhase = "idle" | "starting" | "streaming" | "complete" | "error";

/** Options for {@link useExplainWorkflowFlow}. */
export interface UseExplainWorkflowFlowOptions {
  /** Organization id (a slug is also accepted). */
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
  readonly run: AgentRun | null;
  readonly isStreaming: boolean;
  readonly error: string | null;
  readonly explain: () => Promise<void>;
  readonly reset: () => void;
}

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
  const { create: createExecution } = useCreateAgentRun();
  const conversationStore = useConversationStoreRef();
  const stream = useRunStream(executionId, {
    store: conversationStore,
  });

  // Terminal phase detection — extract explanation
  useEffect(() => {
    if (phase !== "streaming") return;

    const isTerminal =
      stream.phase !== RunPhase.RUN_PHASE_UNSPECIFIED &&
      isTerminalPhase(stream.phase);

    if (isTerminal && !prevTerminalRef.current) {
      prevTerminalRef.current = true;

      const structuredOutput = stream.run?.status?.structuredOutput as
        | Record<string, unknown>
        | undefined;

      if (structuredOutput?.explanation) {
        setExplanation(structuredOutput.explanation as string);
      }

      setPhase("complete");
      setExecutionId(null);
    }
  }, [phase, stream.phase, stream.run]);

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
      // The session and its first turn live in one organization, read once:
      // a turn in a session belongs to that session's organization
      // (stigmer/stigmer#1580), even if `org` changes during the create.
      const sessionOrg = orgRef.current;
      const { sessionId } = await createSession({
        org: sessionOrg,
        agentRef: workflowArchitectRef(sessionOrg),
      });

      const message =
        EXPLAIN_PROMPT_PREFIX +
        "```yaml\n" +
        yamlRef.current +
        "\n```";

      const { runId: newExecId } = await createExecution({
        org: sessionOrg,
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
      run: stream.run,
      isStreaming: stream.isStreaming || stream.isConnecting,
      error,
      explain,
      reset,
    }),
    [phase, explanation, stream.run, stream.isStreaming, stream.isConnecting, error, explain, reset],
  );
}
