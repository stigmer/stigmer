// The canonical, full-fidelity session transcript (stigmer/stigmer#814).
//
// A session's whole conversation — thinking included, tool calls with their
// offloaded outputs resolved, sub-agent turns, timestamps — assembled ONCE
// here so every consumer (the SessionViewer export control, the CLI, an
// embedder's backend analysis job) reads the same authoritative record
// instead of re-deriving it.
//
// Canonical rules, decided for #814:
//   - Fidelity beats noise suppression. Thinking and system messages are
//     carried verbatim; presentation-layer cleanups (the CLI replay's
//     system-error rewriting, approval-noise dropping) stay in the
//     presentation layers. The transcript is raw material for improving
//     agents — the judgment signal lives in exactly the parts a polished
//     view hides.
//   - Tool calls attach to their parent MESSAGE_AI message. Every tool call
//     lives on an AI message in the data model, so this shows each call
//     exactly once, in position. (The CLI replay's started_at interleaving
//     is an event-stream presentation need, not a data rule.)
//   - Superseded turns (edit-and-resubmit) are excluded by default, matching
//     what the conversation view shows; `includeSuperseded: true` keeps them,
//     marked, for the history-faithful variant.
//   - An in-flight execution exports as its last-persisted snapshot and is
//     marked `inProgress` — honest about what a mid-run export is.
//   - Sub-agent transcripts (`status.sub_agent_executions` — task-tool
//     delegations) are embedded in the parent's status and export in full. A
//     `call-agent` workflow task spawns a SEPARATE child AgentExecution in
//     its own session; that is a different session's transcript, not part of
//     this one.
//
// Like the rest of this folder, the module is framework-free: the fetch
// entry point takes a structural client slice, so it runs in React hosts,
// Node jobs, and the CLI alike.

import { toJson, type JsonValue } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import type {
  AgentExecution,
  AgentExecutionStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type {
  AgentMessage,
  ToolCall,
  ToolCallOutputRef,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  GetArtifactContentResponse,
  ListAgentExecutionsBySessionRequest,
  AgentExecutionList,
  GetArtifactContentRequest,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import {
  GetArtifactContentRequestSchema,
  ListAgentExecutionsBySessionRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { resolvedSubject } from "../session.js";
import {
  execIdFromStorageKey,
  isBuildFromPlanTurn,
  sortChronologically,
  supersededExecutionIds,
  syntheticUserPrompt,
} from "./conversation-rules.js";
import { isTerminalPhase } from "./execution-phases.js";

// ============================================================================
// Model
// ============================================================================

/**
 * The fetched content of one offloaded tool output
 * ({@link ToolCallOutputRef}), keyed in the transcript by its storage key —
 * the one identifier that is unique across executions and sub-agents.
 */
export interface ResolvedToolOutput {
  /** The `output_ref.storage_key` this content belongs to. */
  readonly storageKey: string;
  /**
   * The resolved text, possibly truncated at the server's content cap
   * (512 KB by default). `undefined` when the fetch failed or was skipped —
   * serializers fall back to the ref's `truncated_preview`.
   */
  readonly content?: string;
  /** `true` when the server truncated {@link content} at the byte cap. */
  readonly truncated: boolean;
  /** Full stored size in bytes, when known. */
  readonly totalSizeBytes?: number;
  /** MIME type recorded on the ref. */
  readonly mimeType: string;
  /** `true` for image outputs — never inlined; serializers note them. */
  readonly isImage: boolean;
  /** Fetch failure, when resolution was attempted and failed. */
  readonly error?: string;
}

/** One execution's contribution to the conversation, with the canonical
 * rules' verdicts precomputed so consumers never re-derive them. */
export interface TranscriptTurn {
  /** The execution, verbatim — messages, tool calls, sub-agents, timestamps. */
  readonly execution: AgentExecution;
  /**
   * The user prose that opened this turn, or `null` when the turn has none
   * (programmatic create, `"execute"` placeholder, Build-from-plan label) —
   * the shared `syntheticUserPrompt` rule.
   */
  readonly userPrompt: string | null;
  /** `true` for a Build-from-plan turn (machine-labeled, no user prose). */
  readonly isBuildFromPlan: boolean;
  /** `true` when the turn was replaced by an edit-and-resubmit. Only ever
   * `true` when the transcript was assembled with `includeSuperseded`. */
  readonly superseded: boolean;
  /** `true` when the execution had not reached a terminal phase at assembly
   * time — its content is the last-persisted snapshot of a running turn. */
  readonly inProgress: boolean;
}

/** The canonical whole-conversation record of one session. */
export interface SessionTranscript {
  /** The session, verbatim. */
  readonly session: Session;
  /** The conversation's turns, in chronological (ULID) order. */
  readonly turns: readonly TranscriptTurn[];
  /**
   * Fetched offloaded tool outputs, keyed by storage key. Empty when
   * resolution was skipped; serializers then fall back to each ref's
   * `truncated_preview`.
   */
  readonly resolvedOutputs: Readonly<Record<string, ResolvedToolOutput>>;
  /** Whether superseded (edit-and-resubmit) turns were kept. */
  readonly includesSuperseded: boolean;
}

// ============================================================================
// Assembly (pure)
// ============================================================================

/** Options for {@link assembleSessionTranscript}. */
export interface AssembleSessionTranscriptOptions {
  /**
   * Keep turns replaced by edit-and-resubmit, marked
   * `superseded: true`. Defaults to `false` — the conversation as the
   * viewer shows it.
   */
  readonly includeSuperseded?: boolean;
  /** Fetched offloaded outputs to embed (see {@link resolveOffloadedOutputs}). */
  readonly resolvedOutputs?: Readonly<Record<string, ResolvedToolOutput>>;
}

/**
 * Assembles the canonical transcript from a session and its executions.
 *
 * Pure — same inputs, same transcript. Ordering, superseded filtering, and
 * user-turn synthesis are the shared conversation rules from
 * `conversation-rules.ts`, so this cannot drift from what the conversation
 * view renders.
 */
export function assembleSessionTranscript(
  session: Session,
  executions: readonly AgentExecution[],
  options?: AssembleSessionTranscriptOptions,
): SessionTranscript {
  const includeSuperseded = options?.includeSuperseded === true;
  const ordered = sortChronologically(executions);
  const superseded = supersededExecutionIds(ordered);

  const turns: TranscriptTurn[] = [];
  for (const execution of ordered) {
    const isSuperseded = superseded.has(execution.metadata?.id ?? "");
    if (isSuperseded && !includeSuperseded) continue;
    const phase = execution.status?.phase;
    turns.push({
      execution,
      userPrompt: syntheticUserPrompt(execution),
      isBuildFromPlan: isBuildFromPlanTurn(execution),
      superseded: isSuperseded,
      inProgress: phase === undefined || !isTerminalPhase(phase),
    });
  }

  return {
    session,
    turns,
    resolvedOutputs: options?.resolvedOutputs ?? {},
    includesSuperseded: includeSuperseded,
  };
}

// ============================================================================
// Fetch (the one authoritative read)
// ============================================================================

/**
 * The client slice {@link fetchSessionTranscript} needs — structurally
 * satisfied by the `Stigmer` client, and small enough to fake in tests and
 * satisfy from any host.
 */
export interface SessionTranscriptClient {
  readonly session: {
    get(id: string): Promise<Session>;
  };
  readonly agentExecution: {
    listBySession(
      input: ListAgentExecutionsBySessionRequest,
    ): Promise<AgentExecutionList>;
    getArtifactContent(
      input: GetArtifactContentRequest,
    ): Promise<GetArtifactContentResponse>;
  };
}

/** Options for {@link fetchSessionTranscript}. */
export interface FetchSessionTranscriptOptions {
  /** See {@link AssembleSessionTranscriptOptions.includeSuperseded}. */
  readonly includeSuperseded?: boolean;
  /**
   * Fetch offloaded tool outputs (`output_ref`) so the transcript carries
   * them in full instead of their truncated previews. Defaults to `true` —
   * resolution is the fidelity bar of #814. Individual fetch failures never
   * fail the export; the failed ref falls back to its preview, with the
   * error recorded on its {@link ResolvedToolOutput}.
   */
  readonly resolveOutputs?: boolean;
  /** Concurrent output fetches. Defaults to 4. */
  readonly concurrency?: number;
}

/**
 * Fetches everything a session's transcript needs and assembles it.
 *
 * One `listBySession` call returns the complete execution set — both server
 * editions answer this RPC unpaginated today (Go: `TODO: Implement
 * pagination`; Java: "not using pagination with authorized IDs approach").
 * If a future server starts paginating (`total_pages > 1`), this fails with
 * a descriptive error rather than silently exporting a truncated
 * "full-fidelity" transcript.
 */
export async function fetchSessionTranscript(
  client: SessionTranscriptClient,
  sessionId: string,
  options?: FetchSessionTranscriptOptions,
): Promise<SessionTranscript> {
  const [session, list] = await Promise.all([
    client.session.get(sessionId),
    client.agentExecution.listBySession(
      create(ListAgentExecutionsBySessionRequestSchema, { sessionId }),
    ),
  ]);

  if (list.totalPages > 1) {
    throw new Error(
      `Session ${sessionId} has ${list.totalPages} pages of executions but ` +
        "transcript export reads a single page. The server has started " +
        "paginating listBySession; teach fetchSessionTranscript to walk " +
        "pages before exporting, so no turns are silently dropped.",
    );
  }

  const resolvedOutputs =
    options?.resolveOutputs === false
      ? {}
      : await resolveOffloadedOutputs(client, list.entries, {
          concurrency: options?.concurrency,
        });

  return assembleSessionTranscript(session, list.entries, {
    includeSuperseded: options?.includeSuperseded,
    resolvedOutputs,
  });
}

/**
 * Fetches the content behind every offloaded tool output in the given
 * executions (parent and sub-agent transcripts alike), keyed by storage key.
 *
 * Image refs are never fetched — serializers render them as notes. The
 * execution id for each fetch derives from the storage key itself
 * (`execIdFromStorageKey`): sub-agent outputs are stored under the PARENT
 * execution's id, and the key is the record of that.
 */
export async function resolveOffloadedOutputs(
  client: Pick<SessionTranscriptClient, "agentExecution">,
  executions: readonly AgentExecution[],
  options?: { readonly concurrency?: number },
): Promise<Record<string, ResolvedToolOutput>> {
  const refs = new Map<string, ToolCallOutputRef>();
  for (const execution of executions) {
    for (const toolCall of allToolCalls(execution.status)) {
      const ref = toolCall.outputRef;
      if (ref?.storageKey) refs.set(ref.storageKey, ref);
    }
  }

  const resolved: Record<string, ResolvedToolOutput> = {};
  const decoder = new TextDecoder("utf-8", { fatal: false });

  await mapWithConcurrency(
    [...refs.values()],
    options?.concurrency ?? 4,
    async (ref) => {
      const base = {
        storageKey: ref.storageKey,
        mimeType: ref.mimeType,
        isImage: ref.isImage,
        totalSizeBytes: Number(ref.sizeBytes),
      };
      if (ref.isImage) {
        resolved[ref.storageKey] = { ...base, truncated: false };
        return;
      }
      const executionId = execIdFromStorageKey(ref.storageKey);
      if (!executionId) {
        resolved[ref.storageKey] = {
          ...base,
          truncated: false,
          error: `unexpected storage key shape: ${ref.storageKey}`,
        };
        return;
      }
      try {
        const response = await client.agentExecution.getArtifactContent(
          create(GetArtifactContentRequestSchema, {
            executionId,
            storageKey: ref.storageKey,
          }),
        );
        resolved[ref.storageKey] = {
          ...base,
          content: decoder.decode(response.content),
          truncated: response.truncated,
          totalSizeBytes: Number(response.totalSizeBytes),
        };
      } catch (e) {
        resolved[ref.storageKey] = {
          ...base,
          truncated: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  return resolved;
}

/** Every tool call in an execution's status — the parent transcript's plus
 * each embedded sub-agent transcript's. */
function* allToolCalls(
  status: AgentExecutionStatus | undefined,
): Generator<ToolCall> {
  if (!status) return;
  const messageLists: readonly (readonly AgentMessage[])[] = [
    status.messages,
    ...status.subAgentExecutions.map((sa) => sa.messages),
  ];
  for (const messages of messageLists) {
    for (const message of messages) {
      yield* message.toolCalls;
    }
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const item = items[next++];
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}

// ============================================================================
// Markdown serialization
// ============================================================================

/** Options for {@link transcriptToMarkdown}. */
export interface TranscriptToMarkdownOptions {
  /**
   * ISO timestamp stamped in the document header as the export time.
   * Omitted when not provided, keeping the serializer deterministic for
   * fixture pinning.
   */
  readonly generatedAt?: string;
}

/**
 * Renders the transcript as a self-contained Markdown document.
 *
 * Deterministic: same transcript, same bytes — the format is a pinned
 * contract (see `__tests__/transcript.test.ts`). Roles are bold labels
 * (User / Assistant / Thinking / System), thinking and system content is
 * blockquoted, tool calls carry fenced args and output, and sub-agent turns
 * are blockquoted sections. Fences self-size past any backtick runs in the
 * content, so hostile content cannot break out of its block.
 */
export function transcriptToMarkdown(
  transcript: SessionTranscript,
  options?: TranscriptToMarkdownOptions,
): string {
  const { session, turns, resolvedOutputs } = transcript;
  const out: string[] = [];

  const sessionId = session.metadata?.id ?? "";
  const title = resolvedSubject(session.spec?.subject) ?? `Session ${sessionId}`;
  out.push(`# ${title}`, "");
  out.push(`- Session: \`${sessionId}\``);
  const agentInstanceId = session.spec?.agentInstanceId;
  if (agentInstanceId) out.push(`- Agent instance: \`${agentInstanceId}\``);
  out.push(`- Turns: ${turns.length}`);
  if (transcript.includesSuperseded) {
    out.push("- Includes superseded (edited-and-resubmitted) turns");
  }
  if (options?.generatedAt) out.push(`- Exported: ${options.generatedAt}`);

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    out.push("", "---", "");
    out.push(`## Turn ${i + 1}${turnHeaderSuffix(turn)}`);

    if (turn.superseded) {
      out.push("", "_Superseded by an edited resubmission._");
    }
    if (turn.inProgress) {
      out.push("", "_In progress at export time — content is the last persisted snapshot._");
    }
    if (turn.isBuildFromPlan) {
      out.push("", "_Build from plan._");
    }

    if (turn.userPrompt !== null) {
      out.push("", "**User**", "", turn.userPrompt);
    }

    renderMessages(
      out,
      turn.execution.status?.messages ?? [],
      turn.execution.status?.subAgentExecutions ?? [],
      resolvedOutputs,
      turn.userPrompt,
    );

    const error = turn.execution.status?.error;
    if (error) {
      out.push("", "**Execution error**", "", blockquote(error));
    }
  }

  out.push("");
  return out.join("\n");
}

function turnHeaderSuffix(turn: TranscriptTurn): string {
  const startedAt = turn.execution.status?.startedAt;
  return startedAt ? ` · ${startedAt}` : "";
}

/** Renders one message list — the parent turn's or a sub-agent's. */
function renderMessages(
  out: string[],
  messages: readonly AgentMessage[],
  subAgents: readonly SubAgentExecution[],
  resolvedOutputs: Readonly<Record<string, ResolvedToolOutput>>,
  userPrompt: string | null,
): void {
  for (const message of messages) {
    switch (message.type) {
      case MessageType.MESSAGE_TOOL:
        // Tool calls render from their parent MESSAGE_AI's tool_calls (the
        // canonical attach rule); the MESSAGE_TOOL echo would double them.
        continue;
      case MessageType.MESSAGE_HUMAN: {
        // The turn's opening prompt is already rendered from spec.message;
        // skip its status.messages echo. Any OTHER human message is kept.
        if (userPrompt !== null && message.content === userPrompt) continue;
        out.push("", "**User**", "", message.content);
        continue;
      }
      case MessageType.MESSAGE_THINKING:
        out.push("", "**Thinking**", "", blockquote(message.content));
        continue;
      case MessageType.MESSAGE_SYSTEM:
        out.push("", "**System**", "", blockquote(message.content));
        continue;
      case MessageType.MESSAGE_AI: {
        if (message.content.trim()) {
          out.push("", "**Assistant**", "", message.content);
        }
        for (const toolCall of message.toolCalls) {
          if (toolCall.name === "task") {
            const subAgent = subAgents.find((sa) => sa.id === toolCall.id);
            if (subAgent) {
              renderSubAgent(out, subAgent, resolvedOutputs);
              continue;
            }
          }
          renderToolCall(out, toolCall, resolvedOutputs);
        }
        continue;
      }
      default:
        // Unknown future message type: carry the content rather than drop it.
        if (message.content) out.push("", blockquote(message.content));
    }
  }
}

function renderToolCall(
  out: string[],
  toolCall: ToolCall,
  resolvedOutputs: Readonly<Record<string, ResolvedToolOutput>>,
): void {
  out.push("", `**Tool — \`${toolCall.name}\`**${toolCallSuffix(toolCall)}`);

  // ToolCall.args is a google.protobuf.Struct, which protobuf-es represents
  // as a plain JsonObject — safe to stringify directly (no bigint fields).
  const args = toolCall.args
    ? JSON.stringify(toolCall.args, null, 2)
    : undefined;
  if (args && args !== "{}") {
    out.push("", fenced(args, "json"));
  }

  const output = toolOutputText(toolCall, resolvedOutputs);
  if (output.note) out.push("", `_${output.note}_`);
  if (output.text) out.push("", fenced(output.text));

  if (toolCall.error) {
    out.push("", "Error:", "", fenced(toolCall.error));
  }
}

/** The output text and honesty note for a tool call, applying the
 * offload-resolution fallbacks. */
function toolOutputText(
  toolCall: ToolCall,
  resolvedOutputs: Readonly<Record<string, ResolvedToolOutput>>,
): { text?: string; note?: string } {
  const ref = toolCall.outputRef;
  if (!ref?.storageKey) {
    return toolCall.result ? { text: toolCall.result } : {};
  }
  if (ref.isImage) {
    return {
      note: `Image output (${ref.mimeType || "image"}, ${Number(ref.sizeBytes)} bytes) — not inlined.`,
    };
  }
  const resolved = resolvedOutputs[ref.storageKey];
  if (resolved?.content !== undefined) {
    return {
      text: resolved.content,
      note: resolved.truncated
        ? `Output truncated at ${resolved.content.length} of ${resolved.totalSizeBytes} bytes (server content cap).`
        : undefined,
    };
  }
  return {
    text: ref.truncatedPreview || toolCall.result || undefined,
    note: resolved?.error
      ? `Offloaded output unavailable (${resolved.error}) — showing preview.`
      : "Offloaded output not resolved — showing preview.",
  };
}

function toolCallSuffix(toolCall: ToolCall): string {
  const parts: string[] = [];
  const status = toolCallStatusLabel(toolCall.status);
  if (status) parts.push(status);
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  if (duration) parts.push(duration);
  return parts.length > 0 ? ` (${parts.join(" · ")})` : "";
}

function toolCallStatusLabel(status: ToolCallStatus): string | null {
  switch (status) {
    case ToolCallStatus.TOOL_CALL_COMPLETED:
      return "completed";
    case ToolCallStatus.TOOL_CALL_FAILED:
      return "failed";
    case ToolCallStatus.TOOL_CALL_SKIPPED:
      return "skipped";
    case ToolCallStatus.TOOL_CALL_INTERRUPTED:
      return "interrupted";
    case ToolCallStatus.TOOL_CALL_RUNNING:
      return "running";
    case ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
      return "waiting for approval";
    case ToolCallStatus.TOOL_CALL_PENDING:
      return "pending";
    default:
      return null;
  }
}

function renderSubAgent(
  out: string[],
  subAgent: SubAgentExecution,
  resolvedOutputs: Readonly<Record<string, ResolvedToolOutput>>,
): void {
  const nested: string[] = [];
  const title = subAgent.subject || subAgent.name || "sub-agent";
  nested.push(`**Sub-agent — ${title}**${subAgentSuffix(subAgent)}`);
  if (subAgent.input) {
    nested.push("", "Input:", "", subAgent.input);
  }
  renderMessages(nested, subAgent.messages, [], resolvedOutputs, null);
  if (subAgent.output) {
    nested.push("", "Output:", "", subAgent.output);
  }
  if (subAgent.error) {
    nested.push("", "Error:", "", fenced(subAgent.error));
  }
  out.push("", blockquote(nested.join("\n")));
}

function subAgentSuffix(subAgent: SubAgentExecution): string {
  const duration = formatDuration(subAgent.startedAt, subAgent.completedAt);
  return duration ? ` (${duration})` : "";
}

/** `"3.2s"` when both ISO timestamps parse and are ordered, else `null`. */
function formatDuration(
  startedAt: string | undefined,
  completedAt: string | undefined,
): string | null {
  if (!startedAt || !completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Prefixes every line with `> ` (blockquote), including blank lines. */
function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

/**
 * Wraps content in a code fence sized past its longest backtick run, so
 * content containing ``` can never terminate the block early.
 */
function fenced(content: string, language = ""): string {
  let longest = 0;
  for (const match of content.matchAll(/`+/g)) {
    if (match[0].length > longest) longest = match[0].length;
  }
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

// ============================================================================
// JSON serialization
// ============================================================================

/**
 * Renders the transcript as a plain JSON value for programmatic analysis.
 *
 * Proto parts serialize through `toJson` with `useProtoFieldName: true` —
 * the platform-wide protojson parity contract (snake_case fields, int64 as
 * strings, `fromJson` round-trippable). Never `JSON.stringify` a raw proto
 * object here: int64 fields are `bigint` and would throw.
 *
 * One deliberate omission: `status.callback_token` is stripped. It is an
 * internal Temporal task token (runtime plumbing for workflow-triggered
 * executions), not conversation material, and has no place in a document
 * users share and paste around.
 */
export function transcriptToJson(transcript: SessionTranscript): JsonValue {
  const turns: JsonValue[] = transcript.turns.map((turn) => {
    const execution = toJson(AgentExecutionSchema, turn.execution, {
      useProtoFieldName: true,
    });
    if (
      execution !== null &&
      typeof execution === "object" &&
      !Array.isArray(execution)
    ) {
      const status = execution["status"];
      if (status !== null && typeof status === "object" && !Array.isArray(status)) {
        delete (status as Record<string, unknown>)["callback_token"];
      }
    }
    return {
      user_prompt: turn.userPrompt,
      build_from_plan: turn.isBuildFromPlan || undefined,
      superseded: turn.superseded || undefined,
      in_progress: turn.inProgress || undefined,
      execution,
    } as unknown as JsonValue;
  });

  const resolvedOutputs: Record<string, JsonValue> = {};
  for (const [key, output] of Object.entries(transcript.resolvedOutputs)) {
    resolvedOutputs[key] = {
      storage_key: output.storageKey,
      content: output.content,
      truncated: output.truncated || undefined,
      total_size_bytes: output.totalSizeBytes,
      mime_type: output.mimeType,
      is_image: output.isImage || undefined,
      error: output.error,
    } as unknown as JsonValue;
  }

  return {
    format: "stigmer.ai/session-transcript/v1",
    session: toJson(SessionSchema, transcript.session, {
      useProtoFieldName: true,
    }),
    includes_superseded: transcript.includesSuperseded,
    turns,
    resolved_outputs: resolvedOutputs,
  };
}
