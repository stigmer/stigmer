/**
 * The Claude harness's approval gate: one decision per tool call, made once
 * and read by every mechanism that must agree.
 *
 * The engine asks twice. A `PreToolUse` callback fires for every call, and
 * `canUseTool` fires for every call an ask rule names (`permissions.ask:
 * ["*"]`, every call, set in `engine-options.ts`). Measured on the engine
 * before this was built: the callback can be skipped (about one resumed call
 * in twelve), and the engine then decides on its own. So both answer from
 * one memoized {@link ClaudeGate.decide}, keyed by the call's own id, and
 * `canUseTool` fails closed: a call the gate did not allow is refused there
 * whatever the callback said or failed to say. The host's tools (its shell,
 * the bridged servers) run a call only once the gate admits it by the same
 * identity ({@link ClaudeGate.admit}, `loopback-mcp.ts`): its own allow
 * verdict, once, with exactly the arguments judged.
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
 * The decision, in the Stigmer harness's gate's order (`middleware/approval-gate.ts`):
 *
 *  0. A turn that is stopping or yielding runs no further call: its
 *     boundary is taken here, in the engine, before the call, never where
 *     the stream is read, which lags behind the engine (stigmer#2469). A
 *     call left waiting by an earlier run that was stopped never runs
 *     ({@link STALE_CALL_MESSAGE}): nobody answered it.
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
 *     and nothing in the engine's own home, as the Stigmer harness's
 *     read-only mount holds (`shared/outputs.ts` `isReadOnlyPlatformPath`).
 *     A caller whose lists deny `Skill` reads no skill's files. A caller
     whose lists exclude `Read` is still offered it, for the platform's
     own content alone: a file whose real path lies inside the platform
     folder, on a turn whose `.stigmer` is the link to it
     (`shared/workspace/stigmer-link.ts` `readsPlatformContent`), as the
     Stigmer harness admits it by its route.
 *  3. The secret-like write block (`shared/file-edit-policy.ts`), ahead of
 *     any hook, its path recorded for the turn's review.
 *  4. The agent's `PreToolUse` hooks (`hooks.ts`): a deny refuses, naming
 *     the hook. Then a person's earlier refusal of this very call binds
 *     (`input.approvalDecisions`), and a call the person approved must be
 *     the call they saw ({@link CHANGED_MESSAGE}). A hook's rewrite replaces
 *     the arguments, which steps 2 and 3 judge again.
 *  5. The pre-armed "trust this whole run" runs everything that reached
 *     here, as it does on every engine: a hook's ask is satisfied, its
 *     rewrite applies.
 *  6. A hook's allow runs the call; its ask asks a person, unless it also
 *     rewrote the call: this engine's card and the session's log hold the
 *     model's own call, so a person would approve arguments other than the
 *     ones that run, and the call is refused.
 *  7. With no hook deciding, the file-edit flows, then the approval
 *     default (`shared/approval-policy.ts` `resolveToolApproval`) over
 *     Claude Code's tool names, which the shared classification knows.
 *  8. Where a hook or the default asks: a call the person approved runs;
 *     an unattended turn skips it, with the shared sentence; a sub-agent's
 *     call is refused, since a helper never waits for a person (the engine
 *     loses a sub-agent's deferred call); so is the main agent's start of a
 *     helper, whose row reaches the session's log as it streams, before an
 *     ask could ride it (`claude-capabilities.ts`); the main agent's other
 *     calls PAUSE.
 *
 * A pause is the engine's `defer`, one per invocation, since the engine
 * resumes one call: the first pause is deferred, every later one is
 * refused with {@link ASK_ALONE_MESSAGE}, and the model asks for it again
 * alone. `canUseTool` refuses every pause the same way: it meets one only
 * when the engine ignored a deferral (a batch) or skipped the callback, and
 * a call never runs undecided. When it meets the very call deferred, the
 * engine ignored the deferral, so the invocation's one deferral is free
 * again. The turn turns the deferral into the WAITING row (`turn.ts`).
 *
 * A file tool's write the gate lets run is observed first when review
 * captures what git cannot (an ignored path, a workspace with no git): its
 * before-bytes are recorded ({@link GateFacts.observer}), whatever let it
 * run, as the Stigmer harness's backend records them.
 *
 * The engine's shell reaches the gate under its aliased name
 * (`mcp__stigmer__bash`, `host-shell.ts`), and the model may name that tool
 * itself: both are the shell to the gate, and `Bash` to a hook. A path is
 * resolved against the workspace's primary directory, relative or
 * absolute, `..` included, and judged in the workspace's own dialect (`/`
 * its root), so the outputs folder and the capture substrate read it as
 * they read the Stigmer harness's. A path that resolves outside the
 * workspace takes none of the file-edit flows: the default decides it.
 * The engine works in its directories' real paths, so a root (the
 * workspace, the engine's home, the platform folder) is matched in the
 * spelling the session names it by and in its real path, without resolving
 * any link inside it (stigmer#2623: a workspace under a link, such as
 * macOS's `/var`, had every write judged outside it).
 *
 * Every verdict is kept by call id, so the translator stamps the row's
 * provenance and leaves a person's refusal to the runtime
 * (`translator.ts`), and the settle folds the unattended skips
 * (`settle.ts`). A hook's rewrite that runs is the one input the gate
 * returns to the engine (`updatedInput`).
 */

import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CanUseTool, HookCallback, HookCallbackMatcher, HookEvent, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

import { ApprovalAction } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import type { TurnInput } from "../../harness/types.js";
import {
  CHANGED_MESSAGE,
  isUnattendedApprovalMode,
  resolveToolApproval,
  unattendedSkipMessage,
  type ActiveLeases,
  type McpApprovalDefault,
  type PolicySource,
} from "../../shared/approval-policy.js";
import { blockedSecretPath, fileEditFlow, secretBlockMessage, type FileEditPosture } from "../../shared/file-edit-policy.js";
import { extractFilePath } from "../../shared/file-tools.js";
import type { CasCaptureObserver } from "../../shared/filereview/cas-capture-observer.js";
import { NO_PRE_TOOL_USE, type HookEvaluator, type PreToolUseOutcome } from "../../shared/hooks/evaluate.js";
import { askWithRewriteMessage, hookAskMessage, hookLabel, hookRefusalMessage, personDecisionSentence } from "../../shared/hooks/messages.js";
import { isReadOnlyPlatformPath, OUTPUTS_SUBDIR } from "../../shared/outputs.js";
import { SKILL_CONTENT_PATTERN } from "../../shared/skill-mount.js";
import { asJson, sameJson } from "../../shared/json-value.js";
import { ELISION_MARKER } from "../../shared/status-offload.js";
import { toolApprovalCategory, type ToolApprovalCategory } from "../../shared/tool-kind.js";
import { readsPlatformContent } from "../../shared/workspace/stigmer-link.js";
import { HOST_SHELL_TOOL, isHostShell } from "./host-shell.js";
import { evaluatorFor, type TurnHookEvaluators } from "./hooks.js";
import type { ServedCall } from "./loopback-mcp.js";
import { SKILL_PLUGINS_SUBDIR } from "./skill-plugins.js";

/** What a sub-agent's call that would wait for a person is refused with: a helper never pauses for one. */
export const SUBAGENT_APPROVAL_MESSAGE =
  "This call needs a person's approval, which a helper cannot ask for; ask the agent that delegated to you to run this. It was not run.";

/** What a sub-agent's call a hook asks about is refused with, naming the hook. */
export function subagentHookAskMessage(hook: string): string {
  return `${hookLabel(hook)} asks for a person's approval of this call, which a helper cannot ask for; ask the agent that delegated to you to run this. It was not run.`;
}

/** What the main agent's start of a helper is refused with when a hook asks a person about it. */
export function helperStartAskMessage(hook: string): string {
  return `${hookLabel(hook)} asks for a person's approval before this helper starts, which this harness cannot wait for; it was not run.`;
}

/** What a call that would wait while another already waits is refused with: the model asks for it again, alone. */
export const ASK_ALONE_MESSAGE = "Ask for this call on its own: it needs a person's approval, and only one call can wait at a time. It was not run.";

/** What a call left waiting by a stopped turn is refused with when a later run's engine reaches it. */
export const STALE_CALL_MESSAGE = "This call was waiting for an answer when its turn was stopped; it was not run.";

/** What a call reached after the turn began to stop or yield is refused with. */
export const HALTED_MESSAGE = "The turn paused before this call; it was not run.";

/** What a call from a sub-agent the gate cannot name is refused with. */
export const UNKNOWN_CALLER_MESSAGE = "This call came from a helper this turn did not start; it was not run.";

/** What a call that writes platform content or the engine's own files is refused with. */
export const READ_ONLY_MESSAGE = "This path holds the platform's own files, which are read-only; it was not run. Save files for the person in the outputs folder.";

/** What a read outside the platform's content is refused with when the caller's lists exclude `Read`. */
export const PLATFORM_READ_ONLY_MESSAGE =
  "Read reaches only the platform's own files (under .stigmer/) for this agent: its tool lists exclude Read. It was not run.";

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

/** What the host's tools answer a call the gate did not admit (`loopback-mcp.ts`). */
export const NOT_ADMITTED_MESSAGE = "The gate allowed no such call; it was not run.";

/** The engine's tool that reads a file, offered for the platform's content alone to a caller whose lists exclude it. */
export const READ_TOOL = "Read";

/** The engine's tool that loads a skill. */
export const SKILL_TOOL = "Skill";

/** The engine's tool that starts a sub-agent. */
export const AGENT_TOOL = "Agent";

/** The fields an `Agent` call may carry: everything else is the definition's to decide (the header). */
const AGENT_INPUT_FIELDS: ReadonlySet<string> = new Set(["description", "prompt", "subagent_type", "name"]);

/** Who made a call: the main agent, or a sub-agent by the definition it runs and the engine's id for it. */
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
  /** Whether its lists exclude `Read`, which it is offered for the platform's own content alone (the header, item 2). */
  readonly confinedRead: boolean;
}

/** A call the gate lets run. */
export interface AllowVerdict {
  readonly kind: "allow";
  readonly source: PolicySource | undefined;
  readonly caller: Caller;
  /** The engine's name for the tool, as the call reached the gate. */
  readonly toolName: string;
  /** The arguments it runs with: the engine's, or a hook's rewrite of them. */
  readonly args: Record<string, unknown>;
  /** Whether a hook rewrote the arguments (the engine is handed {@link args}). */
  readonly rewritten: boolean;
  /** The hook that decided, for the row; undefined when none did. */
  readonly hook: string | undefined;
  /** What the `PreToolUse` hooks handed back to the model, appended to the call's result (`hookFeedbackOf`). */
  readonly context: readonly string[];
}

/** A call the gate refuses: the model reads {@link message} as its result. */
export interface RefuseVerdict {
  readonly kind: "refuse";
  readonly message: string;
  /** The policy layer that refused it, for the row; absent for a refusal no policy made. */
  readonly source: PolicySource | undefined;
  /** Undefined when the caller could not be named. */
  readonly caller: Caller | undefined;
  readonly hook: string | undefined;
  /** A person refused this call on its card: the runtime settles its row (`harness/approval-decisions.ts`). */
  readonly byPerson: boolean;
}

/** A main agent's call that waits for a person (the header, item 8). */
export interface PauseVerdict {
  readonly kind: "pause";
  /** The approval card's message. */
  readonly message: string;
  readonly source: PolicySource | undefined;
  readonly caller: Caller;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  /** The hook that asked; undefined when the default did. */
  readonly hook: string | undefined;
}

/** One call's decision. */
export type GateVerdict = AllowVerdict | RefuseVerdict | PauseVerdict;

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
  /** The real path a confined `Read` reaches files inside (`shared/workspace/stigmer-link.ts` `platformReadRoot`); "" on a turn with no platform link. */
  readonly platformReadRoot: string;
  /** Every caller's hooks (`hooks.ts`). */
  readonly hooks: TurnHookEvaluators;
  /** A person's answers to this run's WAITING rows, by call id (`TurnInput.approvalDecisions`). */
  readonly decisions: ReadonlyMap<string, ApprovalAction>;
  /** The reason a person gave with a refusal, by call id (`TurnInput.approvalDenyMessages`). */
  readonly denyMessages: ReadonlyMap<string, string>;
  /** The WAITING row a call id answers, its tool and arguments as the session's log holds them (the call the person saw); undefined for none. */
  readonly waitingCallOf: (toolUseId: string) => WaitingCall | undefined;
  /** A call an earlier, stopped run left waiting, which nobody answered (the header, item 0). */
  readonly staleCallId: string | undefined;
  /** A call this run's engine left pending that it never proposed (a yield crossed its deferral): asked for again alone. */
  readonly unproposedCallId: string | undefined;
  /** Where a write's before-bytes and a blocked secret's path are recorded for review (the header). */
  readonly observer: Pick<CasCaptureObserver, "recordBefore" | "recordBlockedSecret"> | undefined;
}

/** A call a person was asked about, as its WAITING row holds it. */
export interface WaitingCall {
  /** The row's name: `Bash` for the host's shell, a built-in's, or an MCP tool's bare name. */
  readonly name: string;
  /** The MCP server the row's tool belongs to; "" for a built-in. */
  readonly mcpServerSlug: string;
  readonly args: Record<string, unknown>;
}

/** What the gate's facts are read from beside the turn's record. */
export interface GateFactSources {
  readonly agents: { readonly root: Reach; readonly subagents: ReadonlyMap<string, Reach> };
  readonly bridge: { readonly serverOf: GateFacts["serverOf"]; readonly mcpDefault: McpApprovalDefault };
  readonly paths: {
    readonly platformDir: string | undefined;
    readonly engineHome: string;
    readonly readsSkillContent: GateFacts["readsSkillContent"];
    readonly platformReadRoot: string;
  };
  readonly isCapturablePath: (workspacePath: string) => Promise<boolean>;
  readonly hooks: TurnHookEvaluators;
  readonly waitingCallOf: GateFacts["waitingCallOf"];
  readonly pending: { readonly staleCallId: string | undefined; readonly unproposedCallId: string | undefined };
  readonly observer: GateFacts["observer"];
}

/** The gate's facts for a turn, from the runtime's record and the turn's own pieces. */
export function gateFactsOf(input: TurnInput, sources: GateFactSources): GateFacts {
  const { workspace } = input;
  return {
    root: sources.agents.root,
    subagents: sources.agents.subagents,
    serverOf: sources.bridge.serverOf,
    leases: input.mcp.leases,
    mcpDefault: sources.bridge.mcpDefault,
    unattended: isUnattendedApprovalMode(input.execution),
    posture: {
      fileCaptureMode: workspace.captureMode,
      fileReviewOff: !workspace.fileReview,
      fileCaptureSubstrate: workspace.captureSubstrate,
      isCapturablePath: sources.isCapturablePath,
      // An ignored path flows into review only where the gate records its
      // before-bytes first and the turn can keep them.
      captureIgnored: workspace.captureMode && input.artifactStorage !== undefined,
    },
    primaryDir: workspace.primaryDir,
    ...sources.paths,
    hooks: sources.hooks,
    decisions: input.approvalDecisions,
    denyMessages: input.approvalDenyMessages,
    waitingCallOf: sources.waitingCallOf,
    staleCallId: sources.pending.staleCallId,
    unproposedCallId: sources.pending.unproposedCallId,
    observer: sources.observer,
  };
}

/** A call's path as the gate judges it: in the workspace's dialect when inside, else resolved. */
type JudgedPath = { readonly kind: "none" } | { readonly kind: "inside"; readonly workspacePath: string } | { readonly kind: "outside"; readonly absolute: string };

/** One call as the gate judges it, beside its caller. */
interface Call {
  readonly toolName: string;
  readonly toolUseId: string;
  /** The tool's name to the policy and to a person: `Bash` for the host's shell. */
  readonly name: string;
  readonly server: { readonly slug: string; readonly tool: string } | undefined;
  readonly category: ToolApprovalCategory | undefined;
}

/** What asks a person about a call (the header, item 8). */
interface Ask {
  readonly message: string;
  readonly source: PolicySource | undefined;
  readonly hook: string | undefined;
}

/** The one gate of a turn: the memo every mechanism reads (the header). */
export class ClaudeGate {
  private readonly verdicts = new Map<string, Promise<GateVerdict>>();
  private readonly settled = new Map<string, GateVerdict>();
  /** The definition each started sub-agent runs, by the engine's id for it. */
  private readonly started = new Map<string, string>();
  /** The call this invocation deferred; undefined while none is. */
  private deferred: string | undefined;
  /** Calls the host's tools already ran (admitted once each). */
  private readonly admitted = new Set<string>();
  /** Calls an unattended turn skipped, each with the hook whose ask it was (`null`: the default's); the settle folds them. */
  readonly unattendedSkips = new Map<string, string | null>();
  /** Told each time a call's decision is made. */
  private readonly decided: ((toolUseId: string, verdict: GateVerdict) => void)[] = [];

  /** Every spelling of the workspace's root, the engine's home and the platform folder (the header). */
  private readonly primaryRoots: readonly string[];
  private readonly engineHomes: readonly string[];
  private readonly platformDirs: readonly string[];

  constructor(
    private readonly facts: GateFacts,
    /** Whether the turn is stopping or yielding (the header, item 0). */
    private readonly halted: () => boolean = () => false,
  ) {
    this.primaryRoots = spellingsOf(facts.primaryDir);
    this.engineHomes = spellingsOf(facts.engineHome);
    this.platformDirs = facts.platformDir === undefined ? [] : spellingsOf(facts.platformDir);
  }

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
      verdict = this.judge(toolName, toolUseId, input, agentId, this.callerOf(agentId, agentType)).then((settled) => {
        this.settled.set(toolUseId, settled);
        for (const listener of this.decided) listener(toolUseId, settled);
        return settled;
      });
      this.verdicts.set(toolUseId, verdict);
    }
    return verdict;
  }

  /** Be told each time a call's decision is made. */
  onDecided(listener: (toolUseId: string, verdict: GateVerdict) => void): void {
    this.decided.push(listener);
  }

  /** The decision already made for a call; undefined when none was. */
  verdictOf(toolUseId: string): GateVerdict | undefined {
    return this.settled.get(toolUseId);
  }

  /** The call this invocation deferred, once it has; undefined while none is. */
  get deferredCall(): string | undefined {
    return this.deferred;
  }

  /** Whether a paused call may be the invocation's one deferral: the first, or the same one asked again (the header). */
  claimDeferral(toolUseId: string): boolean {
    if (this.deferred !== undefined && this.deferred !== toolUseId) return false;
    this.deferred = toolUseId;
    return true;
  }

  /** The engine ran past a deferral it was given (a batch): the invocation's one deferral is free again (the header). */
  releaseDeferral(toolUseId: string): void {
    if (this.deferred === toolUseId) this.deferred = undefined;
  }

  /**
   * Whether the host's tools may run a call (`loopback-mcp.ts`): only under
   * its own allow verdict, for the tool that verdict judged, with exactly
   * the arguments it judged, and once. Undefined admits it; a string is the
   * refusal the engine reads.
   */
  admit(call: ServedCall): string | undefined {
    const verdict = this.settled.get(call.toolUseId);
    if (verdict === undefined || verdict.kind !== "allow") return verdict?.kind === "refuse" ? verdict.message : NOT_ADMITTED_MESSAGE;
    if (verdict.toolName !== `mcp__${call.server}__${call.tool}` || !sameJson(verdict.args, call.args)) return NOT_ADMITTED_MESSAGE;
    if (this.admitted.has(call.toolUseId)) return "This call already ran; it was not run again.";
    this.admitted.add(call.toolUseId);
    return undefined;
  }

  /** The caller a call's ids name, with its reach; undefined for a sub-agent the gate cannot name. */
  private callerOf(agentId: string | undefined, agentType: string | undefined): { caller: Caller; reach: Reach } | undefined {
    if (agentId === undefined || agentId === "") return { caller: ROOT_CALLER, reach: this.facts.root };
    const type = this.started.get(agentId);
    if (type === undefined || (agentType !== undefined && agentType !== type)) return undefined;
    const reach = this.facts.subagents.get(type);
    return reach === undefined ? undefined : { caller: { kind: "subagent", type }, reach };
  }

  private async judge(
    toolName: string,
    toolUseId: string,
    input: Record<string, unknown>,
    agentId: string | undefined,
    who: { caller: Caller; reach: Reach } | undefined,
  ): Promise<GateVerdict> {
    const { facts } = this;
    if (this.halted()) return refusal(HALTED_MESSAGE, who?.caller);
    if (toolUseId === facts.staleCallId) return refusal(STALE_CALL_MESSAGE, who?.caller);
    if (who === undefined) return refusal(UNKNOWN_CALLER_MESSAGE, undefined);
    const { caller, reach } = who;
    const refuse = (message: string, source?: PolicySource, hook?: string): GateVerdict => refusal(message, caller, source, hook);
    if (toolName === HOST_SHELL_TOOL.engineName || !reach.tools.has(toolName)) return refuse(notOfferedMessage(toolName));
    if (toolName === SKILL_TOOL) return this.skill(toolName, input, reach, caller);
    if (toolName === AGENT_TOOL) {
      const refused = agentCallRefusal(input, reach);
      if (refused !== undefined) return refuse(refused);
    }

    const name = isHostShell(toolName) ? HOST_SHELL_TOOL.engineName : toolName;
    const server = facts.serverOf(toolName);
    const call: Call = { toolName, toolUseId, name, server, category: server === undefined ? toolApprovalCategory(name) : undefined };
    const global = facts.leases.global;

    // 2 and 3: scope, then the secret-like write block, ahead of any hook.
    const scoped = await this.scopeRefusal(call, input, reach, global);
    if (scoped !== undefined) return refuse(scoped);

    // 4: the hooks, a person's refusal, an approved call's arguments, a rewrite.
    const evaluator = evaluatorFor(facts.hooks, caller);
    const hookCall = { id: toolUseId, name: server?.tool ?? name, args: input, serverSlug: server?.slug ?? "" };
    const scope = caller.kind === "subagent" && agentId !== undefined ? { subAgent: { type: caller.type, id: agentId } } : {};
    const pre: PreToolUseOutcome = evaluator === null ? NO_PRE_TOOL_USE : await evaluator.preToolUse(hookCall, scope);
    if (pre.decision === "deny") return refuse(hookRefusalMessage(pre.hook, pre.reason), "hook", pre.hook);
    const answer = facts.decisions.get(toolUseId);
    if (answer === ApprovalAction.REJECT || answer === ApprovalAction.SKIP) {
      const comment = facts.denyMessages.get(toolUseId) ?? "";
      return { kind: "refuse", message: personDecisionSentence(name, answer === ApprovalAction.SKIP ? "skip" : "reject", comment), source: undefined, caller, hook: undefined, byPerson: true };
    }
    if ((answer === ApprovalAction.APPROVE || answer === ApprovalAction.APPROVE_ALL) && !this.isAsShown(toolUseId, server?.tool ?? name, server?.slug ?? "", input)) return refuse(CHANGED_MESSAGE);
    let args = input;
    if (pre.updatedArgs !== undefined) {
      args = pre.updatedArgs;
      const rescoped = await this.scopeRefusal(call, args, reach, global);
      if (rescoped !== undefined) return refuse(rescoped);
    }
    const rewritten = pre.updatedArgs !== undefined;
    const allow = async (source: PolicySource | undefined, hook: string | undefined): Promise<GateVerdict> => {
      await this.observe(call, args);
      return { kind: "allow", source, caller, toolName, args, rewritten, hook, context: pre.additionalContext };
    };

    // 5 and 6: trust the whole run, or a hook's answer.
    if (global) return allow(pre.decision === "allow" ? hookSource(pre) : "auto_approve_all", pre.decision === undefined ? undefined : pre.hook);
    if (pre.decision === "allow") return allow(hookSource(pre), pre.hook);
    if (pre.decision === "ask") {
      if (rewritten) return refuse(askWithRewriteMessage(pre.hook), "hook", pre.hook);
      const shown = evaluator?.viewOf(hookCall)?.toolName ?? name;
      return this.wouldAsk(call, caller, { message: pre.reason || hookAskMessage(pre.hook, shown), source: "hook", hook: pre.hook }, args, allow);
    }

    // 7: the file-edit flows, then the default.
    const path = this.judgedPath(args);
    const policyArgs = path.kind === "inside" ? { ...args, path: path.workspacePath } : args;
    const flow = path.kind === "inside" ? await fileEditFlow(facts.posture, policyArgs, server?.slug ?? "", call.category) : undefined;
    if (flow !== undefined) return allow(flow, undefined);
    const requirement = resolveToolApproval(server?.tool ?? name, server?.slug ?? "", policyArgs, facts.mcpDefault, facts.leases.categories);
    if (!requirement.requiresApproval) return allow(requirement.source, undefined);
    return this.wouldAsk(call, caller, { message: requirement.message, source: requirement.source, hook: undefined }, args, allow);
  }

  /** Whether an approved call is the one its WAITING row shows: its tool and server, and its arguments as the log holds them. */
  private isAsShown(toolUseId: string, name: string, mcpServerSlug: string, input: Record<string, unknown>): boolean {
    const shown = this.facts.waitingCallOf(toolUseId);
    return shown !== undefined && shown.name === name && shown.mcpServerSlug === mcpServerSlug && sameAsShown(shown.args, input);
  }

  /** Item 8 of the header: what a call that asks a person comes to. */
  private async wouldAsk(
    call: Call,
    caller: Caller,
    ask: Ask,
    args: Record<string, unknown>,
    allow: (source: PolicySource | undefined, hook: string | undefined) => Promise<GateVerdict>,
  ): Promise<GateVerdict> {
    const answer = this.facts.decisions.get(call.toolUseId);
    if (answer === ApprovalAction.APPROVE || answer === ApprovalAction.APPROVE_ALL) return allow(ask.source, ask.hook);
    if (this.facts.unattended) {
      this.unattendedSkips.set(call.toolUseId, ask.hook ?? null);
      return refusal(unattendedSkipMessage(call.name), caller, "unattended_skip", ask.hook);
    }
    if (caller.kind === "subagent") return refusal(ask.hook === undefined ? SUBAGENT_APPROVAL_MESSAGE : subagentHookAskMessage(ask.hook), caller, ask.source, ask.hook);
    if (call.toolName === AGENT_TOOL) return refusal(helperStartAskMessage(ask.hook ?? ""), caller, ask.source, ask.hook);
    if (call.toolUseId === this.facts.unproposedCallId) return refusal(ASK_ALONE_MESSAGE, caller, ask.source, ask.hook);
    return { kind: "pause", message: ask.message, source: ask.source, caller, toolName: call.toolName, args, hook: ask.hook };
  }

  /** Items 2 and 3 of the header over a call's arguments: why it may not run whatever answers it, or undefined. */
  private async scopeRefusal(call: Call, args: Record<string, unknown>, reach: Reach, global: boolean): Promise<string | undefined> {
    const path = this.judgedPath(args);
    if ((call.category === "write" || call.category === "delete") && this.isReadOnly(path)) return READ_ONLY_MESSAGE;
    if (reach.hidesSkills && call.name === "Read" && (await this.opensSkillContent(path))) return HIDDEN_SKILLS_MESSAGE;
    if (reach.confinedRead && call.name === "Read" && !(await this.readsPlatformContent(path))) return PLATFORM_READ_ONLY_MESSAGE;
    if (global) return undefined;
    const inside = path.kind === "inside";
    const posture = inside ? this.facts.posture : { ...this.facts.posture, isCapturablePath: async () => false };
    const secret = await blockedSecretPath(posture, inside ? { ...args, path: path.workspacePath } : args, call.server?.slug ?? "", call.category);
    if (secret === undefined) return undefined;
    if (inside) this.facts.observer?.recordBlockedSecret(secret);
    return secretBlockMessage(call.name, secret);
  }

  /** Record a file write's before-bytes where review captures what git cannot (the header). */
  private async observe(call: Call, args: Record<string, unknown>): Promise<void> {
    const { observer, posture } = this.facts;
    if (observer === undefined || !posture.fileCaptureMode || !posture.captureIgnored || call.category !== "write") return;
    const path = this.judgedPath(args);
    if (path.kind === "inside") await observer.recordBefore(path.workspacePath);
  }

  /** A `Skill` call: it loads one of the caller's own skills, or nothing (the header, item 2). */
  private skill(toolName: string, input: Record<string, unknown>, reach: Reach, caller: Caller): GateVerdict {
    const skill = typeof input.skill === "string" ? input.skill.trim().replace(/^\//, "") : "";
    if (reach.skills.has(skill)) return { kind: "allow", source: undefined, caller, toolName, args: input, rewritten: false, hook: undefined, context: [] };
    return refusal(skillNotOwnedMessage(skill), caller);
  }

  /**
   * A call's file path: in the workspace's dialect (`/` its root) when it
   * resolves inside the workspace, relative or absolute, `..` included, so
   * the outputs folder and the capture substrate read it as they read the
   * Stigmer harness's; resolved and kept whole when it does not (the header).
   */
  private judgedPath(input: Record<string, unknown>): JudgedPath {
    const path = extractFilePath(input);
    if (path === null) return { kind: "none" };
    const absolute = resolve(this.facts.primaryDir, path);
    for (const root of this.primaryRoots) {
      const rel = relative(root, absolute);
      if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) return { kind: "inside", workspacePath: `/${rel.split(sep).join("/")}` };
    }
    return { kind: "outside", absolute };
  }

  /** Whether a path is platform content or the engine's own (the header, item 2). */
  private isReadOnly(path: JudgedPath): boolean {
    if (path.kind === "none") return false;
    if (path.kind === "inside") return isReadOnlyPlatformPath(path.workspacePath);
    if (withinAny(this.engineHomes, path.absolute, true)) return true;
    return this.platformDirs.some((platformDir) => isWithin(platformDir, path.absolute, true) && !isWithin(join(platformDir, OUTPUTS_SUBDIR), path.absolute, false));
  }

  /** Whether a read opens the platform's own content, by the real path it resolves to (the header, item 2). */
  private async readsPlatformContent(path: JudgedPath): Promise<boolean> {
    if (path.kind === "none") return false;
    const absolute = path.kind === "outside" ? path.absolute : join(this.facts.primaryDir, path.workspacePath);
    return readsPlatformContent(this.facts.platformReadRoot, absolute);
  }

  /** Whether a read opens a skill's files: through `.stigmer`, in the platform folder, or the copies in the engine's home. */
  private async opensSkillContent(path: JudgedPath): Promise<boolean> {
    if (path.kind === "none") return false;
    if (path.kind === "inside") return this.facts.readsSkillContent(path.workspacePath);
    if (withinAny(this.engineHomes.map((home) => join(home, SKILL_PLUGINS_SUBDIR)), path.absolute, true)) return true;
    const platformDir = this.platformDirs.find((dir) => isWithin(dir, path.absolute, false));
    if (platformDir === undefined) return false;
    return SKILL_CONTENT_PATTERN.test(relative(platformDir, path.absolute).split(sep).join("/"));
  }
}

/** A refusal no person made. */
function refusal(message: string, caller: Caller | undefined, source?: PolicySource, hook?: string): RefuseVerdict {
  return { kind: "refuse", message, source, caller, hook, byPerson: false };
}

/** How a hook's allow is stamped: a lease on its ask, or the hook itself. */
function hookSource(pre: PreToolUseOutcome): PolicySource {
  return pre.leased ? "approval_lease" : "hook";
}

/** `dir` as named, and its real path when that differs; a part that does not exist yet keeps its name under its nearest real ancestor (the header). */
export function spellingsOf(dir: string): readonly string[] {
  const real = realSpelling(dir);
  return real === dir ? [dir] : [dir, real];
}

function realSpelling(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(realSpelling(parent), basename(path));
  }
}

/** Whether `path` is within any of `dirs` (isWithin). */
function withinAny(dirs: readonly string[], path: string, orSelf: boolean): boolean {
  return dirs.some((dir) => isWithin(dir, path, orSelf));
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

/** The suffix the session's log puts after the head it keeps of a value too large to log whole (`shared/status-offload.ts`). */
const ELIDED_SUFFIX = `\n\n${ELISION_MARKER}`;

/**
 * Whether the arguments the engine runs a call with are the call the person
 * saw, as the session's log holds it: equal, except where the log cut a
 * value to its head, which the engine's value must begin with.
 */
export function sameAsShown(shown: unknown, actual: unknown): boolean {
  if (typeof shown === "string" && shown.endsWith(ELIDED_SUFFIX)) {
    return typeof actual === "string" && actual.startsWith(shown.slice(0, -ELIDED_SUFFIX.length));
  }
  if (Array.isArray(shown)) {
    return Array.isArray(actual) && actual.length === shown.length && shown.every((value, index) => sameAsShown(value, actual[index]));
  }
  if (shown !== null && typeof shown === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    const a = asJson(actual) as Record<string, unknown>;
    const keys = Object.keys(shown);
    return keys.length === Object.keys(a).length && keys.every((key) => key in a && sameAsShown((shown as Record<string, unknown>)[key], a[key]));
  }
  return isDeepStrictEqual(shown, asJson(actual));
}

/** The answer each engine mechanism gives a verdict that lets a call run. */
function allowed(verdict: AllowVerdict): { readonly updatedInput?: Record<string, unknown> } {
  return verdict.rewritten ? { updatedInput: verdict.args } : {};
}

/**
 * The engine's callbacks over the gate: `SubagentStart` tells it which
 * definition a sub-agent runs, and `PreToolUse` allows, refuses or defers
 * each call, judged as its caller's (the header).
 */
export function gateHooks(gate: ClaudeGate): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const preToolUse: HookCallback = async (hookInput) => {
    if (hookInput.hook_event_name !== "PreToolUse") return {};
    const id = hookInput.tool_use_id;
    const verdict = await gate.decide(hookInput.tool_name, id, toolInputOf(hookInput.tool_input), hookInput.agent_id, hookInput.agent_type);
    switch (verdict.kind) {
      case "allow":
        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", ...allowed(verdict) } };
      case "refuse":
        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.message } };
      case "pause":
        return gate.claimDeferral(id)
          ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "defer" } }
          : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ASK_ALONE_MESSAGE } };
      /* v8 ignore next 2 -- @preserve: the exhaustiveness guard over a closed union */
      default:
        return exhaustive(verdict);
    }
  };
  const subagentStart: HookCallback = async (hookInput) => {
    if (hookInput.hook_event_name === "SubagentStart") gate.subagentStarted(hookInput.agent_id, hookInput.agent_type);
    return {};
  };
  return { PreToolUse: [{ hooks: [preToolUse] }], SubagentStart: [{ hooks: [subagentStart] }] };
}

/** The engine's `canUseTool` over the same decision, failing closed (the header). */
export function canUseToolOf(gate: ClaudeGate): CanUseTool {
  return async (toolName, input, options): Promise<PermissionResult> => {
    const verdict = await gate.decide(toolName, options.toolUseID, input, options.agentID);
    switch (verdict.kind) {
      case "allow":
        return { behavior: "allow", ...allowed(verdict) };
      case "refuse":
        return { behavior: "deny", message: verdict.message };
      case "pause":
        gate.releaseDeferral(options.toolUseID);
        return { behavior: "deny", message: ASK_ALONE_MESSAGE };
      /* v8 ignore next 2 -- @preserve: the exhaustiveness guard over a closed union */
      default:
        return exhaustive(verdict);
    }
  };
}

/* v8 ignore next 3 -- @preserve: reached only by a verdict kind the union does not have */
function exhaustive(verdict: never): never {
  throw new Error(`the Claude gate: unknown verdict ${JSON.stringify(verdict)}`);
}

/** A hook's `tool_input` as the object every tool call carries. */
function toolInputOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
