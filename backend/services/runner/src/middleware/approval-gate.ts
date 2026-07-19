/**
 * Approval gate middleware for HITL (human-in-the-loop) tool approval.
 *
 * Checks each tool call against the merged approval policy. When a tool
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
 * edit, execute, etc.) are not covered by MCP policy chains. Built-in tools
 * are classified through the shared {@link toolApprovalCategory} — the single
 * source of truth, shared with the Cursor deny-oracle hook — so read-only tools
 * are auto-approved and every mutating tool (write/edit/delete/shell) is gated
 * fail-CLOSED, by category rather than by a hand-maintained name list. An
 * unrecognized mutating built-in (e.g. `bash`, `overwrite_file`) is therefore
 * gated by what it does, not by whether someone remembered to list it.
 *
 * Gateway invariant (Phase 2): this middleware IS the in-process execution
 * gateway for the deep-agent harness — `handler(request)` is the side effect. A
 * side effect runs only with a backing authorization: either (a) the tool was
 * auto-approved (policy/classifier cleared it, or auto-approve-all disabled the
 * whole gate), or (b) the user explicitly approved THIS interrupted call. Every
 * other outcome — skip, reject, or an unrecognized decision — returns a
 * ToolMessage WITHOUT executing. There is no path from a model proposal to a
 * side effect that skips an authorization.
 *
 * Shadow ExecutionReceipt: when the gateway lets a side effect through it emits a
 * structured, non-persisted receipt (a `[hitl-gateway] receipt …` log carrying
 * the action's HMAC fingerprint and the authorization source). This is an audit
 * + uniformity signal only — no proto, no storage — mirroring the Phase-1 shadow
 * discipline. On the deep-agent normal path the fingerprint match is guaranteed
 * by LangGraph checkpoint replay (the resumed action equals the approved one), so
 * the receipt is defense-in-depth here; the fingerprint earns real enforcement
 * teeth in the out-of-process Cursor substrate.
 */

import { ToolMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import type { StigmerMiddleware, ToolCallRequest } from "./types.js";
import {
  type MergedToolPolicy,
  type PolicySource,
  POLICY_ENGINE_VERSION,
  resolveApprovalMessage,
  unattendedSkipMessage,
} from "../shared/approval-policy.js";
import { toolApprovalCategory, type ToolApprovalCategory } from "../shared/tool-kind.js";
import { extractFilePath } from "../shared/file-tools.js";
import { isSecretLikePath } from "../shared/filereview/secret-paths.js";
import {
  computeApprovalFingerprint,
  type FingerprintKey,
} from "../shared/approval-fingerprint.js";

export interface ApprovalGateConfig {
  readonly policies: ReadonlyMap<string, MergedToolPolicy>;
  /**
   * Built-in approval categories with a run-lifetime lease (the scoped successor
   * to auto-approve-all; see ActiveLeases). A built-in whose category is leased
   * is auto-approved for the rest of the run. MCP-server leases are NOT carried
   * here — they are applied upstream by dropping the server's tools from
   * `policies` (mergeApprovalPolicies), which clears them for this gate too.
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
   * path is NOT capturable, so it stays gated (the git substrate cannot capture or
   * revert it) — the exact twin of the Cursor hook's `__stigmer_is_gitignored`
   * allow-branch. `shell` and MCP tools are never bypassed by this flag. Off (the
   * default) keeps the classic true-pause gate for every mutation.
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
   * instead of the interrupt gate, applying the DD-E secret gate. When off, a
   * gitignored path stays on the interrupt gate exactly as before.
   *
   * TRUE ONLY FOR THE PARENT GATE. Sub-agents build their own plain filesystem
   * backends, which the CAS observer does not wrap, so flowing their gitignored
   * edits would apply unobserved, unreviewable bytes. `buildSubAgentMiddleware`
   * therefore forces this to false for sub-agent gates — it must NOT be inherited
   * as true. (Sub-agent git-tracked edits are still captured by the turn-boundary
   * git diff, which is backend-agnostic.)
   */
  readonly captureIgnored?: boolean;
  /**
   * Sink for a gitignored path hard-blocked as secret-like (DD-E): the write is
   * never applied and never captured, and the turn boundary reads these paths to
   * author a `DIFF_UNREVIEWABLE` change entry (path only — the name is not the
   * secret; the CONTENT never leaves the workspace). Absent ⇒ nothing recorded.
   */
  readonly recordBlockedSecret?: (rawPath: string) => void;
  /**
   * Unattended approval mode (ExecutionConfig.approval_mode = UNATTENDED):
   * the creating surface — a messaging channel, a guest share — has no
   * approver, so a gated tool is resolved as an automatic SKIP (the model is
   * told to adapt) instead of `interrupt()`. The execution never enters
   * WAITING_FOR_APPROVAL. What is gated is unchanged — only the resolution
   * differs; an operator un-gates a specific tool for the agent via
   * tool_approval_overrides, not by weakening this mode.
   */
  readonly unattended?: boolean;
  /**
   * Registry of tool-call ids this gate auto-skipped under {@link unattended}
   * — the gate is the single WRITER; `reconcileUnattendedSkips` (hitl.ts) is
   * the reader that folds each id into a terminal TOOL_CALL_SKIPPED row with
   * UNATTENDED_SKIP provenance after the stream. In-process, per-execution
   * state keyed by the framework's own tool-call id (direct identity, no
   * matching); inherited verbatim by sub-agent gates so their skips land in
   * the same registry.
   */
  readonly unattendedSkips?: Set<string>;
}

interface ApprovalDecision {
  readonly action: string;
  readonly comment?: string;
}

// Approval-message template per mutating category. Keyed by category (not raw
// tool name) so every alias of a mutation renders one message; placeholders
// resolve against the deep-agent stream arg shape (`path`/`command`). Mirrors
// the Cursor side's CATEGORY_APPROVAL_MESSAGE.
const CATEGORY_APPROVAL_MESSAGE: Record<ToolApprovalCategory, string> = {
  write: "Write file: {{args.path}}",
  delete: "Delete: {{args.path}}",
  shell: "Execute command: {{args.command}}",
};

/**
 * The ToolMessage returned when a secret-like write is hard-blocked (DD-E /
 * DD-26 #2): the write is NEVER applied and the graph continues (this replaces
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
  const { policies, toolServerMap } = config;
  const leasedCategories = config.leasedCategories ?? EMPTY_CATEGORY_SET;

  // No global-bypass early return: a pre-armed spec.auto_approve_all means the
  // gate is never even installed (setup.ts builds this config only when not
  // global). Scoped leases keep the gate active so non-leased actions still gate.

  return {
    name: "ApprovalGateMiddleware",

    async wrapToolCall(request: ToolCallRequest, handler) {
      const { toolCall } = request;
      const toolName = toolCall.name;
      const serverSlug = toolServerMap.get(toolName) ?? "";
      const category = toolApprovalCategory(toolName);

      // Capture mode (git workspaces): a git-tracked built-in file mutation flows
      // during the turn and is reviewed post-hoc via the file_review ledger (the
      // apply-then-review model). shell and MCP tools (serverSlug present) are
      // never bypassed here.
      if (
        config.fileCaptureMode &&
        config.isCapturablePath &&
        !serverSlug &&
        (category === "write" || category === "delete")
      ) {
        const path = extractFilePath(toolCall.args);
        if (path !== null) {
          if (await config.isCapturablePath(path)) {
            // Git-tracked: flows and is reviewed post-hoc by the git substrate.
            emitExecutionReceipt(config, toolCall, serverSlug, category, "auto_approve", "file_capture");
            return await handler(request);
          }
          // Gitignored path. Only the PARENT gate (captureIgnored) routes it into
          // CAS capture; sub-agent gates fall through to the interrupt gate below,
          // exactly as before (their backends are not CAS-observed).
          if (config.captureIgnored) {
            if (isSecretLikePath(path)) {
              // DD-E fail-closed: a secret-like gitignored edit is NEVER applied
              // and NEVER captured. Record it so the turn boundary authors a
              // DIFF_UNREVIEWABLE entry (blocking approval); nothing is written.
              config.recordBlockedSecret?.(path);
              return secretBlockToolMessage(toolName, path, toolCall.id);
            }
            if (category === "write") {
              // Non-secret gitignored write/edit: flows (apply-then-review). The
              // CAS observer already holds its before-bytes and the turn boundary
              // captures it into CAS. (A gitignored delete has no backend capture
              // path, so it falls through to the interrupt gate.)
              emitExecutionReceipt(config, toolCall, serverSlug, category, "auto_approve", "file_capture");
              return await handler(request);
            }
          }
        }
      }

      // Deny-gate secret hard-block (DD-26 #2): a built-in file WRITE to a
      // secret-like path that reaches here has no capture substrate for it — the
      // classic no-storage deny-gate, or a git workspace with no artifact storage
      // whose gitignored write skipped the captureIgnored arm above. It must NOT
      // surface its content for approval, so hard-block it (never applied, graph
      // continues) exactly like the capture-mode secret block — a secret write is
      // never applied or persisted in ANY mode. Placed AFTER the capture block so
      // capture-mode paths stay byte-identical (a capturable write already flowed;
      // a captureIgnored gitignored secret is already blocked). Deletes carry no
      // content and stay on the deny-gate. recordBlockedSecret is a no-op unless a
      // turn boundary reads it (the git-no-storage case, where it authors a
      // content-less DIFF_UNREVIEWABLE).
      if (!serverSlug && category === "write") {
        const path = extractFilePath(toolCall.args);
        if (path !== null && isSecretLikePath(path)) {
          config.recordBlockedSecret?.(path);
          return secretBlockToolMessage(toolName, path, toolCall.id);
        }
      }

      const requirement = resolveToolApproval(
        toolName,
        serverSlug,
        toolCall.args,
        policies,
        leasedCategories,
      );

      if (!requirement.requiresApproval) {
        // Backing authorization: the classifier/policy auto-approved this tool.
        emitExecutionReceipt(config, toolCall, serverSlug, category, "auto_approve", requirement.source);
        return await handler(request);
      }

      // Unattended surfaces (channels, guest shares) have no approver, so a
      // gate that would interrupt() here resolves as an automatic SKIP: the
      // tool does NOT run (the gateway invariant holds — no side effect
      // without a backing authorization), the model is told to adapt in plain
      // language, and the turn continues to normal completion instead of
      // parking in WAITING_FOR_APPROVAL forever. The registry entry lets the
      // post-stream reconciler stamp the terminal SKIPPED row + provenance.
      if (config.unattended) {
        config.unattendedSkips?.add(toolCall.id);
        return new ToolMessage({
          content: unattendedSkipMessage(toolName),
          tool_call_id: toolCall.id,
          name: toolName,
        });
      }

      const approvalRequest = {
        tool_call_id: toolCall.id,
        tool_name: toolName,
        mcp_server_slug: serverSlug,
        message: requirement.message,
        // Carry the gate's provenance verdict through the interrupt so the
        // reinvocation that seeds the WAITING_APPROVAL tool call (index.ts) can
        // persist ToolCall.approval_policy_source without re-deriving it.
        policy_source: requirement.source,
      };

      const response = interrupt(approvalRequest) as ApprovalDecision;

      const action = (
        typeof response === "object" && response !== null
          ? (response.action ?? "")
          : ""
      ).toString().toLowerCase();

      if (action === "approve") {
        // Backing authorization: the user approved THIS interrupted call.
        emitExecutionReceipt(config, toolCall, serverSlug, category, "approval", requirement.source);
        return await handler(request);
      }

      if (action === "skip") {
        const comment = response.comment ?? "";
        const skipMessage = comment
          ? `Tool '${toolName}' was skipped by user: ${comment}. Please proceed without this operation.`
          : `Tool '${toolName}' was skipped by user. Please proceed without this operation.`;

        return new ToolMessage({
          content: skipMessage,
          tool_call_id: toolCall.id,
          name: toolName,
        });
      }

      if (action === "reject") {
        // REJECT denies THIS tool call and continues the run (it does not
        // terminate the execution — see APPROVAL_ACTION_REJECT in enum.proto).
        // Feed the user's objection back so the model adapts rather than
        // retrying. Distinct from SKIP only by the strength of the signal.
        const comment = response.comment ?? "";
        const rejectMessage = comment
          ? `Tool '${toolName}' was rejected by the user: ${comment}. Do not retry it; proceed by taking their objection into account.`
          : `Tool '${toolName}' was rejected by the user. Do not retry it; proceed by taking their objection into account.`;
        return new ToolMessage({
          content: rejectMessage,
          tool_call_id: toolCall.id,
          name: toolName,
        });
      }

      return new ToolMessage({
        content: `Tool '${toolName}' approval returned unknown action: '${action}'. Treating as skip.`,
        tool_call_id: toolCall.id,
        name: toolName,
      });
    },
  };
}

interface ApprovalRequirement {
  readonly requiresApproval: boolean;
  readonly message: string;
  /** Which policy layer determined this verdict — stamped on the shadow receipt. */
  readonly source: PolicySource;
}

function resolveToolApproval(
  toolName: string,
  serverSlug: string,
  args: Record<string, unknown>,
  policies: ReadonlyMap<string, MergedToolPolicy>,
  leasedCategories: ReadonlySet<ToolApprovalCategory>,
): ApprovalRequirement {
  if (serverSlug) {
    // MCP tools stay governed by the connect-flow classifier + four-level policy
    // chain. The policy map carries only the tools that REQUIRE approval, so an
    // absent entry means the classifier already auto-approved it — fail-OPEN is
    // correct here (a fail-closed default would re-gate everything the classifier
    // cleared). This is deliberately NOT changed by the built-in fail-closed flip.
    //
    // A server-scoped lease surfaces here as an absent entry too: the leased
    // server's tools are dropped from `policies` upstream (mergeApprovalPolicies),
    // so a lease-cleared MCP tool takes this same auto-approve path. (Its shadow
    // receipt therefore reads classifier_default rather than approval_lease; a
    // faithful per-server lease provenance would need the lease set threaded here
    // and is deferred with the rest of the persisted-receipt work.)
    const key = `${serverSlug}/${toolName}`;
    const policy = policies.get(key);
    if (policy) {
      return {
        requiresApproval: policy.requiresApproval,
        message: resolveApprovalMessage(policy.approvalMessage, toolName, args),
        source: policy.source,
      };
    }
    // Absent = cleared by the MCP four-level chain (classifier base) or by a
    // server-scoped lease (dropped upstream).
    return { requiresApproval: false, message: "", source: "classifier_default" };
  }

  // Built-in/platform tool: gate exactly the mutating categories via the shared
  // classifier. Fail-CLOSED for the mutating set — any built-in classifyTool
  // deems write/edit/delete/shell requires approval. Read-only and unclassified
  // built-ins are not mutating, so they remain fail-open.
  const category = toolApprovalCategory(toolName);
  if (category) {
    // Run-lifetime category lease: the user chose "approve all <category>"
    // earlier in this run, so every built-in of that category is auto-approved
    // for the rest of the run (the scoped successor to auto-approve-all).
    if (leasedCategories.has(category)) {
      return { requiresApproval: false, message: "", source: "approval_lease" };
    }
    return {
      requiresApproval: true,
      message: resolveApprovalMessage(CATEGORY_APPROVAL_MESSAGE[category], toolName, args),
      source: "builtin_category",
    };
  }

  return { requiresApproval: false, message: "", source: "builtin_category" };
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
  policySource: PolicySource,
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
      policySource,
      policyEngineVersion: POLICY_ENGINE_VERSION,
      fingerprint,
      substrate: "deep-agent",
    }),
  );
}
