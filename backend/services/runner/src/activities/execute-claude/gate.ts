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
 * The decision, in order, none of it needing a person:
 *
 *  0. A turn that is stopping or yielding runs no further call: its
 *     boundary is taken here, in the engine, before the call, never where
 *     the stream is read, which lags behind the engine (stigmer#2469).
 *  1. Closed world. A call to anything the turn did not offer (its declared
 *     built-ins, the host's shell, the bridged servers' tools) is refused
 *     before any policy is asked, so no gap in a classification table can
 *     open the gate.
 *  2. The pre-armed "trust this whole run" allows everything, as it does on
 *     every engine.
 *  3. The secret-like write block and the file-edit flows, the shared rules
 *     (`shared/file-edit-policy.ts`) over the turn's capture posture.
 *  4. The approval default (`shared/approval-policy.ts`
 *     `resolveToolApproval`), with this turn's leases and the bridge's MCP
 *     marks, over Claude Code's tool names, which the shared classification
 *     knows (`shared/tool-kind.ts`).
 *  5. Where the default would ask: an unattended turn skips the call, as
 *     every engine's gate does, with the shared sentence; any other turn
 *     refuses it with {@link NEEDS_APPROVAL_MESSAGE}, because the pause this
 *     engine waits at (`defer`) is not wired yet. Nothing that needs a person
 *     ever runs.
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

import { isAbsolute, relative, resolve, sep } from "node:path";
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
import { toolApprovalCategory } from "../../shared/tool-kind.js";
import type { TurnInput } from "../../harness/types.js";
import { HOST_SHELL_TOOL, isHostShell } from "./host-shell.js";

/** What a call that would wait for a person is refused with, until the pause lands. */
export const NEEDS_APPROVAL_MESSAGE = "This call needs a person's approval, which this engine does not ask for yet; it was not run.";

/** What a call reached after the turn began to stop or yield is refused with. */
export const HALTED_MESSAGE = "The turn paused before this call; it was not run.";

/** What a call to a tool the turn never offered is refused with. */
export function notOfferedMessage(toolName: string): string {
  return `Tool '${toolName}' is not available in this conversation; it was not run.`;
}

/** One call's decision. */
export type GateVerdict =
  | { readonly allow: true; readonly source: PolicySource | undefined }
  | {
      readonly allow: false;
      /** What the model reads, as the call's result. */
      readonly message: string;
      /** The policy layer that refused it, for the row; absent for a call to a tool never offered. */
      readonly source: PolicySource | undefined;
    };

/** What the gate knows of the turn, read once before the engine starts. */
export interface GateFacts {
  /** The tool names the turn offered, as the engine reports them: its built-ins and the bridged servers' `mcp__<slug>__<tool>`. */
  readonly offered: ReadonlySet<string>;
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
}

/** The gate's facts for a turn, from the runtime's record and the bridge's marks. */
export function gateFactsOf(
  input: TurnInput,
  offered: ReadonlySet<string>,
  serverOf: GateFacts["serverOf"],
  mcpDefault: McpApprovalDefault,
  isCapturablePath: (workspacePath: string) => Promise<boolean>,
): GateFacts {
  const { workspace } = input;
  return {
    offered,
    serverOf,
    leases: input.mcp.leases,
    mcpDefault,
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
  };
}

/** The one gate of a turn: the memo every mechanism reads (the header). */
export class ClaudeGate {
  private readonly verdicts = new Map<string, Promise<GateVerdict>>();
  private readonly settled = new Map<string, GateVerdict>();
  /** Calls an unattended turn skipped, each with the hook whose ask it was (`null`: the default's); the settle folds them. */
  readonly unattendedSkips = new Map<string, string | null>();

  constructor(
    private readonly facts: GateFacts,
    /** Whether the turn is stopping or yielding (the header, item 0). */
    private readonly halted: () => boolean = () => false,
  ) {}

  /** The decision for one call, made once per call id. */
  decide(toolName: string, toolUseId: string, input: Record<string, unknown>): Promise<GateVerdict> {
    let verdict = this.verdicts.get(toolUseId);
    if (verdict === undefined) {
      verdict = this.judge(toolName, toolUseId, input).then((settled) => {
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

  private async judge(toolName: string, toolUseId: string, input: Record<string, unknown>): Promise<GateVerdict> {
    const { facts } = this;
    if (this.halted()) return { allow: false, message: HALTED_MESSAGE, source: undefined };
    if (!facts.offered.has(toolName)) return { allow: false, message: notOfferedMessage(toolName), source: undefined };
    if (facts.leases.global) return { allow: true, source: "auto_approve_all" };

    const name = isHostShell(toolName) ? HOST_SHELL_TOOL.engineName : toolName;
    const server = facts.serverOf(toolName);
    const serverSlug = server?.slug ?? "";
    const policyName = server?.tool ?? name;
    const category = serverSlug ? undefined : toolApprovalCategory(name);
    const { args, posture, inside } = this.inWorkspaceDialect(input);

    const secret = await blockedSecretPath(posture, args, serverSlug, category);
    if (secret !== undefined) return { allow: false, message: secretBlockMessage(name, secret), source: undefined };
    const flow = inside ? await fileEditFlow(posture, args, serverSlug, category) : undefined;
    if (flow !== undefined) return { allow: true, source: flow };

    const requirement = resolveToolApproval(policyName, serverSlug, args, facts.mcpDefault, facts.leases.categories);
    if (!requirement.requiresApproval) return { allow: true, source: requirement.source };
    if (facts.unattended) {
      this.unattendedSkips.set(toolUseId, null);
      return { allow: false, message: unattendedSkipMessage(name), source: "unattended_skip" };
    }
    return { allow: false, message: NEEDS_APPROVAL_MESSAGE, source: requirement.source };
  }

  /**
   * A call's arguments with its file path in the workspace's dialect (`/`
   * its root), the posture to judge them with, and whether the path is
   * inside the workspace at all: one outside keeps its own spelling and is
   * never capturable (the header).
   */
  private inWorkspaceDialect(input: Record<string, unknown>): { args: Record<string, unknown>; posture: FileEditPosture; inside: boolean } {
    const path = extractFilePath(input);
    if (path === null) return { args: input, posture: this.facts.posture, inside: true };
    const rel = relative(this.facts.primaryDir, resolve(this.facts.primaryDir, path));
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      return { args: input, posture: { ...this.facts.posture, isCapturablePath: async () => false }, inside: false };
    }
    // `path` is the first field `extractFilePath` reads, whatever field the call named it in.
    return { args: { ...input, path: `/${rel}` }, posture: this.facts.posture, inside: true };
  }
}

/** The engine's `PreToolUse` callback over the gate: allow or deny, with the refusal's sentence. */
export function preToolUseHooks(gate: ClaudeGate): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const callback: HookCallback = async (hookInput) => {
    if (hookInput.hook_event_name !== "PreToolUse") return {};
    const verdict = await gate.decide(hookInput.tool_name, hookInput.tool_use_id, toolInputOf(hookInput.tool_input));
    return {
      hookSpecificOutput: verdict.allow
        ? { hookEventName: "PreToolUse", permissionDecision: "allow" }
        : { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.message },
    };
  };
  return { PreToolUse: [{ hooks: [callback] }] };
}

/** The engine's `canUseTool` over the same decision, failing closed (the header). */
export function canUseToolOf(gate: ClaudeGate): CanUseTool {
  return async (toolName, input, options) => {
    const verdict = await gate.decide(toolName, options.toolUseID, input);
    return verdict.allow ? { behavior: "allow" } : { behavior: "deny", message: verdict.message };
  };
}

/** A hook's `tool_input` as the object every tool call carries. */
function toolInputOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
