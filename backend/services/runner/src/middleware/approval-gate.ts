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
 * Platform tool defaults: DeepAgents JS backend tools (read, write,
 * edit, execute, etc.) are not MCP tools. Built-in tools
 * are classified through the shared {@link toolApprovalCategory} — the single
 * source of truth, shared with the Cursor deny-oracle hook — so read-only tools
 * are auto-approved and every mutating tool (write/edit/delete/shell) is gated
 * fail-CLOSED, by category rather than by a hand-maintained name list. An
 * unrecognized mutating built-in (e.g. `bash`, `overwrite_file`) is therefore
 * gated by what it does, not by whether someone remembered to list it.
 *
 * The decision itself — `resolveToolApproval` — lives in
 * `shared/approval-policy.ts` beside its provenance twin since #1097:
 * the native translator reports the same answer on every
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
 *     arguments are checked again.
 *  2. PreToolUse. `deny` refuses the call (the handler never runs; the row
 *     opens and fails through the refusal event, with the hook named);
 *     `ask` (or `defer`) shows the approval card, naming the hook, unless
 *     "trust this whole run" satisfies it or the unattended mode skips it;
 *     `allow` runs the call without the default's ask; a hook's rewritten
 *     input replaces the arguments. No decision falls through.
 *  3. Capture mode keeps its flow-and-review bookkeeping for whatever runs:
 *     capture is review, not approval, so a hook's `allow` never skips it.
 *  4. The default, only when no hook decided.
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
 * the receipt is defense-in-depth here; the fingerprint earns real enforcement
 * teeth in the out-of-process Cursor substrate.
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
import { NO_PRE_TOOL_USE, type HookCallScope, type HookEvaluator, type PreToolUseOutcome } from "../shared/hooks/evaluate.js";
import { TOOL_REFUSED_EVENT, customStreamWriterOf, type ToolRefusedPayload } from "./tool-scope.js";
import { toolApprovalCategory, type ToolApprovalCategory } from "../shared/tool-kind.js";
import { extractFilePath } from "../shared/file-tools.js";
import { isSecretLikePath } from "../shared/filereview/secret-paths.js";
import {
  computeApprovalFingerprint,
  type FingerprintKey,
} from "../shared/approval-fingerprint.js";

export interface ApprovalGateConfig {
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
  readonly toolServerMap: ReadonlyMap<string, string>;
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
   * Apply-then-review capture mode (git workspaces). When true, a built-in
   * `write`/`delete` whose target path is capturable (git-tracked — see
   * {@link isCapturablePath}) FLOWS instead of interrupting: the edit is reviewed
   * post-hoc as a captured `FileChangeSet`, not gated before it runs. A gitignored
   * path is NOT capturable by the git substrate, so it stays gated unless
   * {@link captureIgnored} routes it into CAS capture — the exact twin of the
   * Cursor hook's `__stigmer_is_gitignored` allow-branch. `shell` and MCP tools
   * are never bypassed by this flag. Off (the default) keeps the classic
   * true-pause gate for every mutation.
   */
  readonly fileCaptureMode?: boolean;
  /**
   * Capturability predicate for {@link fileCaptureMode}: given a tool's raw target
   * path (as the model wrote it), resolves true when the path would be captured by
   * the git snapshot (tracked / not gitignored). Injected by setup so the gate
   * stays pure and testable, and so the harness owns path normalization (the
   * deep-agent virtual-root path mapping). Absent ⇒ nothing is bypassed (safe).
   */
  readonly isCapturablePath?: (rawPath: string) => Promise<boolean>;
  /**
   * Route gitignored `write`/`edit` edits into CAS capture (apply-then-review)
   * instead of the interrupt gate, applying the secret gate. When off, a
   * gitignored path stays on the interrupt gate exactly as before.
   *
   * True only for gates whose backend a CAS observer wraps: the parent gate
   * always (turn-setup.ts), and sub-agent gates too, because
   * `compileSubagents` gives every sub-agent a CAS-observing backend wired to
   * the SAME shared observer and `buildSubAgentMiddleware` then inherits this
   * config verbatim. A gate over an UNOBSERVED backend must keep this false:
   * flowing its gitignored edits would apply unobserved, unreviewable bytes.
   */
  readonly captureIgnored?: boolean;
  /**
   * Sink for a gitignored path hard-blocked as secret-like: the write is
   * never applied and never captured, and the turn boundary reads these paths to
   * author a `DIFF_UNREVIEWABLE` change entry (path only — the name is not the
   * secret; the CONTENT never leaves the workspace). Absent ⇒ nothing recorded.
   */
  readonly recordBlockedSecret?: (rawPath: string) => void;
  /**
   * Capture a file's pre-delete bytes into the CAS observer so a CAS-owned
   * (gitignored / non-git) DELETE can flow under {@link captureIgnored} and be
   * reviewed post-hoc exactly like a write (issue #303) — the delete twin of the
   * backend's `recordBefore` write observation. A delete is the one mutation the
   * backend cannot observe (deepagents has no backend delete method to wrap), so
   * the gate captures at authorization time instead: the file's bytes are still
   * on disk here, and the turn boundary then reads after=null and authors a
   * `FILE_CHANGE_KIND_DELETE` with the same discard-restores contract.
   *
   * Absent ⇒ deletes keep today's interrupt-gate behavior (fail-closed: a delete
   * we cannot capture cannot be reviewed, so it must be approved up front).
   */
  readonly captureDeleteBefore?: (rawPath: string) => Promise<void>;
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
   * guest share — has no approver, so a gated tool is resolved as an automatic SKIP (the model is
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
   * tool-call id. On resume the hooks run again and may now allow, or no
   * longer ask; the person's refusal binds before any answer but a hook's
   * deny, so a refused call never runs.
   */
  readonly refusedByPerson?: ReadonlyMap<string, "skip" | "reject">;
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

/** The heading the hooks' feedback is appended to a tool result under. */
export const HOOK_FEEDBACK_HEADING = "Hook feedback:";

interface ApprovalDecision {
  readonly action: string;
  readonly comment?: string;
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
  return new ToolMessage({
    content:
      `Tool '${toolName}' was blocked for security: '${path}' matches a ` +
      `secret-like path Stigmer will not capture for review. Nothing was written.`,
    tool_call_id: toolCallId,
    name: toolName,
  });
}

export function createApprovalGateMiddleware(
  config: ApprovalGateConfig,
): StigmerMiddleware {
  const { mcpDefault, toolServerMap } = config;
  const leasedCategories = config.leasedCategories ?? EMPTY_CATEGORY_SET;
  const hooks = config.hooks ?? null;
  const globalBypass = config.globalBypass ?? false;
  const scope: HookCallScope = config.subAgent ? { subAgent: config.subAgent } : {};

  return {
    name: "ApprovalGateMiddleware",

    async wrapToolCall(request: ToolCallRequest, handler) {
      const { toolCall } = request;
      const toolName = toolCall.name;
      const serverSlug = toolServerMap.get(toolName) ?? "";
      const category = toolApprovalCategory(toolName);

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
      if (refused !== undefined) return personDecisionMessage(request, refused, "");

      let call = request;
      if (pre.updatedArgs !== undefined) {
        call = { ...request, toolCall: { ...toolCall, args: pre.updatedArgs } };
        if (!globalBypass) {
          const blocked = await secretWriteBlock(config, call.toolCall, serverSlug, category);
          if (blocked) return blocked;
        }
      }

      const hookSource = await resolveHookDecision(config, call, serverSlug, pre, pre.decision, globalBypass);
      if (hookSource instanceof ToolMessage) return hookSource;

      const run = async (source: PolicySource | undefined, authorization: AuthorizationSource) => {
        if (hookSource !== undefined) writeToolPolicy(call, hookSource, pre.hook);
        emitExecutionReceipt(config, call.toolCall, serverSlug, category, authorization, source);
        return withHookFeedback(await handler(call), call, serverSlug, pre, hooks, scope);
      };

      if (hookSource !== undefined) {
        // A hook decided: capture still reviews what runs (3).
        if (!globalBypass) await captureFlows(config, call.toolCall, serverSlug, category);
        return run(hookSource, pre.decision === "ask" && hookSource === "hook" ? "approval" : "auto_approve");
      }
      if (globalBypass) return run("auto_approve_all", "auto_approve");

      // 3. Capture mode: a mutation it can review flows.
      if (await captureFlows(config, call.toolCall, serverSlug, category)) {
        return run("file_capture", "auto_approve");
      }

      // 4. The default.
      const requirement = resolveToolApproval(toolName, serverSlug, call.toolCall.args, mcpDefault, leasedCategories);
      if (!requirement.requiresApproval) {
        // Backing authorization: the default does not ask for this tool, or a lease cleared it.
        return run(requirement.source, "auto_approve");
      }

      // Unattended surfaces (channels, guest shares) have no approver, so a
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
          tool_name: call.toolCall.name,
          mcp_server_slug: serverSlug,
          message: pre.reason || hookAskMessage(pre.hook, hooks?.viewOf({ ...call.toolCall, serverSlug })?.toolName ?? call.toolCall.name),
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
  const content = action === "skip"
    ? comment
      ? `Tool '${toolName}' was skipped by user: ${comment}. Please proceed without this operation.`
      : `Tool '${toolName}' was skipped by user. Please proceed without this operation.`
    : comment
      ? `Tool '${toolName}' was rejected by the user: ${comment}. Do not retry it; proceed by taking their objection into account.`
      : `Tool '${toolName}' was rejected by the user. Do not retry it; proceed by taking their objection into account.`;
  return new ToolMessage({ content, tool_call_id: call.toolCall.id, name: toolName });
}

/** Resolve an ask on an unattended surface as a skip; `hook` names the hook that asked, `null` the default. */
function skipUnattended(config: ApprovalGateConfig, call: ToolCallRequest, hook: string | null): ToolMessage {
  config.unattendedSkips?.set(call.toolCall.id, hook);
  return new ToolMessage({
    content: unattendedSkipMessage(call.toolCall.name),
    tool_call_id: call.toolCall.id,
    name: call.toolCall.name,
  });
}

/**
 * The secret-like write block: a built-in WRITE to a secret-like path that
 * has no capture substrate for it is never applied and never surfaced for
 * approval. Undefined when the call is not blocked.
 *
 * The cases, unchanged from before hooks: in capture mode a git-tracked path
 * flows (git reviews it); a gitignored or non-git one is blocked whether or
 * not a CAS observer backs the gate (`captureIgnored` would capture it, and
 * its content must not surface anywhere); outside capture mode, the classic
 * no-storage deny-gate, it is blocked. The turn boundary reads the recorded
 * path to author a content-less DIFF_UNREVIEWABLE entry. A delete carries no
 * content, so a secret-like delete needs no block: a human may still approve
 * it on the card (its bytes are simply never captured).
 */
async function secretWriteBlock(
  config: ApprovalGateConfig,
  toolCall: ToolCallRequest["toolCall"],
  serverSlug: string,
  category: ToolApprovalCategory | undefined,
): Promise<ToolMessage | undefined> {
  if (serverSlug || category !== "write") return undefined;
  const path = extractFilePath(toolCall.args);
  if (path === null || !isSecretLikePath(path)) return undefined;
  if (config.fileCaptureMode && config.isCapturablePath && (await config.isCapturablePath(path))) return undefined;
  config.recordBlockedSecret?.(path);
  return secretBlockToolMessage(toolCall.name, path, toolCall.id);
}

/**
 * Capture mode (git workspaces): whether a built-in file mutation flows
 * during the turn, to be reviewed after it through the file-review ledger
 * (apply-then-review), doing the bookkeeping that review needs. shell and MCP
 * tools (serverSlug present) never flow here.
 *
 *  - A git-tracked path flows: the git substrate reviews it.
 *  - A gitignored or non-git path flows only on a gate whose backend the
 *    shared CAS observer wraps (`captureIgnored`: the parent gate, and the
 *    sub-agent gates): a write (secret-like ones were already blocked), its
 *    before-bytes already held by the observer; or a delete that is not
 *    secret-like, whose before-bytes are captured NOW (issue #303: the one
 *    moment they still exist, with no backend delete method to observe
 *    them). A secret-like delete stays on the interrupt gate: a human may
 *    approve it, but its bytes must never enter CAS.
 *
 * Any other gate answers false, and the default decides.
 */
async function captureFlows(
  config: ApprovalGateConfig,
  toolCall: ToolCallRequest["toolCall"],
  serverSlug: string,
  category: ToolApprovalCategory | undefined,
): Promise<boolean> {
  if (!config.fileCaptureMode || !config.isCapturablePath || serverSlug) return false;
  if (category !== "write" && category !== "delete") return false;
  const path = extractFilePath(toolCall.args);
  if (path === null) return false;
  if (await config.isCapturablePath(path)) return true;
  if (!config.captureIgnored) return false;
  if (category === "write") return true;
  if (config.captureDeleteBefore && !isSecretLikePath(path)) {
    await config.captureDeleteBefore(path);
    return true;
  }
  return false;
}

/** A hook's refusal: the handler never runs, the model reads why, and the row opens and fails with the hook named. */
function refuseByHook(request: ToolCallRequest, pre: PreToolUseOutcome): ToolMessage {
  const { id, name, args } = request.toolCall;
  const message = `${hookLabel(pre.hook)} refused this call${pre.reason ? `: ${pre.reason}` : "."}`;
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

/** How a card or a refusal names a hook source. */
function hookLabel(hook: string): string {
  return hook === "" ? "The agent's hook" : `The ${hook} plugin's hook`;
}

/** The card's message when an asking hook gave no reason. */
function hookAskMessage(hook: string, toolName: string): string {
  return hook === "" ? `The agent's hooks ask before ${toolName}` : `The ${hook} plugin asks before ${toolName}`;
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
  serverSlug: string,
  pre: PreToolUseOutcome,
  hooks: HookEvaluator | null,
  scope: HookCallScope,
): Promise<ToolMessage | Command> {
  if (hooks === null) return result;
  const appendTo = (message: ToolMessage) => appendHookFeedback(message, call, serverSlug, pre, hooks, scope);
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
  serverSlug: string,
  pre: PreToolUseOutcome,
  hooks: HookEvaluator,
  scope: HookCallScope,
): Promise<ToolMessage> {
  const feedback = [...pre.additionalContext];
  if (result.status !== "error") {
    const post = await hooks.postToolUse(
      { id: call.toolCall.id, name: call.toolCall.name, args: call.toolCall.args, serverSlug },
      scope,
      typeof result.content === "string" ? result.content : JSON.stringify(result.content),
    );
    feedback.push(...post.blockReasons, ...post.additionalContext);
    for (const error of post.errors) console.warn(`[hooks] a PostToolUse hook failed: ${error}`);
  }
  if (feedback.length === 0) return result;
  const appended = `${HOOK_FEEDBACK_HEADING}\n${feedback.join("\n\n")}`;
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
      substrate: "deep-agent",
    }),
  );
}
