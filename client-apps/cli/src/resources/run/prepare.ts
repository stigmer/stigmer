// The agent-execution prelude: validate flags and resolve every input the
// create step needs. Ports the Go CLI's prepareAgentExec (run_agent_exec.go).
//
// Order matters and mirrors Go: validate cheap flags first (mode, approve
// default), then parse workspaces, then merge env, then process attachments
// (the only step that hits the network). A failure short-circuits before any
// upload. STIGMER_ORG_ID is injected into the runtime env when absent so agents
// can address the caller's org without the user wiring it manually.

import type { Attachment } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../../errors/index.js";
import { type ProgressSink, processAttachments } from "./attachments.js";
import { loadAndMergeEnv, type RuntimeEnv } from "./env.js";
import { localWorkspaceRoots, parseWorkspaceEntries } from "./workspace.js";

/** The interaction mode requested for the run; "" means the agent default. */
export type RunMode = "" | "agent" | "plan";

/**
 * The `--service-tier` flag's value space (#357). Empty means unset —
 * distinct from an explicit "standard" so the ledger keeps the
 * unspecified-vs-explicit distinction.
 */
export type ServiceTierFlag = "" | "standard" | "fast";

/**
 * The `--thinking` flag's value space (#772), the tier's twin: empty means
 * unset — distinct from an explicit "disabled" for the same ledger reason.
 */
export type ThinkingFlag = "" | "disabled" | "enabled";

/**
 * The `--harness` flag's value space (oss#293): empty means unset — the
 * account preference may fill it (see {@link prepareAgentExec}), and when
 * nothing resolves the server defaults the session to native. Deliberately
 * only the two shipped engines, mirroring the proto validation on
 * `IdentityAccountPreferences.default_harness`.
 */
export type HarnessFlag = "" | "native" | "cursor";

/** Raw agent-execution flags shared by `run` and `draft` (Go's agentExecFlags). */
export interface AgentExecFlags {
  readonly message: string;
  readonly attach: readonly string[];
  readonly approveDefault: string;
  readonly verbose: boolean;
  readonly detach: boolean;
  readonly workspace: readonly string[];
  readonly branch: string;
  readonly commit: string;
  readonly env: readonly string[];
  readonly envFile: readonly string[];
  readonly secret: readonly string[];
  readonly secretFile: readonly string[];
  readonly model: string;
  readonly autoApprove: boolean;
  readonly mode: RunMode;
  readonly serviceTier: ServiceTierFlag;
  readonly thinking: ThinkingFlag;
  readonly harness: HarnessFlag;
}

/**
 * The validated, resolved inputs ready for create + stream. Mirrors Go's
 * preparedAgentExec, minus the client/org which the command already owns.
 */
export interface PreparedRun {
  readonly defaultAction: ApprovalAction;
  readonly workspaceEntries: WorkspaceEntry[];
  readonly runtimeEnv: RuntimeEnv;
  readonly attachments: Attachment[];
  readonly workspaceFileRefs: string[];
  readonly message: string;
  readonly detach: boolean;
  readonly verbose: boolean;
  readonly model: string;
  readonly autoApproveAll: boolean;
  readonly mode: RunMode;
  readonly serviceTier: ServiceTierFlag;
  readonly thinking: ThinkingFlag;
  /**
   * The RESOLVED harness for the new session: the explicit flag, else the
   * account preference (when the caller opted in), else "" — which stays off
   * the wire so the server default (native) applies. Also drives the header's
   * visibility row: a cursor session is never entered silently.
   */
  readonly harness: HarnessFlag;
}

/** Optional behavior switches for {@link prepareAgentExec}. */
export interface PrepareAgentExecOptions {
  /**
   * When `true` (the caller's backend is Stigmer Cloud) and `--model` is
   * omitted, the model is filled from the caller's account preference
   * (`IdentityAccountPreferences.default_*_model` for the resolved harness)
   * via `whoAmI()`. Local mode has no IdentityAccount, so callers pass
   * `false` there and the omitted model keeps resolving to the platform
   * default.
   */
  readonly cloudBackend?: boolean;
  /**
   * When `true` and `--harness` is omitted, the harness is filled from the
   * caller's account preference (`IdentityAccountPreferences.default_harness`)
   * on cloud. `run` opts in; `draft` deliberately does not: draft executes the
   * seedpack's system creator agents (a utility flow, not the user's own
   * conversation), which are built and exercised on the native harness —
   * silently rerouting them onto the cursor engine (different toolset,
   * premium billing tier) would fail the least-surprise test. An explicit
   * `--harness` on draft still wins; only the silent preference fill is
   * scoped out. Owner-ratified (D5, 2026-08-23).
   */
  readonly applyAccountHarnessDefault?: boolean;
}

/**
 * Validate flags and resolve all execution inputs. The `org` is used to inject
 * STIGMER_ORG_ID and the `client` to upload non-workspace attachments.
 */
export async function prepareAgentExec(
  flags: AgentExecFlags,
  client: Stigmer,
  org: string,
  progress?: ProgressSink,
  options?: PrepareAgentExecOptions,
): Promise<PreparedRun> {
  const defaultAction = parseApprovalAction(flags.approveDefault);
  validateMode(flags.mode);
  validateServiceTier(flags.serviceTier);
  validateThinking(flags.thinking);
  validateHarness(flags.harness);

  // Layered seeds (oss#293, DD-003): explicit flag > account preference
  // (cloud only) > platform default. Harness resolves first because the model
  // fill is harness-aware: a cursor session fills from default_cursor_model,
  // everything else from default_native_model. `run` and `draft` always
  // create a NEW session (threading lives in `resume`, which does not pass
  // through here), so neither fill can ever contradict an existing session's
  // immutable harness. One whoAmI round trip serves both fills, and it is
  // skipped entirely when explicit flags leave nothing to fill.
  const wantsHarnessFill = flags.harness === "" && options?.applyAccountHarnessDefault === true;
  const wantsModelFill = flags.model === "";
  const accountDefaults =
    options?.cloudBackend === true && (wantsHarnessFill || wantsModelFill)
      ? await resolveAccountExecutionDefaults(client)
      : NO_ACCOUNT_DEFAULTS;
  const harness = flags.harness !== "" ? flags.harness : wantsHarnessFill ? accountDefaults.harness : "";
  const model = wantsModelFill
    ? harness === "cursor"
      ? accountDefaults.cursorModel
      : accountDefaults.nativeModel
    : flags.model;

  const workspaceEntries = parseWorkspaceEntries(flags.workspace, flags.branch, flags.commit);

  const runtimeEnv = loadAndMergeEnv({
    envFlags: flags.env,
    secretFlags: flags.secret,
    envFiles: flags.envFile,
    secretFiles: flags.secretFile,
  });
  if (runtimeEnv.STIGMER_ORG_ID === undefined && org !== "") {
    runtimeEnv.STIGMER_ORG_ID = { value: org, isSecret: false };
  }

  const { attachments, workspaceFileRefs } = await processAttachments(
    client.agentExecution,
    flags.attach,
    localWorkspaceRoots(workspaceEntries),
    progress,
  );

  return {
    defaultAction,
    workspaceEntries,
    runtimeEnv,
    attachments,
    workspaceFileRefs,
    message: flags.message,
    detach: flags.detach,
    verbose: flags.verbose,
    model,
    autoApproveAll: flags.autoApprove,
    mode: flags.mode,
    serviceTier: flags.serviceTier,
    thinking: flags.thinking,
    harness,
  };
}

/** The account's execution defaults, "" for anything undeclared. */
interface AccountExecutionDefaults {
  readonly harness: HarnessFlag;
  readonly nativeModel: string;
  readonly cursorModel: string;
}

const NO_ACCOUNT_DEFAULTS: AccountExecutionDefaults = { harness: "", nativeModel: "", cursorModel: "" };

/**
 * Best-effort read of the caller's execution defaults
 * (`IdentityAccountPreferences.default_harness` / `default_*_model`) in one
 * whoAmI round trip. Any failure — network, auth, a backend without
 * IdentityAccount — resolves to no defaults and the run proceeds exactly as
 * unfilled flags do today: a missing preference must never fail a run.
 *
 * The persisted harness value is allowlist-guarded to the shipped engines
 * (the same guard the web launcher's useAccountExecutionDefaults applies):
 * a client must not trust stored data it did not write, so anything outside
 * native/cursor is treated as undeclared rather than stamped on the wire.
 */
async function resolveAccountExecutionDefaults(client: Stigmer): Promise<AccountExecutionDefaults> {
  try {
    const account = await client.identityAccount.whoAmI();
    const prefs = account.spec?.preferences;
    const declared = prefs?.defaultHarness;
    return {
      harness: declared === "native" || declared === "cursor" ? declared : "",
      nativeModel: prefs?.defaultNativeModel ?? "",
      cursorModel: prefs?.defaultCursorModel ?? "",
    };
  } catch {
    return NO_ACCOUNT_DEFAULTS;
  }
}

/**
 * Parse the `--approve-default` flag to an ApprovalAction. Empty means "no
 * default" (UNSPECIFIED). Mirrors Go's approval.ParseAction, including the
 * approve-all aliases and case-insensitivity.
 */
export function parseApprovalAction(value: string): ApprovalAction {
  if (value.trim() === "") return ApprovalAction.UNSPECIFIED;
  switch (value.trim().toLowerCase()) {
    case "approve":
      return ApprovalAction.APPROVE;
    case "skip":
      return ApprovalAction.SKIP;
    case "reject":
      return ApprovalAction.REJECT;
    case "approve-all":
    case "approve_all":
    case "approveall":
      return ApprovalAction.APPROVE_ALL;
    default:
      throw new UsageError(
        `invalid --approve-default value "${value}": must be one of: approve, skip, reject, approve-all`,
      );
  }
}

/**
 * Validate the `--mode` flag. Empty (unset) is valid and means "use default"
 * (agent). Mirrors Go's validateMode.
 */
export function validateMode(mode: string): asserts mode is RunMode {
  if (mode !== "" && mode !== "agent" && mode !== "plan") {
    throw new UsageError(`invalid --mode value "${mode}": must be "agent" or "plan"`);
  }
}

/**
 * Validate the `--service-tier` flag. Empty means "platform default" (which
 * resolves to standard — never the provider account default, #357). The
 * server refuses fast on models without a registry fast variant; this check
 * only catches spelling errors before a network round trip.
 */
export function validateServiceTier(tier: string): asserts tier is ServiceTierFlag {
  if (tier !== "" && tier !== "standard" && tier !== "fast") {
    throw new UsageError(
      `invalid --service-tier value "${tier}": must be "standard" or "fast"`,
    );
  }
}

/**
 * Validate the `--thinking` flag, the tier check's twin (#772). Empty means
 * "platform default" (which resolves to disabled — never the provider
 * account default). The server refuses enabled on models without the
 * registry thinking capability; this check only catches spelling errors
 * before a network round trip.
 */
export function validateThinking(mode: string): asserts mode is ThinkingFlag {
  if (mode !== "" && mode !== "disabled" && mode !== "enabled") {
    throw new UsageError(
      `invalid --thinking value "${mode}": must be "disabled" or "enabled"`,
    );
  }
}

/**
 * Validate the `--harness` flag. Empty means "use default": the account
 * preference when the caller opted in, else the platform default (native).
 * Only the shipped engines are accepted — other harness names that appear in
 * UI metadata (copilot, codex, ...) have no proto mapping yet, so rejecting
 * them here is honest, and this check catches spelling errors before a
 * network round trip.
 */
export function validateHarness(harness: string): asserts harness is HarnessFlag {
  if (harness !== "" && harness !== "native" && harness !== "cursor") {
    throw new UsageError(
      `invalid --harness value "${harness}": must be "native" or "cursor"`,
    );
  }
}
