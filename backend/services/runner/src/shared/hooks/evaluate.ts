/**
 * The hook evaluator: one native tool call against the turn's hooks, in
 * Claude Code's format, with Claude Code's answers.
 *
 * PreToolUse ({@link HookEvaluator.preToolUse}) finds the groups whose
 * matcher takes the call's Claude name (`matcher.ts`, over `tool-view.ts`),
 * keeps the handlers whose `if` takes the call (`condition.ts`), runs them
 * all at once, and combines their answers as Claude does:
 * deny > defer > ask > allow. The hook recorded as the decider is the first
 * source, in the agent's order, that gave the winning answer, or, when a
 * winner rewrote the call, the first that did: the row names the hook
 * whose rewrite runs. A hook's `ask`
 * on a call its own "approve all" leased counts as its `allow`: the lease
 * clears exactly the asks that hook makes on that tool, and nothing wider
 * (`approval-policy.ts` `hookLeaseKey`). PostToolUse
 * ({@link HookEvaluator.postToolUse}) runs after a call succeeded and
 * returns what its hooks hand back to the model.
 *
 * It holds no engine state and imports no engine: the native gate
 * (`middleware/approval-gate.ts`) decides what an answer does to the call.
 * Its one effect on the world is running commands, through an injected
 * {@link HookProcessRunner} (`run.ts`), each in a span `stigmer.hook.run`.
 *
 * What a hook reads on stdin is Claude Code's input for the event:
 * `session_id` (the Stigmer session), an empty `transcript_path` (Stigmer
 * keeps no Claude transcript file), `cwd`, `permission_mode`,
 * `hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`, `mcp_server`
 * for an MCP tool, `agent_id` and `agent_type` inside a sub-agent, and on
 * PostToolUse `tool_response`.
 *
 * Its environment is the agent shell's (`buildShellEnv`, the runner's own
 * credentials stripped), plus `CLAUDE_PROJECT_DIR`, and for a plugin's hook
 * `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, the open format's
 * `PLUGIN_ROOT`, and `CLAUDE_PLUGIN_OPTION_<KEY>` for each value its hooks
 * reference in exec form; a key no exec-form handler references is not
 * exported, unlike Claude Code, which exports every declared option
 * (stigmer#1912). The three path variables are also substituted in `command`
 * and `args`, and `${user_config.KEY}` in an exec-form handler's; a
 * shell-form command that reaches for `${user_config.KEY}` does not run, as
 * in Claude Code, because the shell would re-parse the value.
 */

import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { HookHandler } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { hookLeaseKey } from "../approval-policy.js";
import { parsePostToolUse, parsePreToolUse, type HookDecision, type PreToolUseAnswer } from "./answer.js";
import { conditionVerdict } from "./condition.js";
import { USER_CONFIG_REFERENCE, type HookEntry, type HookEvent, type HookSet, type HookSource } from "./hook-set.js";
import { matcherMatches } from "./matcher.js";
import { DEFAULT_HOOK_TIMEOUT_SECONDS, runHookProcess, type HookProcessRunner, type HookRunResult } from "./run.js";
import { claudeToolResponse, type NativeToolViews, type ToolView } from "./tool-view.js";

/** Claude Code's `permission_mode` values this runner reports. */
export type HookPermissionMode = "default" | "plan" | "bypassPermissions";

/** The call a hook is asked about, as the engine made it. */
export interface HookToolCall {
  readonly id: string;
  /** The bound (native) name. */
  readonly name: string;
  readonly args: Record<string, unknown>;
  /** The MCP server the tool belongs to; `""` for a built-in. */
  readonly serverSlug: string;
}

/** Which graph made the call: a sub-agent's carries its type and invocation id. */
export interface HookCallScope {
  readonly subAgent?: { readonly type: string; readonly id: string };
}

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
  readonly views: NativeToolViews;
  readonly sessionId: string;
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

const TRACER_NAME = "stigmer-runner";
const SPAN_HOOK_RUN = "stigmer.hook.run";

/** One handler's answer, with where it came from. */
interface Answered extends PreToolUseAnswer {
  readonly source: HookSource;
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

  constructor(private readonly deps: HookEvaluatorDeps) {
    this.run = deps.run ?? runHookProcess;
  }

  /** The call as hooks see it; `undefined` when no hook may see it. */
  viewOf(call: HookToolCall): ToolView | undefined {
    return this.deps.views.viewOf(call.name, call.args);
  }

  async preToolUse(call: HookToolCall, scope: HookCallScope): Promise<PreToolUseOutcome> {
    const view = this.viewOf(call);
    if (view === undefined) return NO_PRE_TOOL_USE;
    const runs = this.matching("PreToolUse", view);
    if (runs.length === 0) return NO_PRE_TOOL_USE;

    const answers = await Promise.all(
      runs.map(async ({ entry, handler, sure }): Promise<Answered> => {
        const answer = withoutUnsureAllow(
          parsePreToolUse(await this.runOne(entry, handler, "PreToolUse", view, call, scope)),
          sure,
          entry.source,
        );
        const leased = (answer.decision === "ask" || answer.decision === "defer")
          && this.deps.leases.has(hookLeaseKey(entry.source.plugin, call.serverSlug, call.name));
        return { ...answer, ...(leased ? { decision: "allow" as const } : {}), source: entry.source, leased };
      }),
    );
    return this.combine(call, answers);
  }

  /** PostToolUse for a call that succeeded; `output` is the text the engine returned. */
  async postToolUse(call: HookToolCall, scope: HookCallScope, output: string): Promise<PostToolUseOutcome> {
    const view = this.viewOf(call);
    if (view === undefined) return NO_POST_TOOL_USE;
    const runs = this.matching("PostToolUse", view);
    if (runs.length === 0) return NO_POST_TOOL_USE;
    const response = claudeToolResponse(view, output);

    const answers = await Promise.all(
      runs.map(async ({ entry, handler }) =>
        parsePostToolUse(await this.runOne(entry, handler, "PostToolUse", view, call, scope, response)),
      ),
    );
    return {
      blockReasons: answers.flatMap((a) => (a.blockReason !== undefined ? [a.blockReason] : [])),
      additionalContext: answers.flatMap((a) => (a.additionalContext ? [a.additionalContext] : [])),
      errors: answers.flatMap((a) => (a.error !== undefined ? [a.error] : [])),
    };
  }

  /**
   * The handlers to run for this call, in source order, each with whether
   * its `if` matched for sure (no `if` is a sure match).
   */
  private matching(
    event: HookEvent,
    view: ToolView,
  ): { readonly entry: HookEntry; readonly handler: HookHandler; readonly sure: boolean }[] {
    const conditionContext = { workspaceRoot: this.deps.workspaceRoot, homeDir: this.deps.homeDir };
    return this.deps.set
      .forEvent(event)
      .filter((entry) => matcherMatches(entry.matcher, view.toolName))
      .flatMap((entry) =>
        entry.handlers.flatMap((handler) => {
          const verdict = handler.condition === "" ? "match" : conditionVerdict(handler.condition, view, conditionContext);
          return verdict === "no" ? [] : [{ entry, handler, sure: verdict === "match" }];
        }),
      );
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
    const rewrite = rewriter?.updatedInput;
    return {
      decision: decider.decision === "defer" ? "ask" : decider.decision,
      hook: decider.source.plugin,
      leased: decider.leased,
      reason: decider.reason ?? "",
      ...(rewrite !== undefined ? { updatedArgs: this.deps.views.nativeArgsOf(call.name, rewrite) } : {}),
      additionalContext,
      errors,
    };
  }

  /** Run one handler, the plugin's tree verified first, in a span. */
  private async runOne(
    entry: HookEntry,
    handler: HookHandler,
    event: HookEvent,
    view: ToolView,
    call: HookToolCall,
    scope: HookCallScope,
    response?: unknown,
  ): Promise<HookRunResult> {
    const { source } = entry;
    const command = this.commandOf(source, handler);
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

    const stdin = JSON.stringify({
      session_id: this.deps.sessionId,
      transcript_path: "",
      cwd: this.deps.workspaceRoot,
      permission_mode: this.deps.permissionMode,
      hook_event_name: event,
      tool_name: view.toolName,
      tool_input: view.toolInput,
      tool_use_id: call.id,
      ...(view.mcpServer ? { mcp_server: view.mcpServer } : {}),
      ...(scope.subAgent ? { agent_id: scope.subAgent.id, agent_type: scope.subAgent.type } : {}),
      ...(event === "PostToolUse" ? { tool_response: response } : {}),
    });

    const span = trace.getTracer(TRACER_NAME).startSpan(SPAN_HOOK_RUN, {
      attributes: {
        "stigmer.hook.source": label(source),
        "stigmer.hook.event": event,
        "stigmer.hook.matcher": entry.matcher,
        "stigmer.hook.tool": view.toolName,
      },
    });
    const started = performance.now();
    try {
      const result = await this.run(
        {
          ...command,
          timeoutSeconds: handler.timeoutSeconds > 0 ? handler.timeoutSeconds : DEFAULT_HOOK_TIMEOUT_SECONDS,
          cwd: this.deps.workspaceRoot,
          env: this.envOf(source),
          stdin,
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

  /** The command and arguments to spawn, placeholders substituted; a string says why it cannot run. */
  private commandOf(
    source: HookSource,
    handler: HookHandler,
  ): { readonly command: string; readonly args: readonly string[] | null } | string {
    const execForm = handler.args.length > 0;
    if (!execForm && handler.command.includes("${user_config.")) {
      return "a shell-form command cannot reference ${user_config.*}; pass the value in args (exec form)";
    }
    const substitute = (value: string): string => {
      let out = value.replaceAll("${CLAUDE_PROJECT_DIR}", this.deps.workspaceRoot);
      if (source.root !== "") {
        out = out.replaceAll("${CLAUDE_PLUGIN_ROOT}", source.root).replaceAll("${CLAUDE_PLUGIN_DATA}", source.data);
      }
      if (execForm) {
        out = out.replace(USER_CONFIG_REFERENCE, (match, key: string) => source.options.get(key) ?? match);
      }
      return out;
    };
    return {
      command: substitute(handler.command),
      args: execForm ? handler.args.map(substitute) : null,
    };
  }

  private envOf(source: HookSource): Record<string, string> {
    const env: Record<string, string> = { ...this.deps.baseEnv, CLAUDE_PROJECT_DIR: this.deps.workspaceRoot };
    if (source.root !== "") {
      env["CLAUDE_PLUGIN_ROOT"] = source.root;
      env["CLAUDE_PLUGIN_DATA"] = source.data;
      env["PLUGIN_ROOT"] = source.root;
      // Python would otherwise write `__pycache__` into the plugin's tree,
      // which the tamper guard then rebuilds before every later run.
      env["PYTHONDONTWRITEBYTECODE"] = "1";
    }
    for (const [key, value] of source.options) env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`] = value;
    return env;
  }
}

/** A source as logs and spans name it. */
function label(source: HookSource): string {
  return source.plugin === "" ? "the agent's hooks" : `plugin ${source.plugin}`;
}
