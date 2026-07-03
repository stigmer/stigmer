"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useCreateSession } from "../session/useCreateSession.js";
import { useCreateAgentExecution } from "../execution/useCreateAgentExecution.js";
import { useExecutionStream } from "../execution/useExecutionStream.js";
import { isTerminalPhase } from "../execution/execution-phases.js";
import { useConversationStoreRef } from "../internal/store/index.js";
import { parseWorkflowYaml } from "./serialize-workflow-yaml.js";
import {
  extractWorkflowYaml,
  type ExtractedWorkflowYaml,
} from "./extract-workflow-yaml.js";
import { WORKFLOW_ARCHITECT_RESPONSE_SCHEMA } from "./architect-response-schema.js";

/**
 * Lifecycle phases for the Workflow Architect generate flow.
 *
 * - `idle` — waiting for user to submit a prompt
 * - `starting` — creating session + execution
 * - `streaming` — agent is working (tool calls, validation, generation)
 * - `complete` — agent finished and YAML was extracted successfully
 * - `extraction-failed` — agent finished but no YAML block was found
 * - `applying` — creating the workflow from extracted YAML
 * - `error` — a failure occurred (RPC, stream, or apply)
 */
export type ArchitectPhase =
  | "idle"
  | "starting"
  | "streaming"
  | "complete"
  | "extraction-failed"
  | "applying"
  | "error";

/** Options for {@link useWorkflowArchitectFlow}. */
export interface UseWorkflowArchitectFlowOptions {
  /** Organization slug — used for session, execution, and workflow creation. */
  readonly org: string;
  /**
   * Called after the workflow is created successfully.
   * Receives the org slug and workflow slug for navigation.
   */
  readonly onSuccess: (org: string, slug: string) => void;
  /**
   * Called when any step fails. Receives a human-readable message.
   * Errors are also available via {@link UseWorkflowArchitectFlowReturn.error}.
   */
  readonly onError?: (message: string) => void;
}

/** Return value of {@link useWorkflowArchitectFlow}. */
export interface UseWorkflowArchitectFlowReturn {
  /** Current prompt value. */
  readonly prompt: string;
  /** Update the prompt. */
  readonly setPrompt: (value: string) => void;

  /** Current lifecycle phase. */
  readonly phase: ArchitectPhase;

  /**
   * Latest execution snapshot from the agent stream.
   *
   * Non-null during `streaming`, `complete`, and `extraction-failed`
   * phases. Pass to `MessageThread` for rendering agent messages.
   */
  readonly execution: AgentExecution | null;
  /** `true` while the agent execution is actively streaming. */
  readonly isStreaming: boolean;

  /** Extracted YAML when phase is `complete`, otherwise `null`. */
  readonly extractedYaml: string | null;
  /** Agent's explanation prose when phase is `complete`, otherwise `null`. */
  readonly explanation: string | null;

  /** Human-readable error message, or `null` when healthy. */
  readonly error: string | null;

  /**
   * Validate the prompt and launch the Workflow Architect agent.
   *
   * Creates a session with the `workflow-architect` system agent,
   * starts an execution with the user's prompt, and begins streaming.
   * The stream phase transitions automatically when the agent finishes.
   */
  readonly generate: () => Promise<void>;

  /**
   * Create a workflow from the extracted YAML via `workflow.apply()`.
   *
   * Only callable when phase is `complete`. Calls `onSuccess` with
   * the org and slug on completion.
   */
  readonly createWorkflow: () => Promise<void>;

  /** Reset all state to initial values. Does not delete the session. */
  readonly reset: () => void;
}

const AGENT_REF = { org: "", slug: "workflow-architect" } as const;
const MIN_PROMPT_LENGTH = 10;

/**
 * Behavior hook that orchestrates the agent-powered "generate a workflow"
 * flow using the built-in Workflow Architect system agent.
 *
 * Composes existing infrastructure:
 * - {@link useCreateSession} to create a session with the agent
 * - {@link useCreateAgentExecution} to start the generation execution
 * - {@link useExecutionStream} + `ConversationStore` for real-time streaming
 * - {@link extractWorkflowYaml} to parse YAML from agent messages
 * - `workflow.apply()` to persist the generated workflow
 *
 * The hook is framework-agnostic (DD-004) and returns referentially
 * stable values (DD-010).
 *
 * @example
 * ```tsx
 * const flow = useWorkflowArchitectFlow({
 *   org: "acme",
 *   onSuccess: (org, slug) => router.push(`/library/workflows/${org}/${slug}`),
 *   onError: (msg) => toast.error(msg),
 * });
 *
 * <WorkflowArchitectDialog {...flow} />
 * ```
 */
export function useWorkflowArchitectFlow(
  options: UseWorkflowArchitectFlowOptions,
): UseWorkflowArchitectFlowReturn {
  const { org, onSuccess, onError } = options;
  const stigmer = useStigmer();

  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<ArchitectPhase>("idle");
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedWorkflowYaml | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const orgRef = useRef(org);
  orgRef.current = org;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const { create: createSession } = useCreateSession();
  const { create: createExecution } = useCreateAgentExecution();
  const conversationStore = useConversationStoreRef();
  const stream = useExecutionStream(executionId, {
    store: conversationStore,
  });

  // Detect when the stream reaches a terminal phase and extract YAML
  const prevTerminalRef = useRef(false);
  useEffect(() => {
    if (phase !== "streaming") return;

    const isTerminal =
      stream.phase !== ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED &&
      isTerminalPhase(stream.phase);

    if (isTerminal && !prevTerminalRef.current) {
      prevTerminalRef.current = true;

      // Primary: read from structured output (deterministic)
      const structuredOutput = stream.execution?.status?.structuredOutput as
        | Record<string, unknown>
        | undefined;

      if (structuredOutput) {
        const action = structuredOutput.action as string | undefined;
        const yaml = structuredOutput.yaml as string | undefined;
        const explanation = structuredOutput.explanation as string | undefined;

        if (action === "generated_yaml" && yaml) {
          setExtracted({ yaml, explanation: explanation ?? "" });
          setPhase("complete");
        } else {
          setPhase("extraction-failed");
          setError(
            explanation ?? "The agent did not produce a workflow definition.",
          );
        }
      } else {
        // Fallback: regex extraction (backward compat / extraction failure)
        const result = extractWorkflowYaml(stream.execution);
        if (result) {
          setExtracted(result);
          setPhase("complete");
        } else {
          setPhase("extraction-failed");
          setError(
            "The agent completed but did not produce a YAML workflow definition. " +
              "Try again with a more specific prompt.",
          );
        }
      }
    }
  }, [phase, stream.phase, stream.execution]);

  // Surface stream errors
  useEffect(() => {
    if (stream.error && phase === "streaming") {
      setPhase("error");
      setError(getUserMessage(stream.error, "Agent stream interrupted"));
      onErrorRef.current?.(
        getUserMessage(stream.error, "Agent stream interrupted"),
      );
    }
  }, [stream.error, phase]);

  const generate = useCallback(async () => {
    if (phase !== "idle" && phase !== "error" && phase !== "extraction-failed")
      return;

    const trimmed = prompt.trim();
    if (trimmed.length < MIN_PROMPT_LENGTH) {
      setError(`Prompt must be at least ${MIN_PROMPT_LENGTH} characters`);
      return;
    }

    setPhase("starting");
    setError(null);
    setExtracted(null);
    prevTerminalRef.current = false;

    try {
      const { sessionId: newSessionId } = await createSession({
        org: orgRef.current,
        agentRef: { ...AGENT_REF, org: orgRef.current },
      });
      setSessionId(newSessionId);

      const { executionId: newExecutionId } = await createExecution({
        org: orgRef.current,
        sessionId: newSessionId,
        message: trimmed,
        structuredOutputSchema: WORKFLOW_ARCHITECT_RESPONSE_SCHEMA,
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
  }, [phase, prompt, createSession, createExecution]);

  const createWorkflow = useCallback(async () => {
    if (phase !== "complete" || !extracted) return;

    setPhase("applying");
    setError(null);

    try {
      const input = parseWorkflowYaml(extracted.yaml, orgRef.current);
      const workflow = await stigmer.workflow.apply(input);

      const slug = workflow.metadata?.slug;
      const workflowOrg = workflow.metadata?.org || orgRef.current;

      if (!slug) {
        throw new Error(
          "Workflow was created but no slug was returned. Check the workflows list.",
        );
      }

      onSuccessRef.current(workflowOrg, slug);
    } catch (err) {
      const msg = getUserMessage(err, "Failed to create workflow");
      setPhase("error");
      setError(msg);
      onErrorRef.current?.(msg);
    }
  }, [phase, extracted, stigmer]);

  const reset = useCallback(() => {
    setPrompt("");
    setPhase("idle");
    setExecutionId(null);
    setSessionId(null);
    setExtracted(null);
    setError(null);
    prevTerminalRef.current = false;
  }, []);

  return useMemo(
    () => ({
      prompt,
      setPrompt,
      phase,
      execution: stream.execution,
      isStreaming: stream.isStreaming || stream.isConnecting,
      extractedYaml: extracted?.yaml ?? null,
      explanation: extracted?.explanation ?? null,
      error,
      generate,
      createWorkflow,
      reset,
    }),
    [
      prompt,
      phase,
      stream.execution,
      stream.isStreaming,
      stream.isConnecting,
      extracted,
      error,
      generate,
      createWorkflow,
      reset,
    ],
  );
}
