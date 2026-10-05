/**
 * The hook evaluator: one tool call, on either engine, against the turn's
 * hooks in both formats, with each format's own answers.
 *
 * PreToolUse ({@link HookEvaluator.preToolUse}) offers the call to every
 * format's events for it at once (`formats/claude-code.ts`:
 * `PreToolUse`; `formats/cursor.ts`: `preToolUse`, `beforeShellExecution`,
 * `beforeMCPExecution`), each format seeing the call under its own names
 * (`tool-view.ts`). It keeps the groups whose matcher takes the call and
 * the handlers whose `if` takes it (`condition.ts`, Claude Code's only),
 * runs them all at once, and combines their answers as Claude does:
 * deny > defer > ask > allow. The hook recorded as the decider is the first
 * source, in the agent's order, that gave the winning answer, or, when a
 * winner rewrote the call, the first that did: the row names the hook
 * whose rewrite runs. A rewrite the engine cannot run as the hook wrote it
 * refuses the call, naming why, so a call never silently runs as the model
 * wrote it. A hook's `ask` on a call its own "approve all" leased counts as
 * its `allow`: the lease clears exactly the asks that hook makes on that
 * tool, and nothing wider (`approval-policy.ts` `hookLeaseKey`). PostToolUse
 * ({@link HookEvaluator.postToolUse}) runs after a call succeeded and
 * returns what its hooks hand back to the model.
 *
 * It holds no engine state and imports no engine: the native gate
 * (`middleware/approval-gate.ts`) and the Cursor engine's hook server
 * (`execute-cursor/hook-server.ts`) decide what an answer does to the call,
 * and each injects its engine's views. Its one effect on the world is
 * running commands, through an injected {@link HookProcessRunner}
 * (`run.ts`), each in a span `stigmer.hook.run`. What a hook reads on stdin
 * and in its environment is its format's (`formats/*.ts`).
 */

import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { HookHandler } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { hookLeaseKey } from "../approval-policy.js";
import type { HookDecision, PostToolUseAnswer, PreToolUseAnswer } from "./answer.js";
import { conditionVerdict } from "./condition.js";
import {
  CLAUDE_DEFAULT_TIMEOUT_SECONDS,
  claudeCommand,
  claudeEnv,
  claudeMatches,
  claudeStdin,
  parseClaudePost,
  parseClaudePre,
} from "./formats/claude-code.js";
import type { FormatContext, HookCommand, HookScope } from "./formats/common.js";
import {
  CURSOR_DEFAULT_TIMEOUT_SECONDS,
  cursorCommand,
  cursorEnv,
  cursorMatches,
  cursorPostEvents,
  cursorPreEvents,
  cursorStdin,
  parseCursorPost,
  parseCursorPre,
  type CursorEventTarget,
} from "./formats/cursor.js";
import type { HookEntry, HookEvent, HookFormatName, HookSet, HookSource } from "./hook-set.js";
import { runHookProcess, type HookProcessRunner, type HookRunResult } from "./run.js";
import { claudeToolResponse, type CallViews, type HookToolViews } from "./tool-view.js";

/** Claude Code's `permission_mode` values this runner reports. */
export type HookPermissionMode = "default" | "plan" | "bypassPermissions";

/** The call a hook is asked about, as the engine made it. */
export interface HookToolCall {
  readonly id: string;
  /** The engine's name for the tool (the bound name on native; the hook's `tool_name` on Cursor). */
  readonly name: string;
  readonly args: Record<string, unknown>;
  /** The MCP server the tool belongs to; `""` for a built-in. */
  readonly serverSlug: string;
  /**
   * The name the call's transcript row carries, when it differs from
   * `name` (the Cursor engine names a row by its stream name); a hook lease
   * is keyed by it, as the row that leased it was.
   */
  readonly rowName?: string;
}

/** Which graph made the call: a sub-agent's carries its type and invocation id. */
export type HookCallScope = HookScope;

/** The combined PreToolUse answer for one call. */
export interface PreToolUseOutcome {
  /** `ask` covers Claude's `defer`; `undefined` when no hook decided. */
  readonly decision: "allow" | "deny" | "ask" | undefined;
  /** The deciding source's plugin slug (`""` for the agent's own block); meaningful only with a decision. */
  readonly hook: string;
  /** The decision is an `allow` that a lease on the deciding hook's `ask` produced. */
  readonly leased: boolean;
  /** The deciding hook's reason; `""` when it gave none. */
  readonly reason: string;
  /** The deciding hook's rewritten arguments, already in the engine's shape. */
  readonly updatedArgs?: Record<string, unknown>;
  /** Every hook's `additionalContext`, in source order. */
  readonly additionalContext: readonly string[];
  /** Every hook run that failed, for the log. */
  readonly errors: readonly string[];
}

/** What PostToolUse hooks hand back to the model. */
export interface PostToolUseOutcome {
  readonly blockReasons: readonly string[];
  readonly additionalContext: readonly string[];
  readonly errors: readonly string[];
}

export interface HookEvaluatorDeps {
  readonly set: HookSet;
  readonly views: HookToolViews;
  readonly sessionId: string;
  /** The execution, Cursor's `generation_id`; `""` when not known. */
  readonly executionId?: string;
  /** The model the turn runs, Cursor's `model`; `""` when not known. */
  readonly model?: string;
  readonly workspaceRoot: string;
  readonly permissionMode: HookPermissionMode;
  /** The agent shell's environment, the runner's credentials already stripped. */
  readonly baseEnv: Readonly<Record<string, string>>;
  readonly homeDir: string;
  /** The hook leases this run holds (`ActiveLeases.hooks`). */
  readonly leases: ReadonlySet<string>;
  readonly run?: HookProcessRunner;
  /** The turn's stop; aborting it kills running hooks. */
  readonly signal?: AbortSignal;
  /** Told, every pulse of a running hook, that the turn is alive. */
  readonly onActivity?: (detail: string) => void;
  /** How often a running hook pulses (`run.ts` `activityPulseFor`); the runner's default when absent. */
  readonly activityPulseMs?: number;
}

/** No hook decided, no hook said anything. */
export const NO_PRE_TOOL_USE: PreToolUseOutcome = { decision: undefined, hook: "", leased: false, reason: "", additionalContext: [], errors: [] };
const NO_POST_TOOL_USE: PostToolUseOutcome = { blockReasons: [], additionalContext: [], errors: [] };

/** Claude's precedence; the higher rank wins. */
const RANK: Readonly<Record<HookDecision, number>> = { deny: 4, defer: 3, ask: 2, allow: 1 };

/** A handler's own timeout, else its format's default. */
export function defaultTimeoutSeconds(format: HookFormatName): number {
  return format === "cursor" ? CURSOR_DEFAULT_TIMEOUT_SECONDS : CLAUDE_DEFAULT_TIMEOUT_SECONDS;
}

const TRACER_NAME = "stigmer-runner";
const SPAN_HOOK_RUN = "stigmer.hook.run";

/** One handler to run for a call, the event it answers and what it reads on stdin. */
interface Run {
  readonly entry: HookEntry;
  readonly handler: HookHandler;
  /** The handler's `if` took the call for sure (no `if` is a sure match). */
  readonly sure: boolean;
  readonly event: HookEvent;
  /** The tool name the span records. */
  readonly tool: string;
  readonly stdin: Record<string, unknown>;
}

/** One handler's answer, with where it came from. */
interface Answered extends PreToolUseAnswer {
  readonly source: HookSource;
  readonly format: HookFormatName;
  readonly leased: boolean;
}

/**
 * A handler that ran because its `if` only might have matched keeps its
 * refusal and its ask, but not its allow (nor the rewrite that came with
 * it): an allow behind an unsure `if` would let a call its rule never names
 * skip the default's approval (`condition.ts`).
 */
function withoutUnsureAllow(answer: PreToolUseAnswer, sure: boolean, source: HookSource): PreToolUseAnswer {
  if (sure || answer.decision !== "allow") return answer;
  console.warn(`[hooks] ${label(source)}: an allow is not honoured where its \`if\` only might match the call`);
  const { decision: _allow, updatedInput: _rewrite, ...rest } = answer;
  return rest;
}

export class HookEvaluator {
  private readonly run: HookProcessRunner;
  private readonly ctx: FormatContext;

  constructor(private readonly deps: HookEvaluatorDeps) {
    this.run = deps.run ?? runHookProcess;
    this.ctx = {
      sessionId: deps.sessionId,
      executionId: deps.executionId ?? "",
      model: deps.model ?? "",
      workspaceRoot: deps.workspaceRoot,
      permissionMode: deps.permissionMode,
      baseEnv: deps.baseEnv,
    };
  }

  /** The longest any one of the turn's handlers may run, in seconds. */
  get longestTimeoutSeconds(): number {
    return this.deps.set.longestTimeoutSeconds(defaultTimeoutSeconds);
  }

  /** The tool's name as a hook sees it (Claude Code's when it has one); `undefined` when no hook may see the call. */
  viewOf(call: HookToolCall): { readonly toolName: string } | undefined {
    const views = this.deps.views.viewsOf(call);
    return views["claude-code"] ?? views.cursor;
  }

  async preToolUse(call: HookToolCall, scope: HookCallScope): Promise<PreToolUseOutcome> {
    const runs = this.matching(call, scope, "pre");
    if (runs.length === 0) return NO_PRE_TOOL_USE;

    const answers = await Promise.all(
      runs.map(async (run): Promise<Answered> => {
        const result = await this.runOne(run);
        const parsed = run.entry.format === "cursor" ? parseCursorPre(result, run.handler) : parseClaudePre(result);
        const answer = withoutUnsureAllow(parsed, run.sure, run.entry.source);
        // A lease answers the asks the hook makes on calls its rule names;
        // an ask behind an unsure `if` still reaches a person.
        const leased = run.sure
          && (answer.decision === "ask" || answer.decision === "defer")
          && this.deps.leases.has(hookLeaseKey(run.entry.source.plugin, call.serverSlug, call.rowName ?? call.name));
        return { ...answer, ...(leased ? { decision: "allow" as const } : {}), source: run.entry.source, format: run.entry.format, leased };
      }),
    );
    return this.combine(call, answers);
  }

  /** PostToolUse for a call that succeeded; `output` is the text the engine returned. */
  async postToolUse(call: HookToolCall, scope: HookCallScope, output: string): Promise<PostToolUseOutcome> {
    const runs = this.matching(call, scope, "post", output);
    if (runs.length === 0) return NO_POST_TOOL_USE;
    const answers: PostToolUseAnswer[] = await Promise.all(
      runs.map(async (run) => {
        const result = await this.runOne(run);
        return run.entry.format === "cursor" ? parseCursorPost(result) : parseClaudePost(result);
      }),
    );
    return {
      blockReasons: answers.flatMap((a) => (a.blockReason !== undefined ? [a.blockReason] : [])),
      additionalContext: answers.flatMap((a) => (a.additionalContext ? [a.additionalContext] : [])),
      errors: answers.flatMap((a) => (a.error !== undefined ? [a.error] : [])),
    };
  }

  /** The handlers to run for this call, in source order, each with the event it answers and its stdin. */
  private matching(call: HookToolCall, scope: HookCallScope, phase: "pre" | "post", output = ""): Run[] {
    const views: CallViews = this.deps.views.viewsOf(call);
    const claude = views["claude-code"];
    const cursor = views.cursor;
    const cursorEvents: readonly CursorEventTarget[] = cursor === undefined ? [] : phase === "pre" ? cursorPreEvents(cursor) : cursorPostEvents(cursor);
    const claudeEvent = phase === "pre" ? "PreToolUse" : "PostToolUse";
    const conditionContext = { workspaceRoot: this.deps.workspaceRoot, homeDir: this.deps.homeDir };

    const runs: Run[] = [];
    for (const entry of this.deps.set.all) {
      if (entry.format === "cursor") {
        const fired = cursorEvents.find((e) => e.event === entry.event);
        if (cursor === undefined || fired === undefined || !cursorMatches(entry.matcher, fired.target)) continue;
        const stdin = cursorStdin(fired.event, cursor, call.id, this.ctx, phase === "post" ? output : undefined);
        for (const handler of entry.handlers) {
          runs.push({ entry, handler, sure: true, event: fired.event, tool: cursor.toolName, stdin });
        }
        continue;
      }
      if (claude === undefined || entry.event !== claudeEvent || !claudeMatches(entry.matcher, claude)) continue;
      const stdin = claudeStdin(claudeEvent, claude, call.id, scope, this.ctx, phase === "post" ? claudeToolResponse(claude, output) : undefined);
      for (const handler of entry.handlers) {
        const verdict = handler.condition === "" ? "match" : conditionVerdict(handler.condition, claude, conditionContext);
        if (verdict === "no") continue;
        runs.push({ entry, handler, sure: verdict === "match", event: claudeEvent, tool: claude.toolName, stdin });
      }
    }
    return runs;
  }

  private combine(call: HookToolCall, answers: readonly Answered[]): PreToolUseOutcome {
    const decided = answers.filter((a): a is Answered & { decision: HookDecision } => a.decision !== undefined);
    const additionalContext = answers.flatMap((a) => (a.additionalContext ? [a.additionalContext] : []));
    const errors = answers.flatMap((a) => (a.error !== undefined ? [`${label(a.source)}: ${a.error}`] : []));
    for (const error of errors) console.warn(`[hooks] a hook made no decision: ${error}`);
    if (decided.length === 0) return { ...NO_PRE_TOOL_USE, additionalContext, errors };

    const top = Math.max(...decided.map((a) => RANK[a.decision]));
    const winners = decided.filter((a) => RANK[a.decision] === top);
    // The decider is the first winner in the agent's order, or the first
    // winner that rewrote the call when one did, so the hook the row names
    // is the hook whose rewrite runs.
    const rewriter = top === RANK.deny ? undefined : winners.find((a) => a.updatedInput !== undefined);
    const decider = rewriter ?? winners[0]!;
    const base = { hook: decider.source.plugin, leased: decider.leased, additionalContext, errors };
    if (rewriter?.updatedInput !== undefined) {
      const args = this.deps.views.argsFrom(call, rewriter.format, rewriter.updatedInput);
      if (typeof args === "string") {
        console.warn(`[hooks] ${label(rewriter.source)} rewrote a call this engine cannot run as rewritten: ${args}`);
        return {
          ...base,
          decision: "deny",
          leased: false,
          reason: `A hook rewrote this call in a way it cannot run as rewritten (${args}), so the call was refused.`,
        };
      }
      return { ...base, decision: decider.decision === "defer" ? "ask" : decider.decision, reason: decider.reason ?? "", updatedArgs: args };
    }
    return { ...base, decision: decider.decision === "defer" ? "ask" : decider.decision, reason: decider.reason ?? "" };
  }

  /** Run one handler, the plugin's tree verified first, in a span. */
  private async runOne(run: Run): Promise<HookRunResult> {
    const { entry, handler } = run;
    const { source } = entry;
    const command: HookCommand | string = entry.format === "cursor"
      ? cursorCommand(source, handler, this.ctx)
      : claudeCommand(source, handler, this.ctx);
    if (typeof command === "string") {
      return { exitCode: null, stdout: "", stderr: "", timedOut: false, spawnError: command };
    }
    try {
      await source.beforeRun?.();
    } catch (err) {
      // A tree the tamper guard cannot restore cannot run the hook as it was
      // installed, and skipping it would drop its policy: the call is refused
      // as a hook's exit 2 refuses it, naming why.
      const reason = `the plugin's files could not be restored to the installed version: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[hooks] ${label(source)}: ${reason}`);
      return { exitCode: 2, stdout: "", stderr: reason, timedOut: false };
    }

    const span = trace.getTracer(TRACER_NAME).startSpan(SPAN_HOOK_RUN, {
      attributes: {
        "stigmer.hook.source": label(source),
        "stigmer.hook.format": entry.format,
        "stigmer.hook.event": run.event,
        "stigmer.hook.matcher": entry.matcher,
        "stigmer.hook.tool": run.tool,
      },
    });
    const started = performance.now();
    try {
      const result = await this.run(
        {
          ...command,
          timeoutSeconds: handler.timeoutSeconds > 0 ? handler.timeoutSeconds : defaultTimeoutSeconds(entry.format),
          cwd: this.deps.workspaceRoot,
          env: entry.format === "cursor" ? cursorEnv(source, this.ctx) : claudeEnv(source, this.ctx),
          stdin: JSON.stringify(run.stdin),
        },
        {
          ...(this.deps.signal ? { signal: this.deps.signal } : {}),
          onPulse: () => this.deps.onActivity?.(`hook ${label(source)}`),
          ...(this.deps.activityPulseMs !== undefined ? { pulseMs: this.deps.activityPulseMs } : {}),
        },
      );
      span.setAttributes({
        "stigmer.hook.exit_code": result.exitCode ?? -1,
        "stigmer.hook.timed_out": result.timedOut,
        "stigmer.hook.duration_ms": Math.round(performance.now() - started),
      });
      if (result.spawnError !== undefined || result.timedOut) span.setStatus({ code: SpanStatusCode.ERROR });
      return result;
    } finally {
      span.end();
    }
  }
}

/** A source as logs and spans name it. */
function label(source: HookSource): string {
  return source.plugin === "" ? "the agent's hooks" : `plugin ${source.plugin}`;
}
