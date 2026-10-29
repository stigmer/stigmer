/**
 * Approval gate middleware for HITL (human-in-the-loop) tool approval.
 *
 * Checks each tool call against the approval default. When a tool
 * requires approval, calls LangGraph `interrupt()` to pause the graph
 * at the checkpoint. The Temporal workflow then waits for the user's
 * decision via the `approvalGateResolved` signal.
 *
 * On resume, LangGraph restarts the node from the beginning. The
 * `interrupt()` call returns the user's decision (approve/skip/reject)
 * from the `Command(resume=...)` payload.
 *
 * Idempotency: Because the node restarts on resume, this middleware
 * will be invoked again for the same tool call. The `interrupt()` call
 * is idempotent — on resume it returns the decision value instead of
 * pausing again.
 *
 * Which tool a call is: the model calls an MCP tool by its engine name,
 * `mcp__<server>__<tool>` (`shared/mcp-tool-names.ts`), and the gate reads
 * the server and the bare tool from the turn's index (`mcpIndex`) once per
 * call. Everything the gate says outside the engine (the card, the hooks'
 * view, the receipt, capture) names that pair; the messages it writes back
 * to the model answer the call under the name the model used. A call the
 * index does not own is a built-in, so a server's own `write_file` is
 * judged as its server's tool, never by a built-in's category.
 *
 * Platform tool defaults: DeepAgents JS backend tools (read, write,
 * edit, execute, etc.) are not MCP tools. Built-in tools
 * are classified through the shared {@link toolApprovalCategory} — the single
 * source of truth, shared with the Claude harness's gate — so read-only tools
 * are auto-approved and every mutating tool (write/edit/delete/shell) is gated
 * fail-CLOSED, by category rather than by a hand-maintained name list. An
 * unrecognized mutating built-in (e.g. `bash`, `overwrite_file`) is therefore
 * gated by what it does, not by whether someone remembered to list it.
 *
 * The decision itself — `resolveToolApproval` — lives in
 * `shared/approval-policy.ts` beside its provenance twin since #1097:
 * the Stigmer harness's translator reports the same answer on every
 * `tool_started`, so the transcript row and this gate can never disagree
 * about whether a call waits. This module is where the decision is ACTED on.
 *
 * Gateway invariant: this middleware IS the in-process execution
 * gateway for the deep-agent harness — `handler(request)` is the side effect. A
 * side effect runs only with a backing authorization: either (a) the tool was
 * auto-approved (the default does not ask for it, a lease cleared it, or
 * auto-approve-all disabled the whole gate), or (b) the user explicitly approved THIS interrupted call. Every
 * other outcome — skip, reject, or an unrecognized decision — returns a
 * ToolMessage WITHOUT executing. There is no path from a model proposal to a
 * side effect that skips an authorization.
 *
 * Whether a tool may be called at all is not this gate's question: the
 * agent's tool lists are enforced by `tool-scope.ts`, installed ahead of this
 * gate, so a listed-out call is refused before it could reach a card or a
 * hook, and the refusal binds even when this gate is absent.
 *
 * Hooks. An agent's hooks (`shared/hooks/`) are an input to this one
 * decision point, never a middleware of their own, so the resume, the
 * bypass and capture are handled once. Per call, in order:
 *
 *  1. Secret-like writes are blocked exactly as before, ahead of any hook:
 *     no hook can allow one where the block applies. A hook's rewritten
 *     arguments are checked again: first by the graph's tool scope (the one
 *     installed ahead of this gate, passed in beside the config; its refusal
 *     reads as the scope's own, under the pre-armed bypass too), then by
 *     this block. A hook's rewrite replaces the arguments, which the lists
 *     and the block judge again, as the Claude engine's gate does.
 *  2. PreToolUse. `deny` refuses the call (the handler never runs; the row
 *     opens and fails through the refusal event, with the hook named);
 *     `ask` (or `defer`) shows the approval card, naming the hook, unless
 *     "trust this whole run" satisfies it or the unattended mode skips it;
 *     `allow` runs the call without the default's ask; a hook's rewritten
 *     input replaces the arguments. No decision falls through.
 *  3. Capture mode keeps its flow-and-review bookkeeping for whatever runs:
 *     capture is review, not approval, so a hook's `allow` never skips it.
 *     With no hook deciding, a built-in write or delete then flows when it
 *     lies inside the outputs folder and a workspace edit would flow
 *     (`outputs`: never captured, it comes back as a File), when the turn's
 *     file review is off (`file_review_off`), or when capture would review
 *     it (`file_capture`).
 *  4. The default, only when no hook decided: for a built-in write or
 *     delete that means a turn with review on and nothing to capture it.
 *  5. The handler; when it succeeds, PostToolUse. Every hook's context, and
 *     a PostToolUse hook's reasons for blocking, are appended to the result.
 *
 * A call a hook decided writes its provenance on the graph's custom stream
 * ({@link TOOL_POLICY_EVENT}) before its handler runs: a hook is a process,
 * and the translator cannot re-derive what it answered.
 *
 * Under "trust this whole run" (pre-armed auto_approve_all) the gate is
 * installed only when the agent has hooks, and then runs only them and the
 * handler: a hook's `deny` still binds, its `ask` is satisfied, and
 * everything else stays as the bypass has it (no default, no capture
 * bookkeeping, no secret block — secret writes are kept out of review by
 * `filereview/secret-paths.ts`).
 *
 * On resume the node restarts and PreToolUse runs again, as Claude Code's
 * `defer` re-fires it: a `deny` binds even after an approval, and a repeated
 * `ask` is answered by the stored decision through `interrupt()`. PostToolUse
 * runs once, because the handler runs once.
 *
 * Shadow ExecutionReceipt: when the gateway lets a side effect through it emits a
 * structured, non-persisted receipt (a `[hitl-gateway] receipt …` log carrying
 * the action's HMAC fingerprint and the authorization source). This is an audit
 * + uniformity signal only — no proto, no storage — in the same shadow
 * discipline as the server's approval-stream cross-check. On the deep-agent
 * normal path the fingerprint match is guaranteed
 * by LangGraph checkpoint replay (the resumed action equals the approved one), so
 * the receipt is defense-in-depth here.
 */

import { ToolMessage } from "@langchain/core/messages";
import { Command, interrupt } from "@langchain/langgraph";
import type { StigmerMiddleware, ToolCallRequest } from "./types.js";
import {
  type McpApprovalDefault,
  type PolicySource,
  POLICY_ENGINE_VERSION,
  resolveToolApproval,
  unattendedSkipMessage,
} from "../shared/approval-policy.js";
import { hookAskMessage, hookFeedbackSection, hookRefusalMessage, personDecisionSentence } from "../shared/hooks/messages.js";
import { NO_PRE_TOOL_USE, type HookCallScope, type HookEvaluator, type PreToolUseOutcome } from "../shared/hooks/evaluate.js";
import { TOOL_REFUSED_EVENT, customStreamWriterOf, toolScopeRefusal, type ToolRefusedPayload, type ToolScopeConfig } from "./tool-scope.js";
import { toolApprovalCategory, type ToolApprovalCategory } from "../shared/tool-kind.js";
import type { McpToolIndex } from "../shared/mcp-tool-names.js";
import { blockedSecretPath, captureFlows, fileEditFlow, secretBlockMessage, type FileEditPosture } from "../shared/file-edit-policy.js";
import {
  computeApprovalFingerprint,
  type FingerprintKey,
} from "../shared/approval-fingerprint.js";

/**
 * The gate's configuration. Its capture posture ({@link FileEditPosture}:
 * capture mode, review off, the substrate, the capturability predicate, the
 * CAS routing and the pre-delete capture) is the shared file-edit rules'
 * input (`shared/file-edit-policy.ts`), declared there once.
 */
export interface ApprovalGateConfig extends FileEditPosture {
  /** The approval default's MCP half: which MCP tools ask, and which servers a lease cleared. */
  readonly mcpDefault: McpApprovalDefault;
  /**
   * Built-in approval categories with a run-lifetime lease (the scoped successor
   * to auto-approve-all; see ActiveLeases). A built-in whose category is leased
   * is auto-approved for the rest of the run. MCP-server leases ride
   * {@link mcpDefault}.
   * Absent/empty means no built-in lease is active. Inherited verbatim by
   * sub-agents along with the rest of this config.
   */
  readonly leasedCategories?: ReadonlySet<ToolApprovalCategory>;
  /** The server and bare tool each MCP engine name stands for (the header). */
  readonly mcpIndex: McpToolIndex;
  /**
   * Per-execution HMAC key for the shadow receipt's action fingerprint. Derived
   * from the runner master secret + execution_id (see fingerprint-secret.ts).
   * Optional: when absent (unit tests, no-secret paths) the receipt is emitted
   * without a fingerprint rather than failing.
   */
  readonly fingerprintKey?: FingerprintKey;
  /** Execution id, carried into the shadow receipt for audit correlation. */
  readonly executionId?: string;
  /**
   * Sink for a gitignored path hard-blocked as secret-like: the write is
   * never applied and never captured, and the turn boundary reads these paths to
   * author a `DIFF_UNREVIEWABLE` change entry (path only — the name is not the
   * secret; the CONTENT never leaves the workspace). Absent ⇒ nothing recorded.
   */
  readonly recordBlockedSecret?: (rawPath: string) => void;
  /**
   * The agent's hooks, run before the default (the header's order); absent
   * or null when the agent has none. Shared by the parent and every
   * sub-agent gate: hooks are agent-wide, as a plugin's are in Claude Code.
   */
  readonly hooks?: HookEvaluator | null;
  /**
   * Pre-armed auto_approve_all. The gate is installed under it only when the
   * agent has hooks, and then runs only them and the handler (the header).
   */
  readonly globalBypass?: boolean;
  /** The sub-agent this gate serves, which a hook sees as `agent_type` and `agent_id`; absent on the parent. */
  readonly subAgent?: HookCallScope["subAgent"];
  /**
   * Unattended approval mode (`status.approval_mode` = UNATTENDED):
   * the lane the turn came through — a schedule, a messaging channel, a
   * chat-link guest — has no approver, so a gated tool is resolved as an automatic SKIP (the model is
   * told to adapt) instead of `interrupt()`. The execution never enters
   * WAITING_FOR_APPROVAL. What is gated is unchanged — only the resolution
   * differs.
   */
  readonly unattended?: boolean;
  /**
   * Registry of tool-call ids this gate auto-skipped under {@link unattended},
   * each with the hook whose ask was skipped (`null` when the default asked)
   * — the gate is the single WRITER; `reconcileUnattendedSkips` (hitl.ts) is
   * the reader that folds each id into a terminal TOOL_CALL_SKIPPED row with
   * UNATTENDED_SKIP provenance after the stream. In-process, per-execution
   * state keyed by the framework's own tool-call id (direct identity, no
   * matching); inherited verbatim by sub-agent gates so their skips land in
   * the same registry.
   */
  readonly unattendedSkips?: Map<string, string | null>;
  /**
   * The calls a person refused on their card, from the decisions this turn
   * resumes with (`TurnInput.approvalDecisions`): `skip` or `reject` by
   * tool-call id, with the reason the person gave (`""` for none). On resume
   * the hooks run again and may now allow, or no longer ask; the person's
   * refusal binds before any answer but a hook's deny, so a refused call
   * never runs.
   */
  readonly refusedByPerson?: ReadonlyMap<string, PersonRefusal>;
}

/**
 * The custom-stream event a call a hook decided writes before its handler
 * runs (`translator.ts` reads it into a `tool_policy` transcript event).
 */
export const TOOL_POLICY_EVENT = "stigmer.tool_policy";

/** The {@link TOOL_POLICY_EVENT} payload. */
export interface ToolPolicyPayload {
  readonly name: typeof TOOL_POLICY_EVENT;
  readonly tool_call_id: string;
  readonly policy_source: PolicySource;
  /** The deciding plugin's slug; `""` for the agent's own hooks block. */
  readonly policy_hook: string;
}

export { HOOK_FEEDBACK_HEADING } from "../shared/hooks/messages.js";

interface ApprovalDecision {
  readonly action: string;
  readonly comment?: string;
}

/** A call a person refused: skip or reject, and the reason they gave (`""` for none), which the model reads. */
export interface PersonRefusal {
  readonly action: "skip" | "reject";
  readonly comment: string;
}

/**
 * The ToolMessage returned when a secret-like write is hard-blocked: the
 * write is NEVER applied and the graph continues (this replaces
 * the tool call's side effect, so the model moves on rather than waiting). The
 * path is named (a filename is not itself the secret); the CONTENT is not echoed.
 * Shared by the capture-mode secret block and the deny-gate secret block so both
 * speak with one voice.
 */
function secretBlockToolMessage(toolName: string, path: string, toolCallId: string): ToolMessage {
  return new ToolMessage({ content: secretBlockMessage(toolName, path), tool_call_id: toolCallId, name: toolName });
}

/**
 * The gate. `toolScope` is the scope this same graph installs ahead of it,
 * passed per graph rather than in `config`, which a sub-agent inherits
 * verbatim: a sub-agent's rewrite is judged by its own narrowed lists, never
 * the parent's.
 */
export function createApprovalGateMiddleware(
  config: ApprovalGateConfig,
  toolScope?: ToolScopeConfig,
): StigmerMiddleware {
  const { mcpDefault, mcpIndex } = config;
  const leasedCategories = config.leasedCategories ?? EMPTY_CATEGORY_SET;
  const hooks = config.hooks ?? null;
  const globalBypass = config.globalBypass ?? false;
  const scope: HookCallScope = config.subAgent ? { subAgent: config.subAgent } : {};

  return {
    name: "ApprovalGateMiddleware",

    async wrapToolCall(request: ToolCallRequest, handler) {
      const { toolCall } = request;
      const owner = mcpIndex.ownerOf(toolCall.name);
      const toolName = owner?.tool ?? toolCall.name;
      const serverSlug = owner?.slug ?? "";
      const category = owner === undefined ? toolApprovalCategory(toolName) : undefined;

      // 1. Secret-like writes, ahead of anything a hook could answer.
      if (!globalBypass) {
        const blocked = await secretWriteBlock(config, toolCall, serverSlug, category);
        if (blocked) return blocked;
      }

      // 2. PreToolUse.
      const pre = hooks
        ? await hooks.preToolUse({ id: toolCall.id, name: toolName, args: toolCall.args, serverSlug }, scope)
        : NO_PRE_TOOL_USE;
      if (pre.decision === "deny") return refuseByHook(request, pre);
      const refused = config.refusedByPerson?.get(toolCall.id);
      if (refused !== undefined) return personDecisionMessage(request, refused.action, refused.comment);

      let call = request;
      if (pre.updatedArgs !== undefined) {
        call = { ...request, toolCall: { ...toolCall, args: pre.updatedArgs } };
        // The lists bind under the bypass too, as they do ahead of this gate.
        const outOfScope = toolScope === undefined ? undefined : await toolScopeRefusal(toolScope, call);
        if (outOfScope !== undefined) return outOfScope;
        if (!globalBypass) {
          const blocked = await secretWriteBlock(config, call.toolCall, serverSlug, category);
          if (blocked) return blocked;
        }
      }

      const hookSource = await resolveHookDecision(config, call, toolName, serverSlug, pre, pre.decision, globalBypass);
      if (hookSource instanceof ToolMessage) return hookSource;

      const run = async (source: PolicySource | undefined, authorization: AuthorizationSource) => {
        if (hookSource !== undefined) writeToolPolicy(call, hookSource, pre.hook);
        emitExecutionReceipt(config, { ...call.toolCall, name: toolName }, serverSlug, category, authorization, source);
        return withHookFeedback(await handler(call), call, toolName, serverSlug, pre, hooks, scope);
      };

      if (hookSource !== undefined) {
        // A hook decided: capture still reviews what runs (3).
        if (!globalBypass) await captureFlows(config, call.toolCall.args, serverSlug, category);
        return run(hookSource, pre.decision === "ask" && hookSource === "hook" ? "approval" : "auto_approve");
      }
      if (globalBypass) return run("auto_approve_all", "auto_approve");

      // 3. A file edit flows: review is off, or capture reviews it.
      const flow = await fileEditFlow(config, call.toolCall.args, serverSlug, category);
      if (flow !== undefined) return run(flow, "auto_approve");

      // 4. The default.
      const requirement = resolveToolApproval(toolName, serverSlug, call.toolCall.args, mcpDefault, leasedCategories);
      if (!requirement.requiresApproval) {
        // Backing authorization: the default does not ask for this tool, or a lease cleared it.
        return run(requirement.source, "auto_approve");
      }

      // Unattended surfaces (channels, chat-link guests) have no approver, so a
      // gate that would interrupt() here resolves as an automatic SKIP: the
      // tool does NOT run (the gateway invariant holds — no side effect
      // without a backing authorization), the model is told to adapt in plain
      // language, and the turn continues to normal completion instead of
      // parking in WAITING_FOR_APPROVAL forever. The registry entry lets the
      // post-stream reconciler stamp the terminal SKIPPED row + provenance.
      if (config.unattended) return skipUnattended(config, call, null);

      const decision = await askPerson(call, {
        tool_call_id: toolCall.id,
        tool_name: toolName,
        mcp_server_slug: serverSlug,
        message: requirement.message,
        // Carry the gate's provenance verdict through the interrupt so the
        // reinvocation that seeds the WAITING_APPROVAL tool call (index.ts) can
        // persist ToolCall.approval_policy_source without re-deriving it.
        policy_source: requirement.source,
      });
      if (decision !== "approve") return decision;
      // Backing authorization: the user approved THIS interrupted call.
      return run(requirement.source, "approval");
    },
  };

  /**
   * What a hook's non-deny answer does to the call: the provenance it runs
   * under, `undefined` when no hook decided, or the message that ends it
   * without running (the unattended skip, or a person's skip or reject).
   */
  async function resolveHookDecision(
    gate: ApprovalGateConfig,
    call: ToolCallRequest,
    toolName: string,
    serverSlug: string,
    pre: PreToolUseOutcome,
    decision: Exclude<PreToolUseOutcome["decision"], "deny">,
    bypass: boolean,
  ): Promise<PolicySource | undefined | ToolMessage> {
    switch (decision) {
      case undefined:
        return undefined;
      case "allow":
        return pre.leased ? "approval_lease" : "hook";
      case "ask": {
        if (bypass) return "auto_approve_all";
        if (gate.unattended) return skipUnattended(gate, call, pre.hook);
        const decision = await askPerson(call, {
          tool_call_id: call.toolCall.id,
          tool_name: toolName,
          mcp_server_slug: serverSlug,
          message: pre.reason || hookAskMessage(pre.hook, hooks?.viewOf({ ...call.toolCall, name: toolName, serverSlug })?.toolName ?? toolName),
          policy_source: "hook",
          policy_hook: pre.hook,
          ...(pre.updatedArgs !== undefined ? { args: call.toolCall.args } : {}),
        });
        return decision === "approve" ? "hook" : decision;
      }
      /* v8 ignore start -- @preserve: the never arm; the compiler proves no decision reaches it */
      default: {
        const exhaustive: never = decision;
        throw new Error(`approval gate: unknown hook decision ${String(exhaustive)}`);
      }
      /* v8 ignore stop */
    }
  }
}

/** The interrupt payload: identity and the card's facts, nothing the row already holds. */
interface ApprovalRequestPayload {
  readonly tool_call_id: string;
  readonly tool_name: string;
  readonly mcp_server_slug: string;
  readonly message: string;
  readonly policy_source: PolicySource | undefined;
  /** The plugin whose hook asked; present only when one did. */
  readonly policy_hook?: string;
  /**
   * The arguments the call will run with, present only when a hook rewrote
   * them: they exist nowhere else (the model's message holds the original),
   * and the card must show what an approval lets run.
   */
  readonly args?: Record<string, unknown>;
}

/**
 * Pause for a person's decision (`interrupt()`; on resume it returns the
 * stored decision). `"approve"` lets the call run; anything else is the
 * message the call ends with, unrun.
 */
async function askPerson(call: ToolCallRequest, payload: ApprovalRequestPayload): Promise<"approve" | ToolMessage> {
  const toolName = call.toolCall.name;
  const response = interrupt(payload) as ApprovalDecision;
  const action = (
    typeof response === "object" && response !== null
      ? (response.action ?? "")
      : ""
  ).toString().toLowerCase();

  if (action === "approve") return "approve";
  if (action === "skip" || action === "reject") return personDecisionMessage(call, action, response.comment ?? "");

  return new ToolMessage({
    content: `Tool '${toolName}' approval returned unknown action: '${action}'. Treating as skip.`,
    tool_call_id: call.toolCall.id,
    name: toolName,
  });
}

/**
 * The message a call a person skipped or rejected ends with, unrun. REJECT
 * denies this call and the run continues (APPROVAL_ACTION_REJECT in
 * enum.proto): the objection is fed back so the model adapts rather than
 * retrying; SKIP differs only in the strength of the signal.
 */
function personDecisionMessage(call: ToolCallRequest, action: "skip" | "reject", comment: string): ToolMessage {
  const toolName = call.toolCall.name;
  return new ToolMessage({ content: personDecisionSentence(toolName, action, comment), tool_call_id: call.toolCall.id, name: toolName });
}

/**
 * Resolve an ask on an unattended surface as a skip; `hook` names the hook
 * that asked, `null` the default. The skipped call fires no tool events, so
 * the gate says so on the custom stream as a refusal does, with
 * `unattended_skip` as its provenance: the call's row opens already known to
 * be skipped, before anything writes it to the session's log.
 */
function skipUnattended(config: ApprovalGateConfig, call: ToolCallRequest, hook: string | null): ToolMessage {
  const { id, name, args } = call.toolCall;
  const message = unattendedSkipMessage(name);
  config.unattendedSkips?.set(id, hook);
  customStreamWriterOf<ToolRefusedPayload>(call.runtime)?.({
    name: TOOL_REFUSED_EVENT,
    tool_call_id: id,
    tool_name: name,
    input: args,
    message,
    policy_source: "unattended_skip",
    policy_hook: hook ?? "",
  });
  return new ToolMessage({ content: message, tool_call_id: id, name });
}

/**
 * The secret-like write block (`shared/file-edit-policy.ts`
 * `blockedSecretPath`): the write is never applied and never surfaced for
 * approval, and its path is recorded for the turn boundary's content-less
 * DIFF_UNREVIEWABLE entry. Undefined when the call is not blocked.
 */
async function secretWriteBlock(
  config: ApprovalGateConfig,
  toolCall: ToolCallRequest["toolCall"],
  serverSlug: string,
  category: ToolApprovalCategory | undefined,
): Promise<ToolMessage | undefined> {
  const path = await blockedSecretPath(config, toolCall.args, serverSlug, category);
  if (path === undefined) return undefined;
  config.recordBlockedSecret?.(path);
  return secretBlockToolMessage(toolCall.name, path, toolCall.id);
}

/** A hook's refusal: the handler never runs, the model reads why, and the row opens and fails with the hook named. */
function refuseByHook(request: ToolCallRequest, pre: PreToolUseOutcome): ToolMessage {
  const { id, name, args } = request.toolCall;
  const message = hookRefusalMessage(pre.hook, pre.reason);
  customStreamWriterOf<ToolRefusedPayload>(request.runtime)?.({
    name: TOOL_REFUSED_EVENT,
    tool_call_id: id,
    tool_name: name,
    input: args,
    message,
    policy_source: "hook",
    policy_hook: pre.hook,
  });
  return new ToolMessage({ content: message, tool_call_id: id, name, status: "error" });
}

/** Say on the custom stream which hook decided a call that is about to run (the header). */
function writeToolPolicy(call: ToolCallRequest, source: PolicySource, hook: string): void {
  customStreamWriterOf<ToolPolicyPayload>(call.runtime)?.({
    name: TOOL_POLICY_EVENT,
    tool_call_id: call.toolCall.id,
    policy_source: source,
    policy_hook: hook,
  });
}

/**
 * The call's result with the hooks' feedback appended: PreToolUse context
 * whatever the result, and, when the call succeeded, what PostToolUse hooks
 * hand back (their reasons for blocking, then their context). A tool that
 * answers with a graph command (a sub-agent's `task`, a file write that
 * updates state) carries its result as the command's tool message for this
 * call, which gets the same feedback; a command with no such message is
 * returned as it is.
 */
async function withHookFeedback(
  result: ToolMessage | Command,
  call: ToolCallRequest,
  toolName: string,
  serverSlug: string,
  pre: PreToolUseOutcome,
  hooks: HookEvaluator | null,
  scope: HookCallScope,
): Promise<ToolMessage | Command> {
  if (hooks === null) return result;
  const appendTo = (message: ToolMessage) => appendHookFeedback(message, call, toolName, serverSlug, pre, hooks, scope);
  if (result instanceof ToolMessage) return appendTo(result);

  const update = result.update;
  const messages = update !== null && typeof update === "object" && !Array.isArray(update) ? (update as Record<string, unknown>)["messages"] : undefined;
  if (!Array.isArray(messages)) return result;
  const index = messages.findIndex((m) => m instanceof ToolMessage && m.tool_call_id === call.toolCall.id);
  if (index === -1) return result;
  const original = messages[index] as ToolMessage;
  const appended = await appendTo(original);
  if (appended === original) return result;
  return new Command({
    update: { ...(update as Record<string, unknown>), messages: messages.map((m, i) => (i === index ? appended : m)) },
    ...(result.graph !== undefined ? { graph: result.graph } : {}),
    ...(result.goto !== undefined ? { goto: result.goto } : {}),
    ...(result.resume !== undefined ? { resume: result.resume } : {}),
  });
}

async function appendHookFeedback(
  result: ToolMessage,
  call: ToolCallRequest,
  toolName: string,
  serverSlug: string,
  pre: PreToolUseOutcome,
  hooks: HookEvaluator,
  scope: HookCallScope,
): Promise<ToolMessage> {
  const feedback = [...pre.additionalContext];
  if (result.status !== "error") {
    const post = await hooks.postToolUse(
      { id: call.toolCall.id, name: toolName, args: call.toolCall.args, serverSlug },
      scope,
      typeof result.content === "string" ? result.content : JSON.stringify(result.content),
    );
    feedback.push(...post.blockReasons, ...post.additionalContext);
    for (const error of post.errors) console.warn(`[hooks] a PostToolUse hook failed: ${error}`);
  }
  if (feedback.length === 0) return result;
  const appended = hookFeedbackSection(feedback);
  return new ToolMessage({
    content: typeof result.content === "string"
      ? `${result.content}\n\n${appended}`
      : [...result.content, { type: "text", text: appended }],
    tool_call_id: result.tool_call_id,
    name: result.name,
    ...(result.status !== undefined ? { status: result.status } : {}),
  });
}

/** Shared empty set so a config without leases allocates nothing per call. */
const EMPTY_CATEGORY_SET: ReadonlySet<ToolApprovalCategory> = new Set();

type AuthorizationSource = "auto_approve" | "approval";

/**
 * Emit the shadow ExecutionReceipt when the gateway authorizes a side effect.
 *
 * Scope: only side-effecting actions are recorded — a mutating built-in (a
 * non-empty {@link ToolApprovalCategory}) or any MCP tool (`serverSlug` present).
 * Read-only built-ins are not side effects, so recording them would only dilute
 * the signal. The receipt is a structured log carrying the action's HMAC
 * fingerprint and the authorization source; it is never persisted and crosses no
 * wire (no proto). The fingerprint is omitted (empty) when no per-execution key
 * was supplied (tests / no-secret paths).
 */
function emitExecutionReceipt(
  config: ApprovalGateConfig,
  toolCall: { id: string; name: string; args: Record<string, unknown> },
  serverSlug: string,
  category: ToolApprovalCategory | undefined,
  source: AuthorizationSource,
  policySource: PolicySource | undefined,
): void {
  if (!category && !serverSlug) return;

  const fingerprint = config.fingerprintKey
    ? computeApprovalFingerprint(config.fingerprintKey, {
        toolName: toolCall.name,
        mcpServerSlug: serverSlug,
        args: toolCall.args,
      })
    : "";

  console.log(
    "[hitl-gateway] receipt " +
    JSON.stringify({
      executionId: config.executionId ?? "",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      mcpServerSlug: serverSlug,
      category: category ?? "",
      authorization: source,
      policySource: policySource ?? "",
      policyEngineVersion: POLICY_ENGINE_VERSION,
      fingerprint,
      substrate: "stigmer",
    }),
  );
}
