/*
 * The spike's throwaway Claude adapter: the least a `HarnessAdapter` needs to
 * run the real engine through Stigmer's own turn runtime, so the defer round trip can
 * be asked of the runtime's approval loop (depth iii) and questions 7 and 8
 * of its transcript and usage.
 *
 * What it does, and no more:
 *  - `boot` imports the SDK dynamically, as a vendor SDK must be;
 *  - `runTurn` runs one `query()`, resuming the engine's session when this
 *    process has seen the Stigmer session before (an in-memory map; the
 *    session store is probed on its own);
 *  - the gate the spike measured to hold (the batch probe, arms b and c): the
 *    PreToolUse callback defers the first undecided Bash call of a process
 *    and refuses every later one with "issue this call on its own", allows
 *    an approved one and denies a rejected one; an ask rule over Bash brings
 *    every Bash call to `canUseTool`, which allows only calls approved by id
 *    and refuses the rest, because the re-fired hook misses about one resume
 *    in twelve and the engine then decides on its own;
 *  - a resume with a waiting call carries no prompt, through an iterable
 *    held open until the result (the SDK answers the re-fired hook over it);
 *  - the SDK's messages become `TranscriptEvent`s, usage is reported per
 *    model call from the last assistant message of each `message.id`, and a
 *    deferred result ends the turn `awaiting_approval` after an
 *    `approval_proposed` event.
 *
 * It is never registered in `HARNESS_ADAPTERS`: the spike's test puts it in
 * the Cursor row behind `loopbackHostedRow`, so nothing on `main` changes.
 */

import type { HookCallbackMatcher, Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { CURSOR_CAPABILITIES } from "../../activities/execute-cursor/cursor-capabilities.js";
import type { HarnessCapabilities } from "../../harness/capabilities.js";
import type { TranscriptEvent } from "../../harness/transcript/events.js";
import type { HarnessAdapter, TurnInput, TurnOutcome, TurnSink, UsageDelta } from "../../harness/types.js";
import { ApprovalAction } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

type ClaudeSdk = typeof import("@anthropic-ai/claude-agent-sdk");

export interface ClaudeSpikeAdapterOptions {
  /** The engine's whole environment for a session (built from nothing). */
  envFor(sessionId: string): Record<string, string>;
  model: string;
  /** Every SDK message the adapter saw and every event it applied, for the message tally. */
  onTrace?: (entry: { message?: SDKMessage; events?: TranscriptEvent[]; usage?: UsageDelta }) => void;
}

export const CLAUDE_SPIKE_CAPABILITIES: HarnessCapabilities = {
  ...CURSOR_CAPABILITIES,
  pausePrimitive: "interrupt",
};

const AGENT_TOOLS = new Set(["Agent", "Task"]);

/**
 * A promptless prompt held open until released: the SDK answers the engine's
 * hook and permission requests over the stdin this iterable feeds, so it
 * must stay open until the resumed turn's result (an iterable that closes at
 * once gets the deferred call refused).
 */
function heldEmptyPrompt(): { prompt: AsyncIterable<SDKUserMessage>; release(): void } {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    prompt: {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<SDKUserMessage>> => {
          await released;
          return { done: true, value: undefined };
        },
      }),
    },
    release,
  };
}

/** The SDK's messages to the runtime's transcript vocabulary. */
export class ClaudeSpikeTranslator {
  private openMessage: { id: string; subAgentId?: string } | undefined;
  private readonly agentCalls = new Set<string>();
  private readonly usageById = new Map<string, UsageDelta>();
  private readonly reported = new Set<string>();

  translate(message: SDKMessage): TranscriptEvent[] {
    switch (message.type) {
      case "assistant": {
        const scope = message.parent_tool_use_id === null ? {} : { subAgentId: message.parent_tool_use_id };
        const out: TranscriptEvent[] = [];
        const u = message.message.usage;
        this.usageById.set(message.message.id, {
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
          model: message.message.model,
        });
        for (const block of message.message.content) {
          if (block.type === "text") {
            if (this.openMessage?.id !== message.message.id) {
              out.push(...this.closeMessage());
              this.openMessage = { id: message.message.id, ...scope };
              out.push({ kind: "message_start", runId: message.message.id, ...scope });
            }
            out.push({ kind: "text_delta", runId: message.message.id, text: block.text, ...scope });
          } else if (block.type === "thinking") {
            out.push({ kind: "reasoning_delta", runId: message.message.id, text: block.thinking, ...scope });
          } else if (block.type === "tool_use") {
            out.push(...this.closeMessage());
            const input = (block.input ?? {}) as Record<string, unknown>;
            const mcp = /^mcp__([^_]+(?:_[^_]+)*)__/.exec(block.name);
            out.push({ kind: "tool_started", callId: block.id, name: block.name, input, mcpServerSlug: mcp?.[1] ?? "", ...scope });
            if (AGENT_TOOLS.has(block.name)) {
              this.agentCalls.add(block.id);
              out.push({
                kind: "sub_agent_started",
                subAgentId: block.id,
                name: String(input.subagent_type ?? "general-purpose"),
                subject: String(input.description ?? ""),
                input: String(input.prompt ?? ""),
              });
            }
          }
        }
        return out;
      }
      case "user": {
        const content = message.message.content;
        if (typeof content === "string") return [];
        const scope = message.parent_tool_use_id === null ? {} : { subAgentId: message.parent_tool_use_id };
        const out: TranscriptEvent[] = [];
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const text =
            typeof block.content === "string"
              ? block.content
              : (block.content ?? []).map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n");
          out.push(
            block.is_error === true
              ? { kind: "tool_error", callId: block.tool_use_id, message: text, ...scope }
              : { kind: "tool_finished", callId: block.tool_use_id, result: text, ...scope },
          );
          if (this.agentCalls.has(block.tool_use_id)) {
            out.push(
              block.is_error === true
                ? { kind: "sub_agent_failed", subAgentId: block.tool_use_id, error: text }
                : { kind: "sub_agent_finished", subAgentId: block.tool_use_id, output: text },
            );
          }
        }
        return out;
      }
      case "system":
        if (message.subtype === "compact_boundary") return [...this.closeMessage(), { kind: "context_compacted" }];
        return [];
      default:
        return [];
    }
  }

  closeMessage(): TranscriptEvent[] {
    const open = this.openMessage;
    this.openMessage = undefined;
    if (open === undefined) return [];
    return [{ kind: "message_finish", runId: open.id, ...(open.subAgentId !== undefined ? { subAgentId: open.subAgentId } : {}) }];
  }

  /** Usage of every model call whose last message has been seen, each reported once. */
  drainUsage(currentId: string | undefined): UsageDelta[] {
    const out: UsageDelta[] = [];
    for (const [id, usage] of this.usageById) {
      if (id === currentId || this.reported.has(id)) continue;
      this.reported.add(id);
      out.push(usage);
    }
    return out;
  }
}

export function createClaudeSpikeAdapter(options: ClaudeSpikeAdapterOptions): HarnessAdapter {
  let sdk: ClaudeSdk | undefined;
  // Stigmer session id -> the engine's session id. The session-store probe replaces this with the store.
  const engineSessions = new Map<string, string>();

  return {
    name: "claude-spike",
    capabilities: CLAUDE_SPIKE_CAPABILITIES,
    async boot() {
      sdk = await import("@anthropic-ai/claude-agent-sdk");
    },
    async shutdown() {},
    async releaseSession(sessionId) {
      engineSessions.delete(sessionId);
    },
    async runTurn(input: TurnInput, sink: TurnSink): Promise<TurnOutcome> {
      if (sdk === undefined) return { kind: "failed", message: "claude-spike: not booted", surface: "internal" };
      const translator = new ClaudeSpikeTranslator();
      const decisions = input.approvalDecisions;
      const resumeId = engineSessions.get(input.sessionId);
      const waiting = decisions.size > 0;
      const abort = new AbortController();
      const onStop = (): void => abort.abort();
      sink.stopSignal.addEventListener("abort", onStop);

      const decide = (toolUseId: string): ApprovalAction | undefined => decisions.get(toolUseId);
      let deferredThisProcess: string | undefined;
      const hooks: Partial<Record<"PreToolUse", HookCallbackMatcher[]>> = {
        PreToolUse: [
          {
            hooks: [
              async (hookInput) => {
                if (hookInput.hook_event_name !== "PreToolUse" || hookInput.tool_name !== "Bash") return {};
                const action = decide(hookInput.tool_use_id);
                if (action === ApprovalAction.APPROVE || action === ApprovalAction.APPROVE_ALL) {
                  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } };
                }
                if (action !== undefined) {
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse",
                      permissionDecision: "deny",
                      permissionDecisionReason: input.approvalDenyMessages.get(hookInput.tool_use_id) || "The person declined this call.",
                    },
                  };
                }
                if (deferredThisProcess === undefined || deferredThisProcess === hookInput.tool_use_id) {
                  deferredThisProcess = hookInput.tool_use_id;
                  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "defer" } };
                }
                return {
                  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "issue this call on its own" },
                };
              },
            ],
          },
        ],
      };
      const queryOptions: Options = {
        cwd: input.workspace.primaryDir,
        model: options.model,
        settingSources: [],
        settings: { permissions: { ask: ["Bash"] } },
        permissionMode: "default",
        env: options.envFor(input.sessionId),
        abortController: abort,
        hooks,
        canUseTool: async (_name, toolInput, opts) => {
          const action = decide(opts.toolUseID);
          return action === ApprovalAction.APPROVE || action === ApprovalAction.APPROVE_ALL
            ? { behavior: "allow", updatedInput: toolInput }
            : { behavior: "deny", message: "issue this call on its own" };
        },
        ...(resumeId !== undefined ? { resume: resumeId } : {}),
      };
      const held = resumeId !== undefined && waiting ? heldEmptyPrompt() : undefined;
      const prompt = held?.prompt ?? (input.execution.spec?.message ?? "");

      let currentId: string | undefined;
      try {
        for await (const message of sdk.query({ prompt, options: queryOptions })) {
          sink.recordActivity(message.type);
          if ("session_id" in message && typeof message.session_id === "string" && !engineSessions.has(input.sessionId)) {
            engineSessions.set(input.sessionId, message.session_id);
            await sink.bindHarnessState(message.session_id);
          }
          const events = translator.translate(message);
          for (const event of events) sink.transcript.apply(event);
          if (message.type === "assistant") currentId = message.message.id;
          const usage = translator.drainUsage(message.type === "assistant" ? currentId : undefined);
          for (const delta of usage) sink.reportUsage(delta);
          options.onTrace?.({ message, events, ...(usage.length > 0 ? { usage: usage[0] } : {}) });
          if (message.type === "result") {
            held?.release();
            for (const event of translator.closeMessage()) sink.transcript.apply(event);
            for (const delta of translator.drainUsage(undefined)) sink.reportUsage(delta);
            const deferred = message.subtype === "success" ? message.deferred_tool_use : undefined;
            // Keyed on the deferred call, not on terminal_reason: a session
            // that defers again ends with terminal_reason null (the defer probe).
            if (deferred !== undefined && deferred !== null) {
              const proposed: TranscriptEvent = {
                kind: "approval_proposed",
                callId: deferred.id,
                name: deferred.name,
                mcpServerSlug: "",
                args: deferred.input,
                message: `Approve ${deferred.name}?`,
              };
              sink.transcript.apply(proposed);
              options.onTrace?.({ events: [proposed] });
              await sink.requestPersist();
              return { kind: "awaiting_approval" };
            }
            if (message.is_error) {
              return { kind: "failed", message: message.subtype === "success" ? message.result : message.errors.join("; "), surface: "engine" };
            }
            await sink.requestPersist();
            return { kind: "completed" };
          }
        }
        return sink.stopSignal.aborted ? { kind: "interrupted" } : { kind: "failed", message: "claude-spike: the engine ended with no result", surface: "engine" };
      } catch (error) {
        if (sink.stopSignal.aborted) return { kind: "interrupted" };
        return { kind: "failed", message: error instanceof Error ? error.message : String(error), surface: "engine", cause: error };
      } finally {
        held?.release();
        sink.stopSignal.removeEventListener("abort", onStop);
      }
    },
  };
}
