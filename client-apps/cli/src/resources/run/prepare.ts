// The run prelude: validate flags and resolve every input the
// create step needs. Ports the Go CLI's prepareAgentExec (run_agent_exec.go).
//
// Order matters and mirrors Go: validate cheap flags first (mode, approve
// default), then parse workspaces, then resolve the vaults, plugins and
// environment the conversation uses, then plan the attachments. Nothing is
// uploaded here: the attached files are read from disk and checked against
// the limits, and the create step uploads them once it knows the run's
// target (attachments.ts), so any failure here leaves nothing behind. A run
// carries no values of its own: its keys come from the vaults its
// conversation uses (vaults.ts), which is why a vault named by id is looked
// up here, before anything is uploaded.

import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { SessionResource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { Stigmer } from "@stigmer/client";
import { UsageError } from "../../errors/index.js";
import { parseApproveDefault, type ApproveDefault } from "../stream/answer.js";
import { type AttachmentPlan, type ProgressSink, planAttachments } from "./attachments.js";
import { resolveRunEnvironment } from "./environment.js";
import { resolveRunPlugins } from "./plugins.js";
import { resolveRunVaults } from "./vaults.js";
import { localWorkspaceRoots, parseWorkspaceResources } from "./workspace.js";

/** The interaction mode requested for the run; "" means the agent default. */
export type RunMode = "" | "agent" | "plan";

/**
 * The `--service-tier` flag's value space (#357). Empty means unset —
 * distinct from an explicit "standard" so the usage record keeps the
 * unspecified-vs-explicit distinction.
 */
export type ServiceTierFlag = "" | "standard" | "fast";

/**
 * The `--thinking` flag's value space (#772), the tier's twin: empty means
 * unset — distinct from an explicit "disabled" for the same usage-record reason.
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

/** Raw agent-execution flags as `run` parses them (Go's agentExecFlags). */
export interface AgentExecFlags {
  readonly message: string;
  readonly attach: readonly string[];
  /** The `--file-id` Files the message names, in the order given. */
  readonly fileIds: readonly string[];
  readonly approveDefault: string;
  readonly verbose: boolean;
  readonly detach: boolean;
  readonly workspace: readonly string[];
  readonly branch: string;
  readonly commit: string;
  /** The `--vault` references, in the order given. */
  readonly vault: readonly string[];
  /** False when `--no-my-vault` leaves the person's own My vault out. */
  readonly myVault: boolean;
  /** The `--plugin` references, in the order given. */
  readonly plugin: readonly string[];
  /** The `--environment` reference; "" when not given. */
  readonly environment: string;
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
  readonly approveDefault: ApproveDefault;
  /** The new conversation's repositories and folders from `--workspace`. */
  readonly resources: SessionResource[];
  /** The shared vaults the new conversation uses, in order. */
  readonly vaults: readonly ApiResourceReference[];
  /** Whether each turn uses its sender's own My vault first. */
  readonly includeMyVault: boolean;
  /** The plugins the new conversation uses, in order. */
  readonly plugins: readonly ApiResourceReference[];
  /** The Environment the new conversation names; undefined leaves its agent's or organization's default. */
  readonly environment?: ApiResourceReference;
  /** What `--attach` and `--file-id` resolved to, uploaded by the create step. */
  readonly attachments: AttachmentPlan;
  readonly message: string;
  readonly detach: boolean;
  readonly verbose: boolean;
  readonly model: string;
  readonly autoApproveAll: boolean;
  readonly mode: RunMode;
  readonly serviceTier: ServiceTierFlag;
  readonly thinking: ThinkingFlag;
  /**
   * The RESOLVED harness for the new session: the explicit flag; else ""
   * when `--model` names a model alone (the server reads it on native);
   * else the engine the agent names, else the account preference (when the
   * caller opted in), else "" — which stays off the wire so the server
   * default (native) applies. Also drives the header's
   * visibility row: a cursor session is never entered silently.
   */
  readonly harness: HarnessFlag;
}

/** Optional behavior switches for {@link prepareAgentExec}. */
export interface PrepareAgentExecOptions {
  /**
   * When `true`, an omitted `--harness` is filled from the caller's account
   * preference (`IdentityAccountPreferences.default_harness`) and an omitted
   * `--model` from `default_*_model` for the resolved harness, both via one
   * `whoAmI()`. The caller answers this from the connected server's edition
   * and the kind's tier —
   * `client.isResourceAvailable(ApiResourceKind.identity_account)` — never
   * from the config's backend type: a server that does not
   * serve identity accounts is not even asked, and the omitted values keep
   * resolving to the platform defaults.
   */
  readonly accountPreferencesAvailable?: boolean;
  /**
   * The spec of the agent the run starts (its current version, which a new
   * conversation pins); omitted for the built-in assistant. Its run
   * defaults come before the account's: an omitted `--harness` resolves to
   * the engine the agent names, and an omitted `--model` stays unset where
   * the agent names a model for the resolved engine, so the server applies
   * the agent's choice instead of the account's.
   */
  readonly agentSpec?: AgentSpec;
  /**
   * The organization the run is created in: a `--vault`, `--plugin` or `--environment` named
   * by slug alone is that organization's. Empty leaves the reference relative, which the
   * server resolves to the conversation's organization.
   */
  readonly org?: string;
}

/**
 * Validate flags and resolve all run inputs. The `client` looks up the
 * vaults, plugins, environment and account defaults; nothing is uploaded.
 */
export async function prepareAgentExec(
  flags: AgentExecFlags,
  client: Stigmer,
  progress?: ProgressSink,
  options?: PrepareAgentExecOptions,
): Promise<PreparedRun> {
  const approveDefault = parseApproveDefault(flags.approveDefault);
  validateMode(flags.mode);
  validateServiceTier(flags.serviceTier);
  validateThinking(flags.thinking);
  validateHarness(flags.harness);

  // Layered seeds (oss#293): explicit flag > the agent's run defaults >
  // account preference (where the server serves identity accounts) >
  // platform default. Harness resolves first because the model
  // fill is harness-aware: a cursor session fills from default_cursor_model,
  // everything else from default_native_model. `run` always creates a NEW
  // session (threading lives in `resume`, which does not pass through
  // here), so neither fill can ever contradict an existing session's
  // immutable harness. One whoAmI round trip serves both fills, and it is
  // skipped entirely when explicit flags leave nothing to fill.
  const agentHarness = harnessFlagOf(options?.agentSpec?.harness);
  // The agent's model applies on the engine it names, and only when the run
  // takes that engine (an explicit --harness may leave it).
  const agentModelApplies =
    agentHarness !== "" &&
    (flags.harness === "" || flags.harness === agentHarness) &&
    (options?.agentSpec?.runConfig?.modelName ?? "") !== "";
  // A --model with no --harness names no engine: the server starts the
  // conversation on native, the engine a model named alone is read on, so
  // neither the agent's engine nor the account's is filled in under it.
  const modelNamesEngine = flags.model !== "" && flags.harness === "";
  const wantsHarnessFill =
    flags.harness === "" && agentHarness === "" && !modelNamesEngine;
  const wantsModelFill = flags.model === "" && !agentModelApplies;
  const accountDefaults =
    options?.accountPreferencesAvailable === true &&
    (wantsHarnessFill || wantsModelFill)
      ? await resolveAccountExecutionDefaults(client)
      : NO_ACCOUNT_DEFAULTS;
  const harness =
    flags.harness !== ""
      ? flags.harness
      : modelNamesEngine
        ? ""
        : agentHarness !== ""
          ? agentHarness
          : accountDefaults.harness;
  const model = wantsModelFill
    ? harness === "cursor"
      ? accountDefaults.cursorModel
      : accountDefaults.nativeModel
    : flags.model;

  const resources = parseWorkspaceResources(
    flags.workspace,
    flags.branch,
    flags.commit,
  );

  const vaults = await resolveRunVaults(client, flags.vault, options?.org ?? "");
  const plugins = await resolveRunPlugins(client, flags.plugin, options?.org ?? "");
  const environment = await resolveRunEnvironment(client, flags.environment, options?.org ?? "");

  const attachments = planAttachments(flags.attach, localWorkspaceRoots(resources), progress, flags.fileIds);

  return {
    approveDefault,
    resources,
    vaults,
    includeMyVault: flags.myVault,
    plugins,
    ...(environment === undefined ? {} : { environment }),
    attachments,
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

/** The engine an agent names as a flag value, "" when it names none. */
function harnessFlagOf(harness: Harness | undefined): HarnessFlag {
  switch (harness) {
    case Harness.NATIVE:
      return "native";
    case Harness.CURSOR:
      return "cursor";
    default:
      return "";
  }
}

/** The account's execution defaults, "" for anything undeclared. */
interface AccountExecutionDefaults {
  readonly harness: HarnessFlag;
  readonly nativeModel: string;
  readonly cursorModel: string;
}

const NO_ACCOUNT_DEFAULTS: AccountExecutionDefaults = {
  harness: "",
  nativeModel: "",
  cursorModel: "",
};

/**
 * Best-effort read of the caller's execution defaults
 * (`IdentityAccountPreferences.default_harness` / `default_*_model`) in one
 * whoAmI round trip. Any failure — network, auth, a backend without
 * IdentityAccount — resolves to no defaults and the run proceeds exactly as
 * unfilled flags do today: a missing preference must never fail a run.
 *
 * This reads `whoAmI` directly and never the SDK's ensureMyIdentityAccount:
 * a run must not create an account as a side effect, so NOT_FOUND here means
 * "no preferences yet". Provisioning belongs to `auth login` and `auth
 * whoami`, the commands whose purpose is the caller's identity.
 *
 * The persisted harness value is allowlist-guarded to the shipped engines
 * (the same guard the web launcher's useAccountExecutionDefaults applies):
 * a client must not trust stored data it did not write, so anything outside
 * native/cursor is treated as undeclared rather than stamped on the wire.
 */
async function resolveAccountExecutionDefaults(
  client: Stigmer,
): Promise<AccountExecutionDefaults> {
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
 * Validate the `--mode` flag. Empty (unset) is valid and means "use default"
 * (agent). Mirrors Go's validateMode.
 */
export function validateMode(mode: string): asserts mode is RunMode {
  if (mode !== "" && mode !== "agent" && mode !== "plan") {
    throw new UsageError(
      `invalid --mode value "${mode}": must be "agent" or "plan"`,
    );
  }
}

/**
 * Validate the `--service-tier` flag. Empty means "platform default" (which
 * resolves to standard — never the provider account default, #357). The
 * server refuses fast on models without a registry fast variant; this check
 * only catches spelling errors before a network round trip.
 */
export function validateServiceTier(
  tier: string,
): asserts tier is ServiceTierFlag {
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
export function validateHarness(
  harness: string,
): asserts harness is HarnessFlag {
  if (harness !== "" && harness !== "native" && harness !== "cursor") {
    throw new UsageError(
      `invalid --harness value "${harness}": must be "native" or "cursor"`,
    );
  }
}
