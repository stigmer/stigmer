/*
 * The engine-fit spike's probe harness: one place that runs Anthropic's real
 * engine (the CLI the Agent SDK spawns) against Stigmer's wire-level model
 * mock, under the isolation a Stigmer turn would use, and writes everything it
 * saw to evidence files.
 *
 * Throwaway. This branch is never merged; the probes answer whether the engine
 * fits before any of it is built for real. What survives is the evidence.
 *
 * Isolation, every process: no settings files (`settingSources: []`), the
 * default permission mode, a fresh config directory and home, and an
 * environment built from nothing (the SDK replaces the child's environment
 * whole when `env` is given), so nothing on this Mac reaches the engine.
 *
 * The mock is answered by a responder keyed on the conversation, never a FIFO:
 * the engine makes background calls, runs sub-agents and replays a session on
 * resume, so the same conversation state must always get the same answer.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  query,
  type HookCallbackMatcher,
  type HookPermissionDecision,
  type Options,
  type PreToolUseHookInput,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  type SpawnOptions,
  type SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import {
  MockLlmProxy,
  type CapturedLlmRequest,
  type RoutableRequest,
  type RoutedResponse,
} from "../../../../../../test/support/src/mock-llm.ts";
import {
  anthropicText,
  anthropicToolUses,
  type AnthropicMessageBody,
  type ToolUseBlock,
  type TokenUsageOptions,
} from "../../../../../../test/support/src/llm-wire.ts";

export { anthropicText, anthropicToolUses, type AnthropicMessageBody, type ToolUseBlock };

export const SPIKE_MODEL = "claude-sonnet-4-6";

// Where evidence lands: a directory the caller names, else one under the OS
// temp folder. The build copies what a question needs into the record.
export const EVIDENCE_DIR = process.env.SPIKE_EVIDENCE_DIR ?? join(tmpdir(), "claude-spike-evidence");
mkdirSync(EVIDENCE_DIR, { recursive: true });

export function evidencePath(name: string): string {
  return join(EVIDENCE_DIR, name);
}

export function writeEvidence(name: string, value: unknown): void {
  writeFileSync(evidencePath(name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

export function appendEvidence(name: string, value: unknown): void {
  appendFileSync(evidencePath(name), `${typeof value === "string" ? value : JSON.stringify(value)}\n`);
}

// ---------------------------------------------------------------------------
// The conversation a request carries, read for the responder.

export interface ToolResultSeen {
  toolUseId: string;
  text: string;
  isError: boolean;
}

export interface Conversation {
  path: string;
  model: string;
  system: string;
  toolNames: string[];
  messageCount: number;
  // The texts and tool results of the last user message.
  lastUserTexts: string[];
  lastToolResults: ToolResultSeen[];
  // Every user text in the conversation, oldest first.
  allUserTexts: string[];
  // Every tool_use id an assistant message in the history issued, and every
  // tool result anywhere in it: a scenario never re-issues a call it made.
  issuedToolUseIds: Set<string>;
  allToolResults: Map<string, ToolResultSeen>;
  headers: Record<string, string | string[] | undefined>;
  raw: Record<string, unknown>;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) => {
      const b = block as { type?: unknown; text?: unknown; content?: unknown };
      if (b.type === "text" && typeof b.text === "string") return b.text;
      if (b.type === "tool_result") return textOf(b.content);
      return "";
    })
    .join("\n");
}

export function readConversation(request: RoutableRequest): Conversation {
  const raw = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
  const messages = Array.isArray(raw.messages) ? (raw.messages as Array<{ role?: unknown; content?: unknown }>) : [];
  const userMessages = messages.filter((m) => m.role === "user");
  const last = messages.at(-1);
  const lastUserTexts: string[] = [];
  const lastToolResults: ToolResultSeen[] = [];
  if (last !== undefined && last.role === "user") {
    if (typeof last.content === "string") lastUserTexts.push(last.content);
    else if (Array.isArray(last.content)) {
      for (const block of last.content as Array<Record<string, unknown>>) {
        if (block.type === "text" && typeof block.text === "string") lastUserTexts.push(block.text);
        if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          lastToolResults.push({ toolUseId: block.tool_use_id, text: textOf(block.content), isError: block.is_error === true });
        }
      }
    }
  }
  const issuedToolUseIds = new Set<string>();
  const allToolResults = new Map<string, ToolResultSeen>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content as Array<Record<string, unknown>>) {
      if (m.role === "assistant" && block.type === "tool_use" && typeof block.id === "string") issuedToolUseIds.add(block.id);
      if (m.role === "user" && block.type === "tool_result" && typeof block.tool_use_id === "string") {
        allToolResults.set(block.tool_use_id, { toolUseId: block.tool_use_id, text: textOf(block.content), isError: block.is_error === true });
      }
    }
  }
  const system = typeof raw.system === "string" ? raw.system : textOf(raw.system);
  const tools = Array.isArray(raw.tools) ? (raw.tools as Array<{ name?: unknown }>) : [];
  return {
    path: request.path,
    model: typeof raw.model === "string" ? raw.model : "",
    system,
    toolNames: tools.map((t) => String(t.name ?? "")),
    messageCount: messages.length,
    lastUserTexts,
    lastToolResults,
    allUserTexts: userMessages.map((m) => textOf(m.content)),
    issuedToolUseIds,
    allToolResults,
    headers: request.headers,
    raw,
  };
}

// One line per request, for the side-call inventory and every probe's log.
export function describeRequest(c: Conversation): Record<string, unknown> {
  return {
    path: c.path,
    model: c.model,
    system: c.system.slice(0, 120),
    tools: c.toolNames.length,
    messages: c.messageCount,
    lastUser: c.lastUserTexts.map((t) => t.slice(0, 120)),
    toolResults: c.lastToolResults.map((r) => ({ id: r.toolUseId, isError: r.isError, text: r.text.slice(0, 160) })),
    stream: c.raw.stream,
    toolChoice: c.raw.tool_choice,
    maxTokens: c.raw.max_tokens,
  };
}

// ---------------------------------------------------------------------------
// The responder: background calls by signature, the probe's script for the rest.

export type Script = (c: Conversation) => AnthropicMessageBody | RoutedResponse | undefined;

// The engine's own background calls, learned by the side-call inventory and
// answered out of band so they never meet a probe's script. Each returns the
// signature's name, or undefined for an agent-loop call.
export function backgroundKind(c: Conversation): string | undefined {
  if (c.path.includes("count_tokens")) return "count_tokens";
  return undefined;
}

let toolSeq = 0;
// A tool-use id unique to this process, so a resumed session never meets an
// id another probe used.
export function toolId(label: string): string {
  toolSeq += 1;
  return `toolu_${label}_${process.pid}_${toolSeq}`;
}

export function toolUse(id: string, name: string, input: Record<string, unknown>, usage: TokenUsageOptions = {}): AnthropicMessageBody {
  return anthropicToolUses([{ toolCallId: id, toolName: name, toolInput: input }], usage);
}

export interface SpikeMock {
  mock: MockLlmProxy;
  url: string;
  requests(): readonly CapturedLlmRequest[];
  conversations(): Conversation[];
  close(): Promise<void>;
}

const REQUEST_CAP = 120;

// Starts the mock with the script; every request is logged to `<label>.requests.jsonl`.
export async function startSpikeMock(label: string, script: Script): Promise<SpikeMock> {
  const seen: Conversation[] = [];
  const log = `${label}.requests.jsonl`;
  writeEvidence(log, "");
  const route = (request: RoutableRequest): RoutedResponse | undefined => {
    const c = readConversation(request);
    seen.push(c);
    // A scripted conversation that loops is an instrument fault: fail fast.
    if (seen.length > REQUEST_CAP) return { error: { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: `spike mock: over ${REQUEST_CAP} requests` } } } };
    const kind = backgroundKind(c);
    const entry = { at: new Date().toISOString(), kind: kind ?? "agent", ...describeRequest(c) };
    if (kind === "count_tokens") {
      appendEvidence(log, { ...entry, answered: "count_tokens 100" });
      return { json: { input_tokens: 100 } };
    }
    const answer = script(c);
    const routed: RoutedResponse | undefined = answer === undefined ? undefined : "type" in answer ? { body: answer } : answer;
    appendEvidence(log, {
      ...entry,
      answered:
        routed === undefined ? "UNSCRIPTED (500)"
        : "body" in routed ? { id: routed.body.id, stop: routed.body.stop_reason, usage: routed.body.usage, blocks: routed.body.content.map((b) => (b.type === "tool_use" ? `tool_use ${b.name} ${b.id}` : b.type)) }
        : routed,
    });
    return routed;
  };
  const mock = new MockLlmProxy({ route });
  await mock.start();
  return {
    mock,
    url: mock.url(),
    requests: () => mock.requests(),
    conversations: () => seen,
    close: () => mock.close(),
  };
}

// ---------------------------------------------------------------------------
// Directories and environment, fresh per process.

export interface SpikeDirs {
  root: string;
  home: string;
  config: string;
  cwd: string;
}

export function freshDirs(label: string): SpikeDirs {
  const root = mkdtempSync(join(tmpdir(), `claude-spike-${label}-`));
  const dirs = { root, home: join(root, "home"), config: join(root, "config"), cwd: join(root, "work") };
  for (const dir of [dirs.home, dirs.config, dirs.cwd]) mkdirSync(dir, { recursive: true });
  return dirs;
}

export interface EnvOptions {
  mockUrl: string;
  dirs: Pick<SpikeDirs, "home" | "config">;
  apiKey?: string;
  scrub?: boolean;
  extra?: Record<string, string>;
}

// The engine's whole environment. Nothing is inherited from this process.
export function spikeEnv(options: EnvOptions): Record<string, string> {
  const env: Record<string, string> = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: options.dirs.home,
    CLAUDE_CONFIG_DIR: options.dirs.config,
    ANTHROPIC_BASE_URL: options.mockUrl,
    ANTHROPIC_API_KEY: options.apiKey ?? "sk-ant-spike-not-a-real-key",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
    // On Linux the scrub needs bubblewrap and the engine refuses to start
    // without it; SPIKE_SCRUB=0 runs a probe that measures something else
    // (start cost, sockets) where bubblewrap is absent. An arm that sets
    // `scrub` itself always wins.
    ...((options.scrub ?? process.env.SPIKE_SCRUB !== "0") ? { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" } : {}),
    ...options.extra,
  };
  return env;
}

export function baseOptions(dirs: SpikeDirs, mockUrl: string, extra: Partial<Options> = {}): Options {
  return {
    cwd: dirs.cwd,
    model: SPIKE_MODEL,
    settingSources: [],
    permissionMode: "default",
    // The message tally covers every message type, the streamed partials included.
    includePartialMessages: true,
    env: spikeEnv({ mockUrl, dirs }),
    stderr: (data: string) => appendEvidence("stderr.log", data.trimEnd()),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Spawning the engine ourselves, when a probe must see the process: its exit,
// its pid for a SIGKILL, its start time.

export interface TrackedProcess {
  child: ChildProcess;
  spawnedAt: number;
}

export function trackedSpawn(label: string): { processes: TrackedProcess[]; spawnClaudeCodeProcess: (options: SpawnOptions) => SpawnedProcess } {
  const processes: TrackedProcess[] = [];
  return {
    processes,
    spawnClaudeCodeProcess: (options) => {
      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stderr?.on("data", (data: Buffer) => appendEvidence(`${label}.stderr.log`, data.toString("utf8").trimEnd()));
      processes.push({ child, spawnedAt: Date.now() });
      return child as unknown as SpawnedProcess;
    },
  };
}

// ---------------------------------------------------------------------------
// Prompts: a string, or an iterable that yields nothing (the promptless
// resume a deferred call needs), closing at once or held open until released.

export function emptyPrompt(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => ({ done: true as const, value: undefined }),
    }),
  };
}

export interface HeldPrompt {
  prompt: AsyncIterable<SDKUserMessage>;
  release(): void;
  push(message: SDKUserMessage): void;
}

export function heldPrompt(): HeldPrompt {
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const prompt: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<SDKUserMessage>> => {
        while (queue.length === 0 && !closed) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        const value = queue.shift();
        if (value !== undefined) return { done: false, value };
        return { done: true, value: undefined };
      },
    }),
  };
  return {
    prompt,
    release: () => {
      closed = true;
      wake?.();
    },
    push: (message) => {
      queue.push(message);
      wake?.();
    },
  };
}

export function userMessage(text: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
}

// ---------------------------------------------------------------------------
// Running one query to its end, recording every message.

export interface RunResult {
  messages: SDKMessage[];
  result: SDKResultMessage | undefined;
  sessionId: string | undefined;
  error: string | undefined;
  wallMs: number;
  initMs: number | undefined;
}

export async function runQuery(
  label: string,
  prompt: string | AsyncIterable<SDKUserMessage>,
  options: Options,
  onMessage?: (message: SDKMessage) => void,
): Promise<RunResult> {
  const log = `${label}.messages.jsonl`;
  writeEvidence(log, "");
  const started = Date.now();
  const messages: SDKMessage[] = [];
  let result: SDKResultMessage | undefined;
  let sessionId: string | undefined;
  let error: string | undefined;
  let initMs: number | undefined;
  try {
    for await (const message of query({ prompt, options })) {
      messages.push(message);
      appendEvidence(log, { t: Date.now() - started, ...message });
      if (message.type === "system" && message.subtype === "init" && initMs === undefined) initMs = Date.now() - started;
      if ("session_id" in message && typeof message.session_id === "string") sessionId = message.session_id;
      if (message.type === "result") result = message;
      onMessage?.(message);
    }
  } catch (caught) {
    error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
    appendEvidence(log, { t: Date.now() - started, thrown: error });
  }
  return { messages, result, sessionId, error, wallMs: Date.now() - started, initMs };
}

// The summary line a probe prints and keeps: what the result said.
export type ResultFacts = {
  sessionId: string | undefined;
  error: string | undefined;
  subtype: string | undefined;
  isError: boolean | undefined;
  stopReason: string | null | undefined;
  terminalReason: string | undefined;
  deferred: unknown;
  numTurns: number | undefined;
  result: string | undefined;
  errors: string[] | undefined;
  wallMs: number;
  initMs: number | undefined;
};

export function resultSummary(run: RunResult): ResultFacts {
  const r = run.result as (SDKResultMessage & { terminal_reason?: string; deferred_tool_use?: unknown }) | undefined;
  return {
    sessionId: run.sessionId,
    error: run.error,
    subtype: r?.subtype,
    isError: r?.is_error,
    stopReason: r?.stop_reason,
    terminalReason: r?.terminal_reason,
    deferred: r?.deferred_tool_use,
    numTurns: r?.num_turns,
    result: r !== undefined && "result" in r ? r.result : undefined,
    errors: r !== undefined && "errors" in r ? r.errors : undefined,
    wallMs: run.wallMs,
    initMs: run.initMs,
  };
}

// ---------------------------------------------------------------------------
// The gate: one PreToolUse callback for every tool, recording what it saw.

export type GateDecision =
  | { decision: Exclude<HookPermissionDecision, "allow"> | "pass"; reason?: string }
  | { decision: "allow"; updatedInput?: Record<string, unknown> };

export interface HookSeen {
  toolName: string;
  toolUseId: string;
  input: unknown;
  agentId: string | undefined;
  agentType: string | undefined;
  sessionId: string;
  decided: string;
  at: number;
}

export function gateHooks(
  label: string,
  decide: (input: PreToolUseHookInput) => GateDecision,
  seen: HookSeen[],
): Partial<Record<"PreToolUse", HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PreToolUse") return {};
            const decision = decide(input);
            const record: HookSeen = {
              toolName: input.tool_name,
              toolUseId: input.tool_use_id,
              input: input.tool_input,
              agentId: input.agent_id,
              agentType: input.agent_type,
              sessionId: input.session_id,
              decided: decision.decision,
              at: Date.now(),
            };
            seen.push(record);
            appendEvidence(`${label}.hooks.jsonl`, record);
            if (decision.decision === "pass") return {};
            if (decision.decision === "allow") {
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "allow",
                  ...(decision.updatedInput !== undefined ? { updatedInput: decision.updatedInput } : {}),
                },
              };
            }
            return {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: decision.decision,
                ...(decision.reason !== undefined ? { permissionDecisionReason: decision.reason } : {}),
              },
            };
          },
        ],
      },
    ],
  };
}

export interface PermissionSeen {
  toolName: string;
  toolUseId: string;
  agentId: string | undefined;
  input: Record<string, unknown>;
  decisionReason: string | undefined;
  answered: string;
}

// A canUseTool that records every call and answers with `decide`.
export function recordingCanUseTool(
  label: string,
  seen: PermissionSeen[],
  decide: (toolName: string, toolUseId: string, input: Record<string, unknown>) => { allow: true } | { allow: false; message: string },
): NonNullable<Options["canUseTool"]> {
  return async (toolName, input, options) => {
    const answer = decide(toolName, options.toolUseID, input);
    const record: PermissionSeen = {
      toolName,
      toolUseId: options.toolUseID,
      agentId: options.agentID,
      input,
      decisionReason: options.decisionReason,
      answered: answer.allow ? "allow" : `deny: ${answer.message}`,
    };
    seen.push(record);
    appendEvidence(`${label}.permissions.jsonl`, record);
    return answer.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: answer.message };
  };
}

/**
 * A promptless resume, the one form measured to work: an iterable held open
 * until the result. The SDK carries hook and permission callbacks over the
 * same stdin the prompt feeds, so an iterable that closes at once leaves the
 * engine unable to hear the re-fired hook and the deferred call is refused
 * (the defer probe, `q1i-promptless-closed`).
 */
export async function runResume(label: string, options: Options, onMessage?: (message: SDKMessage) => void): Promise<RunResult> {
  const held = heldPrompt();
  try {
    return await runQuery(label, held.prompt, options, (m) => {
      onMessage?.(m);
      if (m.type === "result") held.release();
    });
  } finally {
    held.release();
  }
}
