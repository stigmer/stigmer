/**
 * The Claude harness's approval gate: one decision per tool call, made once
 * and read by both of the engine's mechanisms, which must agree.
 *
 * The engine asks twice. A `PreToolUse` callback fires for every call, and
 * `canUseTool` fires for every call an ask rule names (`permissions.ask:
 * ["*"]`, every call, set in `engine-options.ts`). Measured on the engine
 * before this was built: the callback can be skipped (about one resumed call
 * in twelve), and the engine then decides on its own. So both answer from
 * one memoized {@link ClaudeGate.decide}, keyed by the call's own id, and
 * `canUseTool` fails closed: a call the gate did not allow is refused there
 * whatever the callback said or failed to say. The host's shell asks the
 * same memo before it runs anything (`host-shell.ts`), a third check by the
 * same identity.
 *
 * Every call is judged as its caller's. The engine names the sub-agent a
 * call comes from (`agent_id` at `PreToolUse`, `agentID` at `canUseTool`,
 * absent on the main thread), and a `SubagentStart` callback, which fires
 * before a sub-agent's first call, tells the gate which definition that id
 * runs ({@link ClaudeGate.subagentStarted}); `PreToolUse`'s own
 * `agent_type` must agree. A call from a sub-agent the gate cannot name is
 * refused. Each caller has its own reach ({@link Reach}): the engine is
 * handed the union of every agent's tools and skills, since it has one pool
 * for the session (measured on SDK 0.3.310), and the gate holds each caller
 * to its own.
 *
 * The decision, in order, none of it needing a person:
 *
 *  0. A turn that is stopping or yielding runs no further call: its
 *     boundary is taken here, in the engine, before the call, never where
 *     the stream is read, which lags behind the engine (stigmer#2469).
 *  1. Closed world. The engine's own shell under its own name never runs
 *     (only the host's, `host-shell.ts`), and a call to anything outside
 *     the caller's reach (its built-ins, the host's shell, its servers'
 *     tools) is refused before any policy is asked, so no gap in a
 *     classification table can open the gate.
 *  2. Scope, which no approval widens. `Skill` loads only a skill of the
 *     caller's own, in plan mode too (a skill writes nothing). `Agent`
 *     starts only a defined helper, on its own definition: a call that
 *     sets a model, an effort, an isolation or the background is refused,
 *     never repaired. A file tool writes no platform content (`.stigmer/`
 *     but its outputs folder, the session's platform folder by any path)
 *     and nothing in the engine's own home, as the native engine's
 *     read-only mount holds (`shared/outputs.ts` `isReadOnlyPlatformPath`).
 *     A caller whose lists deny `Skill` reads no skill's files.
 *  3. The pre-armed "trust this whole run" allows everything else, as it
 *     does on every engine.
 *  4. The secret-like write block and the file-edit flows, the shared rules
 *     (`shared/file-edit-policy.ts`) over the turn's capture posture.
 *  5. The approval default (`shared/approval-policy.ts`
 *     `resolveToolApproval`), with this turn's leases and the bridge's MCP
 *     marks, over Claude Code's tool names, which the shared classification
 *     knows (`shared/tool-kind.ts`).
 *  6. Where the default would ask: an unattended turn skips the call, as
 *     every engine's gate does, with the shared sentence, whoever made it;
 *     a sub-agent's call is refused with {@link SUBAGENT_APPROVAL_MESSAGE},
 *     since a helper never pauses for a person; the main agent's is refused
 *     with {@link NEEDS_APPROVAL_MESSAGE}, because the pause this engine
 *     waits at (`defer`) is not wired yet. Nothing that needs a person ever
 *     runs.
 *
 * The engine's shell reaches the gate under its aliased name
 * (`mcp__stigmer__bash`, `host-shell.ts`), and the model may name that tool
 * itself: both are the shell to the gate. A path is resolved against the
 * workspace's primary directory, relative or absolute, `..` included, and
 * judged in the workspace's own dialect (`/` its root), so the outputs
 * folder and the capture substrate read it as they read the native
 * engine's. A path that resolves outside the workspace takes none of the
 * file-edit flows (capture, review off, the outputs folder are all about
 * the workspace's own files): the default decides it.
 *
 * Every refusal and every flow is recorded by call id, so the translator
 * stamps the row's provenance (`translator.ts`) and the settle folds the
 * unattended skips (`settle.ts`). `updatedInput` is never returned: a
 * changed input runs as changed.
 */

import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CanUseTool, HookCallback, HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";

import {
  isUnattendedApprovalMode,
  resolveToolApproval,
  unattendedSkipMessage,
  type ActiveLeases,
  type McpApprovalDefault,
  type PolicySource,
} from "../../shared/approval-policy.js";
import { blockedSecretPath, fileEditFlow, secretBlockMessage, type FileEditPosture } from "../../shared/file-edit-policy.js";
import { extractFilePath } from "../../shared/file-tools.js";
import { isReadOnlyPlatformPath, OUTPUTS_SUBDIR } from "../../shared/outputs.js";
import { SKILL_CONTENT_PATTERN } from "../../shared/skill-mount.js";
import { toolApprovalCategory } from "../../shared/tool-kind.js";
import type { TurnInput } from "../../harness/types.js";
import { HOST_SHELL_TOOL, isHostShell } from "./host-shell.js";
import { SKILL_PLUGINS_SUBDIR } from "./skill-plugins.js";

/** What a call that would wait for a person is refused with, until the pause lands. */
export const NEEDS_APPROVAL_MESSAGE = "This call needs a person's approval, which this engine does not ask for yet; it was not run.";

/** What a sub-agent's call that would wait for a person is refused with: a helper never pauses for one. */
export const SUBAGENT_APPROVAL_MESSAGE =
  "This call needs a person's approval, which a helper cannot ask for; ask the agent that delegated to you to run this. It was not run.";

/** What a call reached after the turn began to stop or yield is refused with. */
export const HALTED_MESSAGE = "The turn paused before this call; it was not run.";

/** What a call from a sub-agent the gate cannot name is refused with. */
export const UNKNOWN_CALLER_MESSAGE = "This call came from a helper this turn did not start; it was not run.";

/** What a call that writes platform content or the engine's own files is refused with. */
export const READ_ONLY_MESSAGE = "This path holds the platform's own files, which are read-only; it was not run. Save files for the person in the outputs folder.";

/** What a read of a skill's files is refused with when the caller's lists deny `Skill`. */
export const HIDDEN_SKILLS_MESSAGE = "Skill files are not available to this agent: its tool lists exclude Skill. It was not run.";

/** What a call to a tool the turn never offered is refused with. */
export function notOfferedMessage(toolName: string): string {
  return `Tool '${toolName}' is not available in this conversation; it was not run.`;
}

/** What a `Skill` call for a skill outside the caller's own is refused with. */
export function skillNotOwnedMessage(skill: string): string {
  return `Skill '${skill}' is not one of this agent's skills; it was not run.`;
}

/** What an `Agent` call for a helper the turn does not define is refused with. */
export function unknownHelperMessage(type: string): string {
  return `There is no helper named '${type}' in this conversation; it was not run.`;
}

/** What an `Agent` call that sets what a helper's definition decides is refused with. */
export function helperOverrideMessage(fields: readonly string[]): string {
  return `A helper runs on its own definition, so ${fields.map((f) => `'${f}'`).join(", ")} cannot be set; call it again without ${fields.length === 1 ? "it" : "them"}. It was not run.`;
}

/** The engine's tool that loads a skill. */
export const SKILL_TOOL = "Skill";

/** The engine's tool that starts a sub-agent. */
export const AGENT_TOOL = "Agent";

/** The fields an `Agent` call may carry: everything else is the definition's to decide (the header). */
const AGENT_INPUT_FIELDS: ReadonlySet<string> = new Set(["description", "prompt", "subagent_type", "name"]);

/** Who made a call: the main agent, or a sub-agent by the definition it runs. */
export type Caller = { readonly kind: "root" } | { readonly kind: "subagent"; readonly type: string };

/** The main agent as a caller. */
export const ROOT_CALLER: Caller = { kind: "root" };

/** What one agent of the turn may reach (the header, items 1 and 2). */
export interface Reach {
  /** The tool names it may call, as the engine reports them: its built-ins, the host's shell, its servers' `mcp__<slug>__<tool>`, and the engine's own it is offered. */
  readonly tools: ReadonlySet<string>;
  /** Every spelling of each of its own skills (`skill-plugins.ts` `spellingsOf`). */
  readonly skills: ReadonlySet<string>;
  /** The helpers it may start: the main agent's defined sub-agents; empty for a sub-agent. */
  readonly agentTypes: ReadonlySet<string>;
  /** Whether its lists deny `Skill` (`shared/tool-lists.ts` `hidesSkills`). */
  readonly hidesSkills: boolean;
}

/** One call's decision, with the caller it was judged as (absent when the caller could not be named). */
export type GateVerdict =
  | { readonly allow: true; readonly source: PolicySource | undefined; readonly caller: Caller }
  | {
      readonly allow: false;
      /** What the model reads, as the call's result. */
      readonly message: string;
      /** The policy layer that refused it, for the row; absent for a refusal no policy made. */
      readonly source: PolicySource | undefined;
      readonly caller: Caller | undefined;
    };

/** What the gate knows of the turn, read once before the engine starts. */
export interface GateFacts {
  /** The main agent's reach. */
  readonly root: Reach;
  /** Each sub-agent's reach, by the definition's name. */
  readonly subagents: ReadonlyMap<string, Reach>;
  /** The bridged server and tool a `mcp__` name stands for; undefined for a built-in. */
  readonly serverOf: (toolName: string) => { readonly slug: string; readonly tool: string } | undefined;
  readonly leases: ActiveLeases;
  readonly mcpDefault: McpApprovalDefault;
  /** Whether the turn's lane has no approver (`shared/approval-policy.ts` `isUnattendedApprovalMode`). */
  readonly unattended: boolean;
  /** The turn's capture posture, judged over paths in the workspace's dialect. */
  readonly posture: FileEditPosture;
  /** The workspace's primary directory, the root of that dialect. */
  readonly primaryDir: string;
  /** The session's platform folder, which the workspace reaches as `.stigmer`; undefined for a session without one. */
  readonly platformDir: string | undefined;
  /** The engine's own home for this invocation (`engine-env.ts`), where the turn's skills are written (`skill-plugins.ts`). */
  readonly engineHome: string;
  /** Whether a read of a path in the workspace's dialect opens a skill's files (`shared/skill-mount.ts` `skillContentReadCheck`). */
  readonly readsSkillContent: (workspacePath: string) => Promise<boolean>;
}

/** The gate's facts for a turn, from the runtime's record, the agents' reach and the bridge's marks. */
export function gateFactsOf(
  input: TurnInput,
  agents: { readonly root: Reach; readonly subagents: ReadonlyMap<string, Reach> },
  bridge: { readonly serverOf: GateFacts["serverOf"]; readonly mcpDefault: McpApprovalDefault },
  paths: { readonly platformDir: string | undefined; readonly engineHome: string; readonly readsSkillContent: GateFacts["readsSkillContent"] },
  isCapturablePath: (workspacePath: string) => Promise<boolean>,
): GateFacts {
  const { workspace } = input;
  return {
    root: agents.root,
    subagents: agents.subagents,
    serverOf: bridge.serverOf,
    leases: input.mcp.leases,
    mcpDefault: bridge.mcpDefault,
    unattended: isUnattendedApprovalMode(input.execution),
    posture: {
      fileCaptureMode: workspace.captureMode,
      fileReviewOff: !workspace.fileReview,
      fileCaptureSubstrate: workspace.captureSubstrate,
      isCapturablePath,
      // The engine's writes are not observed before they land, so an
      // ignored path is never routed into CAS capture: it goes to the default.
      captureIgnored: false,
    },
    primaryDir: workspace.primaryDir,
    ...paths,
  };
}

/** A call's path as the gate judges it: in the workspace's dialect when inside, else resolved. */
type JudgedPath = { readonly kind: "none" } | { readonly kind: "inside"; readonly workspacePath: string } | { readonly kind: "outside"; readonly absolute: string };

/** The one gate of a turn: the memo every mechanism reads (the header). */
export class ClaudeGate {
  private readonly verdicts = new Map<string, Promise<GateVerdict>>();
  private readonly settled = new Map<string, GateVerdict>();
  /** The definition each started sub-agent runs, by the engine's id for it. */
  private readonly started = new Map<string, string>();
  /** Calls an unattended turn skipped, each with the hook whose ask it was (`null`: the default's); the settle folds them. */
  readonly unattendedSkips = new Map<string, string | null>();

  constructor(
    private readonly facts: GateFacts,
    /** Whether the turn is stopping or yielding (the header, item 0). */
    private readonly halted: () => boolean = () => false,
  ) {}

  /** A sub-agent started: the engine's id for it, and the definition it runs. */
  subagentStarted(agentId: string, agentType: string): void {
    this.started.set(agentId, agentType);
  }

  /**
   * The decision for one call, made once per call id. `agentId` is the
   * engine's id for the sub-agent that made it, absent on the main thread;
   * `agentType`, when the engine reports it too, must name the definition
   * that id started.
   */
  decide(toolName: string, toolUseId: string, input: Record<string, unknown>, agentId?: string, agentType?: string): Promise<GateVerdict> {
    let verdict = this.verdicts.get(toolUseId);
    if (verdict === undefined) {
      verdict = this.judge(toolName, toolUseId, input, this.callerOf(agentId, agentType)).then((settled) => {
        this.settled.set(toolUseId, settled);
        return settled;
      });
      this.verdicts.set(toolUseId, verdict);
    }
    return verdict;
  }

  /** The decision already made for a call; undefined when none was. */
  verdictOf(toolUseId: string): GateVerdict | undefined {
    return this.settled.get(toolUseId);
  }

  /** The caller a call's ids name, with its reach; undefined for a sub-agent the gate cannot name. */
  private callerOf(agentId: string | undefined, agentType: string | undefined): { caller: Caller; reach: Reach } | undefined {
    if (agentId === undefined || agentId === "") return { caller: ROOT_CALLER, reach: this.facts.root };
    const type = this.started.get(agentId);
    if (type === undefined || (agentType !== undefined && agentType !== type)) return undefined;
    const reach = this.facts.subagents.get(type);
    return reach === undefined ? undefined : { caller: { kind: "subagent", type }, reach };
  }

  private async judge(toolName: string, toolUseId: string, input: Record<string, unknown>, who: { caller: Caller; reach: Reach } | undefined): Promise<GateVerdict> {
    const { facts } = this;
    if (this.halted()) return { allow: false, message: HALTED_MESSAGE, source: undefined, caller: who?.caller };
    if (who === undefined) return { allow: false, message: UNKNOWN_CALLER_MESSAGE, source: undefined, caller: undefined };
    const { caller, reach } = who;
    const refuse = (message: string, source?: PolicySource): GateVerdict => ({ allow: false, message, source, caller });
    if (toolName === HOST_SHELL_TOOL.engineName || !reach.tools.has(toolName)) return refuse(notOfferedMessage(toolName));
    if (toolName === SKILL_TOOL) return this.skill(input, reach, caller);
    if (toolName === AGENT_TOOL) {
      const refused = agentCallRefusal(input, reach);
      if (refused !== undefined) return refuse(refused);
    }

    const name = isHostShell(toolName) ? HOST_SHELL_TOOL.engineName : toolName;
    const server = facts.serverOf(toolName);
    const serverSlug = server?.slug ?? "";
    const policyName = server?.tool ?? name;
    const category = serverSlug ? undefined : toolApprovalCategory(name);
    const path = this.judgedPath(input);
    if ((category === "write" || category === "delete") && this.isReadOnly(path)) return refuse(READ_ONLY_MESSAGE);
    if (reach.hidesSkills && name === "Read" && (await this.opensSkillContent(path))) return refuse(HIDDEN_SKILLS_MESSAGE);
    if (facts.leases.global) return { allow: true, source: "auto_approve_all", caller };

    const inside = path.kind !== "outside";
    const args = path.kind === "inside" ? { ...input, path: path.workspacePath } : input;
    const posture = inside ? facts.posture : { ...facts.posture, isCapturablePath: async () => false };
    const secret = await blockedSecretPath(posture, args, serverSlug, category);
    if (secret !== undefined) return refuse(secretBlockMessage(name, secret));
    const flow = inside ? await fileEditFlow(posture, args, serverSlug, category) : undefined;
    if (flow !== undefined) return { allow: true, source: flow, caller };

    const requirement = resolveToolApproval(policyName, serverSlug, args, facts.mcpDefault, facts.leases.categories);
    if (!requirement.requiresApproval) return { allow: true, source: requirement.source, caller };
    if (facts.unattended) {
      this.unattendedSkips.set(toolUseId, null);
      return refuse(unattendedSkipMessage(name), "unattended_skip");
    }
    return refuse(caller.kind === "root" ? NEEDS_APPROVAL_MESSAGE : SUBAGENT_APPROVAL_MESSAGE, requirement.source);
  }

  /** A `Skill` call: it loads one of the caller's own skills, or nothing (the header, item 2). */
  private skill(input: Record<string, unknown>, reach: Reach, caller: Caller): GateVerdict {
    const skill = typeof input.skill === "string" ? input.skill.trim().replace(/^\//, "") : "";
    if (reach.skills.has(skill)) return { allow: true, source: undefined, caller };
    return { allow: false, message: skillNotOwnedMessage(skill), source: undefined, caller };
  }

  /**
   * A call's file path: in the workspace's dialect (`/` its root) when it
   * resolves inside the workspace, relative or absolute, `..` included, so
   * the outputs folder and the capture substrate read it as they read the
   * native engine's; resolved and kept whole when it does not (the header).
   */
  private judgedPath(input: Record<string, unknown>): JudgedPath {
    const path = extractFilePath(input);
    if (path === null) return { kind: "none" };
    const absolute = resolve(this.facts.primaryDir, path);
    const rel = relative(this.facts.primaryDir, absolute);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { kind: "outside", absolute };
    return { kind: "inside", workspacePath: `/${rel.split(sep).join("/")}` };
  }

  /** Whether a path is platform content or the engine's own (the header, item 2). */
  private isReadOnly(path: JudgedPath): boolean {
    if (path.kind === "none") return false;
    if (path.kind === "inside") return isReadOnlyPlatformPath(path.workspacePath);
    const { platformDir, engineHome } = this.facts;
    if (isWithin(engineHome, path.absolute, true)) return true;
    return platformDir !== undefined && isWithin(platformDir, path.absolute, true) && !isWithin(join(platformDir, OUTPUTS_SUBDIR), path.absolute, false);
  }

  /** Whether a read opens a skill's files: through `.stigmer`, in the platform folder, or the copies in the engine's home. */
  private async opensSkillContent(path: JudgedPath): Promise<boolean> {
    if (path.kind === "none") return false;
    if (path.kind === "inside") return this.facts.readsSkillContent(path.workspacePath);
    const { platformDir, engineHome } = this.facts;
    if (isWithin(join(engineHome, SKILL_PLUGINS_SUBDIR), path.absolute, true)) return true;
    if (platformDir === undefined || !isWithin(platformDir, path.absolute, false)) return false;
    return SKILL_CONTENT_PATTERN.test(relative(platformDir, path.absolute).split(sep).join("/"));
  }
}

/** Whether `path` is `dir` (when `orSelf`) or inside it. */
function isWithin(dir: string, path: string, orSelf: boolean): boolean {
  const rel = relative(dir, path);
  if (rel === "") return orSelf;
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Why an `Agent` call may not run, or undefined when it may (the header, item 2). */
function agentCallRefusal(input: Record<string, unknown>, reach: Reach): string | undefined {
  const type = typeof input.subagent_type === "string" ? input.subagent_type : "";
  if (!reach.agentTypes.has(type)) return unknownHelperMessage(type);
  const extra = Object.keys(input).filter((field) => !AGENT_INPUT_FIELDS.has(field));
  return extra.length > 0 ? helperOverrideMessage(extra) : undefined;
}

/**
 * The engine's callbacks over the gate: `SubagentStart` tells it which
 * definition a sub-agent runs, and `PreToolUse` allows or denies each call,
 * with the refusal's sentence, judged as its caller's.
 */
export function gateHooks(gate: ClaudeGate): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const preToolUse: HookCallback = async (hookInput) => {
    if (hookInput.hook_event_name !== "PreToolUse") return {};
    const verdict = await gate.decide(hookInput.tool_name, hookInput.tool_use_id, toolInputOf(hookInput.tool_input), hookInput.agent_id, hookInput.agent_type);
    return {
      hookSpecificOutput: verdict.allow
        ? { hookEventName: "PreToolUse", permissionDecision: "allow" }
        : { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.message },
    };
  };
  const subagentStart: HookCallback = async (hookInput) => {
    if (hookInput.hook_event_name === "SubagentStart") gate.subagentStarted(hookInput.agent_id, hookInput.agent_type);
    return {};
  };
  return { PreToolUse: [{ hooks: [preToolUse] }], SubagentStart: [{ hooks: [subagentStart] }] };
}

/** The engine's `canUseTool` over the same decision, failing closed (the header). */
export function canUseToolOf(gate: ClaudeGate): CanUseTool {
  return async (toolName, input, options) => {
    const verdict = await gate.decide(toolName, options.toolUseID, input, options.agentID);
    return verdict.allow ? { behavior: "allow" } : { behavior: "deny", message: verdict.message };
  };
}

/** A hook's `tool_input` as the object every tool call carries. */
function toolInputOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
