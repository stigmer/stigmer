/**
 * The Claude harness's hooks for one turn: the runtime's resolved sources
 * (`TurnInput.hooks`, every plugin mounted and verified) turned into the
 * evaluators the gate runs (`gate.ts`), through the setup every engine
 * shares (`shared/hooks/setup.ts`, which says what a hook runs with and
 * when the turn is refused).
 *
 * One evaluator per caller, as the native engine builds them
 * (`execute-deep-agent/hooks-setup.ts`): the main agent's over the
 * conversation's sources; a saved sub-agent's over the conversation's, then
 * its own, each of its own in its own environment, with its servers' names;
 * a plugin's sub-agent runs the main agent's, since it brings no hooks of
 * its own. What is this harness's is how its calls look to a hook
 * (`hook-views.ts`).
 *
 * The hooks' feedback ({@link HookFeedback}): after a call the gate let run,
 * what its `PreToolUse` hooks handed back, then, when it succeeded, what
 * its `PostToolUse` hooks hand back (their reasons for blocking, then their
 * context), as native's "Hook feedback:" section
 * (`shared/hooks/messages.ts`). The model reads it through the engine's
 * `additionalContext`, inside the call's result for every tool (measured on
 * SDK 0.3.310: a built-in's output cannot carry it, `updatedToolOutput`
 * reaching the model for an MCP tool alone); the stream's result does not
 * carry it, so the translator appends the same section to the call's row
 * (`translator.ts`), which reads as native's.
 */

import type { HookCallback, HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import type { TurnInput, TurnSink, TurnSubagent } from "../../harness/types.js";
import type { HookEvaluator } from "../../shared/hooks/evaluate.js";
import { hookFeedbackSection } from "../../shared/hooks/messages.js";
import { buildHookEvaluator, hookPermissionMode } from "../../shared/hooks/setup.js";
import { hookServerNamesOf } from "../../shared/hooks/tool-view.js";
import type { Caller, GateVerdict } from "./gate.js";
import { ClaudeToolViews } from "./hook-views.js";
import { HOST_SHELL_TOOL, isHostShell } from "./host-shell.js";

/** Every caller's evaluator: the main agent's, and each saved sub-agent's by its type; `null` where the caller has no hook. */
export interface TurnHookEvaluators {
  readonly root: HookEvaluator | null;
  readonly subagents: ReadonlyMap<string, HookEvaluator | null>;
}

/** No caller has a hook. */
export const NO_HOOKS: TurnHookEvaluators = { root: null, subagents: new Map() };

/** The turn's evaluators (the header). Throws `HookSetupError` when a hook cannot run as written. */
export async function turnHookEvaluators(
  input: TurnInput,
  sink: Pick<TurnSink, "stopSignal" | "recordActivity">,
  stallTimeoutMs: number,
): Promise<TurnHookEvaluators> {
  const root = await evaluatorOf(input, sink, stallTimeoutMs);
  const subagents = new Map<string, HookEvaluator | null>();
  for (const subagent of input.subagents) subagents.set(subagent.name, await evaluatorOf(input, sink, stallTimeoutMs, subagent));
  return { root, subagents };
}

async function evaluatorOf(
  input: TurnInput,
  sink: Pick<TurnSink, "stopSignal" | "recordActivity">,
  stallTimeoutMs: number,
  subagent?: TurnSubagent,
): Promise<HookEvaluator | null> {
  const primaryDir = input.workspace.primaryDir;
  return buildHookEvaluator({
    sources:
      subagent === undefined
        ? input.hooks.sources
        : [...input.hooks.sources, ...subagent.hooks.map((source) => ({ ...source, shellValues: subagent.values, subagent: subagent.name }))],
    runValues: input.values,
    mcpServers: subagent === undefined ? input.mcp.servers : [...input.mcp.servers, ...subagent.servers],
    views: new ClaudeToolViews({
      workspaceRoot: primaryDir,
      serverNames: new Map([...input.hooks.serverNames, ...hookServerNamesOf(subagent?.servers ?? [])]),
      platformServerSlugs: input.mcp.platformServerSlugs,
    }),
    sessionId: input.sessionId,
    executionId: input.executionId,
    model: input.model.requested,
    workspaceRoot: primaryDir,
    permissionMode: hookPermissionMode(input.execution.spec?.interactionMode === InteractionMode.PLAN, input.mcp.leases.global),
    leases: input.mcp.leases.hooks,
    signal: sink.stopSignal,
    onActivity: (detail) => sink.recordActivity(detail),
    stallTimeoutMs,
  });
}

/** The evaluator a caller's calls run: a saved sub-agent's own, else the main agent's. */
export function evaluatorFor(hooks: TurnHookEvaluators, caller: Caller): HookEvaluator | null {
  return caller.kind === "root" ? hooks.root : (hooks.subagents.get(caller.type) ?? hooks.root);
}

/** What the feedback reads beside the hooks. */
export interface HookFeedbackDeps {
  readonly hooks: TurnHookEvaluators;
  readonly verdictOf: (toolUseId: string) => GateVerdict | undefined;
  readonly serverOf: (toolName: string) => { readonly slug: string; readonly tool: string } | undefined;
}

/** The hooks' feedback on the calls of one invocation (the header). */
export class HookFeedback {
  private readonly sections = new Map<string, string>();

  constructor(private readonly deps: HookFeedbackDeps) {}

  /** The section appended to a call's result, once its result is in; undefined when no hook said anything. */
  sectionOf(toolUseId: string): string | undefined {
    return this.sections.get(toolUseId);
  }

  /** The engine's `PostToolUse` and `PostToolUseFailure` callbacks. */
  callbacks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const after: HookCallback = async (input) => {
      if (input.hook_event_name !== "PostToolUse" && input.hook_event_name !== "PostToolUseFailure") return {};
      const succeeded = input.hook_event_name === "PostToolUse";
      const section = await this.feedbackOf(input.tool_use_id, input.agent_id, succeeded ? outputText(input.tool_response) : undefined);
      return section === undefined ? {} : { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: section } };
    };
    return { PostToolUse: [{ hooks: [after] }], PostToolUseFailure: [{ hooks: [after] }] };
  }

  /** The section for a call the gate let run; `output` is its text when it succeeded. */
  private async feedbackOf(toolUseId: string, agentId: string | undefined, output: string | undefined): Promise<string | undefined> {
    const verdict = this.deps.verdictOf(toolUseId);
    if (verdict?.kind !== "allow") return undefined;
    const feedback = [...verdict.context];
    const evaluator = evaluatorFor(this.deps.hooks, verdict.caller);
    if (output !== undefined && evaluator !== null) {
      const server = this.deps.serverOf(verdict.toolName);
      const call = {
        id: toolUseId,
        name: server?.tool ?? (isHostShell(verdict.toolName) ? HOST_SHELL_TOOL.engineName : verdict.toolName),
        args: verdict.args,
        serverSlug: server?.slug ?? "",
        ...(server !== undefined ? { rowName: verdict.toolName } : {}),
      };
      const scope = verdict.caller.kind === "subagent" && agentId !== undefined ? { subAgent: { type: verdict.caller.type, id: agentId } } : {};
      const post = await evaluator.postToolUse(call, scope, output);
      feedback.push(...post.blockReasons, ...post.additionalContext);
      for (const error of post.errors) console.warn(`[hooks] a PostToolUse hook failed: ${error}`);
    }
    if (feedback.length === 0) return undefined;
    const section = hookFeedbackSection(feedback);
    this.sections.set(toolUseId, section);
    return section;
  }
}

/** A tool's response as the text a hook reads: an MCP tool's text blocks, a read's content, a string as it is, anything else as JSON. */
export function outputText(response: unknown): string {
  if (typeof response === "string") return response;
  if (Array.isArray(response)) {
    return response.flatMap((block: unknown) => {
      const b = block as { type?: unknown; text?: unknown };
      return b.type === "text" && typeof b.text === "string" ? [b.text] : [];
    }).join("\n");
  }
  const file = (response as { file?: { content?: unknown } } | null)?.file;
  if (typeof file?.content === "string") return file.content;
  return JSON.stringify(response ?? "");
}
