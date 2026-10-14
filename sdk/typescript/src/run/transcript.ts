// The canonical, full-fidelity session transcript (stigmer/stigmer#814).
//
// A session's whole conversation — thinking included, tool calls with their
// offloaded outputs resolved, subagent threads, the asks and their answers,
// timestamps — assembled ONCE here so every consumer (the SessionViewer
// export control, the CLI, an embedder's backend analysis job) reads the
// same authoritative record instead of re-deriving it.
//
// The record is the session's event log (Claude Managed Agents events,
// `SessionQueryController.listEvents`), folded by the one fold every client
// reads a conversation with (`foldSession`, @stigmer/session-log). The
// session's runs are read only for what a turn's record says about the turn
// itself: whether an edit replaced it, whether it builds from a plan, and
// when it started.
//
// Canonical rules, decided for #814:
//   - Fidelity beats noise suppression. Thinking, the platform's own notes,
//     each ask and its answer are carried verbatim; presentation-layer
//     cleanups stay in the presentation layers. The transcript is raw
//     material for improving agents — the judgment signal lives in exactly
//     the parts a polished view hides. The one thing left out is a repeat:
//     a `session.error` saying what the turn's own status already says.
//   - Each item renders once, in the order the agent produced it, and a
//     subagent's thread renders inside the `task` call that opened it.
//   - Superseded turns (edit-and-resubmit, the successor run's
//     `spec.supersedes_run_id`) are excluded by default, matching what the
//     conversation view shows; `includeSuperseded: true` keeps them, marked,
//     for the history-faithful variant.
//   - A turn that had not ended when the log was read exports as what the
//     log held then and is marked `inProgress` — honest about what a
//     mid-turn export is.
//   - A large tool output is stored whole beside its head; the transcript
//     resolves it through the tool use's full-output location.
//
// Like the rest of this folder, the module is framework-free: the fetch
// entry point takes a structural client slice, so it runs in React hosts,
// Node jobs, and the CLI alike.

import { create, toJson, type JsonValue } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type {
  GetArtifactContentRequest,
  GetArtifactContentResponse,
  ListRunsBySessionRequest,
  RunList,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import {
  GetArtifactContentRequestSchema,
  ListRunsBySessionRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type {
  ListSessionEventsRequest,
  SessionEventList,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { ListSessionEventsRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  foldSession,
  toManagedAgentsJson,
  type Thread,
  type ToolFullOutput,
  type ToolUse,
  type Turn,
  type TurnItem,
} from "@stigmer/session-log";
import { everyEntry } from "../pages.js";
import { resolvedSubject } from "../session.js";
import { deletedReferenceLabel, isDeletedReference } from "../references.js";
import { isBuildFromPlanTurn, supersededRunIds } from "./conversation-rules.js";

// ============================================================================
// Model
// ============================================================================

/**
 * The fetched content of one offloaded tool output (a tool use's
 * {@link ToolFullOutput}), keyed in the transcript by its storage key —
 * the one identifier that is unique across runs and subagents.
 */
export interface ResolvedToolOutput {
  /** The full output's `storage_key` this content belongs to. */
  readonly storageKey: string;
  /**
   * The resolved text, possibly truncated at the server's content cap
   * (512 KB by default). `undefined` when the fetch failed or was skipped —
   * serializers fall back to the tool result's head.
   */
  readonly content?: string;
  /** `true` when the server truncated {@link content} at the byte cap. */
  readonly truncated: boolean;
  /** Full stored size in bytes, when known. */
  readonly totalSizeBytes?: number;
  /** MIME type recorded with the output. */
  readonly mimeType: string;
  /** `true` for image outputs — never inlined; serializers note them. */
  readonly isImage: boolean;
  /** Fetch failure, when resolution was attempted and failed. */
  readonly error?: string;
}

/** One turn of the conversation, with the canonical rules' verdicts
 * precomputed so consumers never re-derive them. */
export interface TranscriptTurn {
  /** The run that is the turn. */
  readonly runId: string;
  /** The turn as the fold reads it: its items, threads, asks, status. */
  readonly turn: Turn;
  /** The turn's own events, in log order: the record the fold read. */
  readonly events: readonly SessionEvent[];
  /**
   * The user prose that opened this turn, or `null` when the turn has none
   * (no message, the `"execute"` placeholder, a Build-from-plan label).
   */
  readonly userPrompt: string | null;
  /** `true` for a Build-from-plan turn (machine-labeled, no user prose). */
  readonly isBuildFromPlan: boolean;
  /** `true` when the turn was replaced by an edit-and-resubmit. Only ever
   * `true` when the transcript was assembled with `includeSuperseded`. */
  readonly superseded: boolean;
  /** `true` when the turn had not ended when the log was read. */
  readonly inProgress: boolean;
  /** When the turn's run started, as its record says; `undefined` before it did. */
  readonly startedAt: string | undefined;
}

/** The canonical whole-conversation record of one session. */
export interface SessionTranscript {
  /** The session, verbatim. */
  readonly session: Session;
  /** The conversation's turns, in log order. */
  readonly turns: readonly TranscriptTurn[];
  /**
   * Fetched offloaded tool outputs, keyed by storage key. Empty when
   * resolution was skipped; serializers then fall back to each tool
   * result's head.
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
 * Assembles the canonical transcript from a session, its events (in log
 * order) and its runs.
 *
 * Pure — same inputs, same transcript. The turns are the fold's, in log
 * order; a run's record contributes only the superseded and Build-from-plan
 * rules (`conversation-rules.ts`, shared with the conversation view) and its
 * start time. An event of no run (the session's own status) belongs to no
 * turn.
 */
export function assembleSessionTranscript(
  session: Session,
  events: readonly SessionEvent[],
  runs: readonly Run[],
  options?: AssembleSessionTranscriptOptions,
): SessionTranscript {
  const includeSuperseded = options?.includeSuperseded === true;
  const superseded = supersededRunIds(runs);
  const runsById = new Map(runs.map((run) => [run.metadata?.id ?? "", run]));
  const eventsByRun = new Map<string, SessionEvent[]>();
  for (const event of events) {
    const list = eventsByRun.get(event.runId);
    if (list === undefined) {
      eventsByRun.set(event.runId, [event]);
    } else {
      list.push(event);
    }
  }

  const turns: TranscriptTurn[] = [];
  for (const turn of foldSession(events).turns) {
    const isSuperseded = superseded.has(turn.runId);
    if (isSuperseded && !includeSuperseded) continue;
    const run = runsById.get(turn.runId);
    const isBuildFromPlan = run !== undefined && isBuildFromPlanTurn(run);
    turns.push({
      runId: turn.runId,
      turn,
      events: eventsByRun.get(turn.runId) ?? [],
      userPrompt: userPromptOf(turn, isBuildFromPlan),
      isBuildFromPlan,
      superseded: isSuperseded,
      inProgress: !turn.ended,
      startedAt: run?.status?.startedAt || undefined,
    });
  }

  return {
    session,
    turns,
    resolvedOutputs: options?.resolvedOutputs ?? {},
    includesSuperseded: includeSuperseded,
  };
}

/**
 * The user prose that opened a turn, or `null`: a turn with no message, the
 * legacy `"execute"` placeholder stamped on runs started without one, and a
 * Build-from-plan turn's machine-written label are not user prose.
 */
function userPromptOf(turn: Turn, isBuildFromPlan: boolean): string | null {
  const text = turn.userMessage?.text ?? "";
  if (text === "" || text === "execute" || isBuildFromPlan) {
    return null;
  }
  return text;
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
    listEvents(input: ListSessionEventsRequest): Promise<SessionEventList>;
  };
  readonly run: {
    listBySession(
      input: ListRunsBySessionRequest,
    ): Promise<RunList>;
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
   * Fetch offloaded tool outputs so the transcript carries them in full
   * instead of their heads. Defaults to `true` — resolution is the fidelity
   * bar of #814. Individual fetch failures never fail the export; the
   * failed output falls back to its head, with the error recorded on its
   * {@link ResolvedToolOutput}.
   */
  readonly resolveOutputs?: boolean;
  /** Concurrent output fetches. Defaults to 4. */
  readonly concurrency?: number;
}

/** The most events one listEvents page returns. */
const EVENT_PAGE_SIZE = 1000;

/** The most runs one listBySession page returns. */
const RUN_PAGE_SIZE = 100;

/**
 * Fetches everything a session's transcript needs and assembles it: the
 * session, its whole event log (every page, oldest first), and every one
 * of its runs, walked page by page, so no superseded turn is misjudged for
 * want of a run on a later page.
 */
export async function fetchSessionTranscript(
  client: SessionTranscriptClient,
  sessionId: string,
  options?: FetchSessionTranscriptOptions,
): Promise<SessionTranscript> {
  const [session, runs, events] = await Promise.all([
    client.session.get(sessionId),
    listAllRuns(client, sessionId),
    listAllEvents(client, sessionId),
  ]);

  const transcript = assembleSessionTranscript(session, events, runs, {
    includeSuperseded: options?.includeSuperseded,
  });
  if (options?.resolveOutputs === false) {
    return transcript;
  }
  const resolvedOutputs = await resolveOffloadedOutputs(
    client,
    transcript.turns.map((t) => t.turn),
    { concurrency: options?.concurrency },
  );
  return { ...transcript, resolvedOutputs };
}

/** Every run of a session, walking every page. */
async function listAllRuns(
  client: Pick<SessionTranscriptClient, "run">,
  sessionId: string,
): Promise<Run[]> {
  const runs: Run[] = [];
  const pages = everyEntry((pageToken) =>
    client.run.listBySession(
      create(ListRunsBySessionRequestSchema, { sessionId, pageSize: RUN_PAGE_SIZE, pageToken }),
    ),
  );
  for await (const run of pages) runs.push(run);
  return runs;
}

/** Every event of a session, oldest first, walking every page. */
async function listAllEvents(
  client: Pick<SessionTranscriptClient, "session">,
  sessionId: string,
): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  let pageToken = "";
  do {
    const page = await client.session.listEvents(
      create(ListSessionEventsRequestSchema, { sessionId, pageSize: EVENT_PAGE_SIZE, pageToken }),
    );
    events.push(...page.events);
    pageToken = page.nextPageToken;
  } while (pageToken !== "");
  return events;
}

/**
 * Fetches the content behind every offloaded tool output in the given
 * turns (primary and subagent threads alike), keyed by storage key.
 *
 * Image outputs are never fetched — serializers render them as notes. Each
 * output is read from the run whose tool use it belongs to: a subagent's
 * call is its turn's, so its output is stored under that run too.
 */
export async function resolveOffloadedOutputs(
  client: Pick<SessionTranscriptClient, "run">,
  turns: readonly Turn[],
  options?: { readonly concurrency?: number },
): Promise<Record<string, ResolvedToolOutput>> {
  const outputs = new Map<string, { readonly runId: string; readonly full: ToolFullOutput }>();
  for (const turn of turns) {
    for (const tool of allToolUses(turn.items)) {
      if (tool.fullOutput !== undefined && tool.fullOutput.storageKey !== "") {
        outputs.set(tool.fullOutput.storageKey, { runId: tool.runId, full: tool.fullOutput });
      }
    }
  }

  const resolved: Record<string, ResolvedToolOutput> = {};
  const decoder = new TextDecoder("utf-8", { fatal: false });

  await mapWithConcurrency(
    [...outputs.values()],
    options?.concurrency ?? 4,
    async ({ runId, full }) => {
      const base = {
        storageKey: full.storageKey,
        mimeType: full.mimeType,
        isImage: full.isImage,
        totalSizeBytes: Number(full.sizeBytes),
      };
      if (full.isImage) {
        resolved[full.storageKey] = { ...base, truncated: false };
        return;
      }
      try {
        const response = await client.run.getArtifactContent(
          create(GetArtifactContentRequestSchema, {
            runId,
            storageKey: full.storageKey,
          }),
        );
        resolved[full.storageKey] = {
          ...base,
          content: decoder.decode(response.content),
          truncated: response.truncated,
          totalSizeBytes: Number(response.totalSizeBytes),
        };
      } catch (e) {
        resolved[full.storageKey] = {
          ...base,
          truncated: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  return resolved;
}

/** Every tool use in a list of items — its own and each subagent thread's, at any depth. */
function* allToolUses(items: readonly TurnItem[]): Generator<ToolUse> {
  for (const item of items) {
    if (item.kind !== "tool_use") continue;
    yield item;
    if (item.thread !== undefined) {
      yield* allToolUses(item.thread.items);
    }
  }
}

/**
 * Runs `fn` over `items` with at most `limit` in flight.
 *
 * The pool is one iterator shared by every worker: each worker pulls the next
 * item the moment it is free, so the work distributes itself without index
 * bookkeeping. A rejecting `fn` fails its own worker (and so the whole call)
 * while the other workers keep draining — array iterators carry no `return`,
 * so one loop's exit never closes the shared source.
 */
async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const pending = items.values();
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (const item of pending) {
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
 * (User / Assistant / Thinking / System), thinking and the platform's notes
 * are blockquoted, tool calls carry fenced input and output with their ask
 * and answer, and subagent threads are blockquoted sections. Fences
 * self-size past any backtick runs in the content, so hostile content
 * cannot break out of its block.
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
  const agentRef = session.spec?.agentRef;
  if (isDeletedReference(agentRef)) {
    out.push(`- Agent: ${deletedReferenceLabel(ApiResourceKind.agent)}`);
  } else if (agentRef !== undefined && agentRef.slug !== "") {
    out.push(`- Agent: \`${agentRef.org}/${agentRef.slug}\``);
  }
  out.push(`- Turns: ${turns.length}`);
  if (transcript.includesSuperseded) {
    out.push("- Includes superseded (edited-and-resubmitted) turns");
  }
  if (options?.generatedAt) out.push(`- Exported: ${options.generatedAt}`);

  for (const [i, entry] of turns.entries()) {
    out.push("", "---", "");
    out.push(`## Turn ${i + 1}${entry.startedAt ? ` · ${entry.startedAt}` : ""}`);

    if (entry.superseded) {
      out.push("", "_Superseded by an edited resubmission._");
    }
    if (entry.inProgress) {
      out.push("", "_In progress at export time — content is what the log held then._");
    }
    if (entry.isBuildFromPlan) {
      out.push("", "_Build from plan._");
    }

    if (entry.userPrompt !== null) {
      out.push("", "**User**", "", entry.userPrompt);
    }

    renderItems(out, entry.turn.items, resolvedOutputs);

    const { turn } = entry;
    if (turn.structuredOutput !== undefined) {
      out.push("", "**Structured output**", "", fenced(JSON.stringify(turn.structuredOutput, null, 2), "json"));
    }
    const runError = turn.status?.error ?? "";
    for (const error of turn.errors) {
      if (error.message === runError) continue;
      out.push("", `**Error** (\`${error.type}\`)`, "", blockquote(error.message));
    }
    if (runError) {
      out.push("", "**Run error**", "", blockquote(runError));
    }
  }

  out.push("");
  return out.join("\n");
}

/** Renders one thread's items — the turn's primary thread or a subagent's. */
function renderItems(
  out: string[],
  items: readonly TurnItem[],
  resolvedOutputs: Readonly<Record<string, ResolvedToolOutput>>,
): void {
  for (const item of items) {
    switch (item.kind) {
      case "message":
        if (item.text.trim()) {
          out.push("", "**Assistant**", "", item.text);
        }
        continue;
      case "thinking":
        out.push("", "**Thinking**", "", blockquote(item.text));
        continue;
      case "note":
        out.push("", "**System**", "", blockquote(item.text));
        continue;
      case "compacted":
        out.push("", "_Context compacted._");
        continue;
      case "tool_use":
        if (item.thread !== undefined) {
          renderSubagent(out, item, item.thread, resolvedOutputs);
        } else {
          renderToolUse(out, item, resolvedOutputs);
        }
        continue;
      /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
      default: {
        const exhaustive: never = item;
        throw new Error(`unknown turn item ${String(exhaustive)}`);
      }
    }
  }
}

function renderToolUse(
  out: string[],
  tool: ToolUse,
  resolvedOutputs: Readonly<Record<string, ResolvedToolOutput>>,
): void {
  const name = tool.mcpServerName ? `${tool.mcpServerName}/${tool.name}` : tool.name;
  out.push("", `**Tool — \`${name}\`**${toolSuffix(tool)}`);

  // The input is a google.protobuf.Struct, which protobuf-es represents
  // as a plain JsonObject — safe to stringify directly (no bigint fields).
  const input = JSON.stringify(tool.input, null, 2);
  if (input !== "{}") {
    out.push("", fenced(input, "json"));
  }

  for (const line of answerLines(tool)) {
    out.push("", line);
  }

  const output = toolOutputText(tool, resolvedOutputs);
  if (output.note) out.push("", `_${output.note}_`);
  if (output.text) {
    out.push("", ...(tool.result?.isError ? ["Error:", ""] : []), fenced(output.text));
  }
}

/** The ask a tool use made and the answer it got, one line each. */
function answerLines(tool: ToolUse): string[] {
  const lines: string[] = [];
  if (tool.ask !== undefined) {
    lines.push(`_Asked for approval${tool.ask.message ? `: ${tool.ask.message}` : ""}._`);
  }
  if (tool.confirmation?.result === "deny") {
    lines.push(`_Denied${tool.confirmation.denyMessage ? `: ${tool.confirmation.denyMessage}` : ""}._`);
  } else if (tool.grant !== undefined) {
    lines.push("_Allowed, with every call of its class for the rest of the turn._");
  } else if (tool.confirmation !== undefined) {
    lines.push("_Allowed._");
  }
  return lines;
}

/** The output text and honesty note for a tool use, applying the
 * offload-resolution fallbacks. */
function toolOutputText(
  tool: ToolUse,
  resolvedOutputs: Readonly<Record<string, ResolvedToolOutput>>,
): { text?: string; note?: string } {
  const head = tool.result?.text || undefined;
  const full = tool.fullOutput;
  if (full === undefined || full.storageKey === "") {
    return { text: head };
  }
  if (full.isImage) {
    return {
      note: `Image output (${full.mimeType || "image"}, ${Number(full.sizeBytes)} bytes) — not inlined.`,
    };
  }
  const resolved = resolvedOutputs[full.storageKey];
  if (resolved?.content !== undefined) {
    return {
      text: resolved.content,
      note: resolved.truncated
        ? `Output truncated at ${resolved.content.length} of ${resolved.totalSizeBytes} bytes (server content cap).`
        : undefined,
    };
  }
  return {
    text: head,
    note: resolved?.error
      ? `Offloaded output unavailable (${resolved.error}) — showing its head.`
      : "Offloaded output not resolved — showing its head.",
  };
}

const TOOL_STATE_LABELS: Readonly<Record<ToolUse["state"], string>> = {
  running: "running",
  waiting: "waiting for approval",
  completed: "completed",
  failed: "failed",
  denied: "denied",
  stopped: "stopped",
};

function toolSuffix(tool: ToolUse): string {
  const parts = [TOOL_STATE_LABELS[tool.state]];
  const duration = formatDuration(tool.processedAt, tool.result?.processedAt);
  if (duration) parts.push(duration);
  return ` (${parts.join(" · ")})`;
}

/** A subagent's thread, inside the `task` call that opened it. */
function renderSubagent(
  out: string[],
  tool: ToolUse,
  thread: Thread,
  resolvedOutputs: Readonly<Record<string, ResolvedToolOutput>>,
): void {
  const nested: string[] = [];
  const title = thread.agentName || "subagent";
  const duration = formatDuration(tool.processedAt, tool.result?.processedAt);
  nested.push(`**Subagent — ${title}**${duration ? ` (${duration})` : ""}`);
  if (thread.input) {
    nested.push("", "Input:", "", thread.input);
  }
  renderItems(nested, thread.items, resolvedOutputs);
  if (thread.reply) {
    nested.push(
      "",
      ...(thread.state === "failed" ? ["Error:", "", fenced(thread.reply)] : ["Output:", "", thread.reply]),
    );
  }
  if (thread.state === "stopped") {
    nested.push("", "_Stopped before it finished._");
  }
  out.push("", blockquote(nested.join("\n")));
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
 * Each turn carries its events as Claude Managed Agents JSON (the shape
 * Anthropic's SDK types), in log order: the record itself, which any reader
 * can fold again. The session serializes through `toJson` with
 * `useProtoFieldName: true` — the platform-wide protojson parity contract
 * (snake_case fields, int64 as strings, `fromJson` round-trippable). Never
 * `JSON.stringify` a raw proto object here: int64 fields are `bigint` and
 * would throw. An event of a member this build does not know is left out.
 *
 * The format is `stigmer.ai/session-transcript/v3`. v2 held each turn's
 * whole run record as `run`, and v1 named it `execution`, the shape
 * executions had before they were named runs.
 */
export function transcriptToJson(transcript: SessionTranscript): JsonValue {
  const turns: JsonValue[] = transcript.turns.map((entry) => ({
    run_id: entry.runId,
    user_prompt: entry.userPrompt,
    build_from_plan: entry.isBuildFromPlan || undefined,
    superseded: entry.superseded || undefined,
    in_progress: entry.inProgress || undefined,
    started_at: entry.startedAt,
    events: entry.events
      .filter((event) => event.event.case !== undefined)
      .map(toManagedAgentsJson),
  }) as unknown as JsonValue);

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
    format: "stigmer.ai/session-transcript/v3",
    session: toJson(SessionSchema, transcript.session, {
      useProtoFieldName: true,
    }),
    includes_superseded: transcript.includesSuperseded,
    turns,
    resolved_outputs: resolvedOutputs,
  };
}
