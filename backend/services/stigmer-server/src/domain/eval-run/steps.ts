/**
 * Eval run domain steps: who may start an eval run, the subject and the
 * versions it runs, the plugins its tries load and whose cases run, the
 * limits it is held to, the workflow create starts, and the cancel and
 * delete that follow.
 *
 * The create chain asks its question before it reads anything, in the
 * evaluator's anti-probing order (domain/evaluator/steps.ts): can_edit on
 * the subject named by the spec's subject oneof, then the subject is read,
 * so a caller who cannot edit it learns nothing about whether it exists.
 * The subject decides three steps:
 *
 *   - on an agent, the version (a hash or a tag; empty and "latest" are
 *     the current version) is resolved through the agent's version ladder
 *     and stamped as its hash; each plugin that version attaches is
 *     resolved as a turn resolves it (domain/plugin/versions.ts
 *     loadPluginByReference: the reference's version when it names one,
 *     else the version installed now); a compared plugin the agent does not
 *     attach is read at its current version, after can_view on it, since
 *     every try reads it; every one of them is stamped on the status, in
 *     the agent's order, the compared one last when unattached, whether its
 *     cases run or not: every try lists every one of them, pinned, so the
 *     agent runs as it would in a conversation, at fixed versions (arm.ts);
 *   - on a plugin, its current version only (the with arm runs the plugin
 *     as installed now), stamped as the status's one plugin, compared;
 *   - whose cases run: the case sources the spec names (each a plugin a
 *     try loads), else the compared plugin's, else every attached
 *     plugin's; the matrix plans two arms exactly when a plugin is compared
 *     and the ablation is not none.
 *
 * Status has one writer once create returns: the eval run's workflow
 * (temporal/evals/). Create writes the pending row; a start that fails
 * marks it failed, and a cancel that finds no workflow marks it partial
 * "cancelled". Both of those writes go through the store's atomic
 * read-modify-write and never overwrite what the workflow wrote: a failed
 * start changes the row only while it is still pending (a start that
 * timed out after the workflow began finds it running, and leaves it to
 * the workflow), a cancel only while it is pending or running.
 *
 * Proven by __tests__/steps.test.ts (each step's arms) and
 * __tests__/eval-run.test.ts (the composed lanes).
 */
import { ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampMs, timestampNow } from "@bufbuild/protobuf/wkt";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import type {
  EvalRunIdSchema,
  ListEvalRunsByAgentRequestSchema,
  ListEvalRunsByPluginRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/io_pb";
import { EvalRunListSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/io_pb";
import type { EvalRunSpec } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import {
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunPluginSchema,
  EvalRunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import type { EvalRunStatus } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import { isServerComposedRequest } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import { harnessName, unknownModelPinRefusal } from "../../modelcatalog/pin-validation.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  permissionDeniedError,
  unavailableError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import type { AuthorizationTarget } from "../../pipeline/steps/authorize.js";
import { evaluateAuthorizer } from "../../pipeline/steps/authorize.js";
import { assignServerId, generateId } from "../../pipeline/steps/defaults.js";
import { matchesAllLabels, sortedLabels } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { decodeOrSkip, listPageFingerprint, readListPage } from "../../pipeline/steps/list-page.js";
import { releaseNamesOfDeleted } from "../../pipeline/steps/names.js";
import { loadVersion, resolveVersionHash } from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { agentVersionBinding } from "../agent/versions.js";
import { loadPluginByReference } from "../plugin/versions.js";
import { checkAllowTools } from "./allow-tools.js";
import {
  EVAL_RUN_AGENT_DENIED_MESSAGE,
  EVAL_RUN_COMPARED_DENIED_MESSAGE,
  EVAL_RUN_MAX_CASES,
  EVAL_RUN_MAX_TRIES,
  EVAL_RUN_NO_CASE_SOURCES_MESSAGE,
  EVAL_RUN_NO_CASES_MESSAGE,
  EVAL_RUN_NO_ENGINE_MESSAGE,
  EVAL_RUN_NO_MATCHING_CASES_MESSAGE,
  EVAL_RUN_NO_SUBJECT_MESSAGE,
  EVAL_RUN_NOT_STARTED_ERROR,
  EVAL_RUN_PLUGIN_DENIED_MESSAGE,
  EVAL_RUN_REAL_SERVERS_CONFLICT_MESSAGE,
  EVAL_RUN_WORKFLOW_ENDED_ERROR,
  PLUGIN_NO_CASES_REASON,
  PLUGIN_NOT_SELECTED_REASON,
  evalRunActiveDeleteMessage,
  evalRunCaseGlobMessage,
  evalRunNoCasesMessage,
  evalRunNotCurrentVersionMessage,
  evalRunOrgMismatchMessage,
  evalRunOtherPluginToolMessage,
  evalRunTooLargeMessage,
  evalRunUnknownServerToolMessage,
  evalRunUnloadedCaseSourceMessage,
} from "./constants.js";
import { evalRunListIndex } from "./list-index.js";
import { caseGlobError, evalModelCatalogOf, matrixSpecOf, sizeOfMatrix } from "./matrix.js";
import { subjectOf } from "./subject.js";
import type { EvalRunSubject } from "./subject.js";
import type { EvalSuiteSource } from "./suite.js";
import { loadEvalSuite, pluginVersionedBinding } from "./suite.js";
import { agentTargetOf } from "./target.js";
import { deleteEvalRunTries } from "./tries.js";
import type { TrySessionDeleter } from "./tries.js";
import { EVAL_RUN_EXECUTION_TIMEOUT_MS, EvalRunEngineUnavailableError } from "./workflows.js";
import type { EvalRunWorkflows } from "./workflows.js";
import { writtenServerNames } from "./written-servers.js";

/** Context key for the subject a create reads, stashed by LoadEvalRunSubject. */
export const EVAL_RUN_SUBJECT_KEY = "evalRunSubject";

/** Context key for what a create's tries load, stashed by ResolveEvalRunDefaults. */
export const EVAL_RUN_LOAD_KEY = "evalRunLoad";

/** Context key for cancel's and the lists' answers. */
export const EVAL_RUN_RESULT_KEY = "evalRunResult";

/** The subject a create read: the agent's or the plugin's row. */
export type LoadedSubject =
  | { readonly kind: "agent"; readonly org: string; readonly row: Agent }
  | { readonly kind: "plugin"; readonly org: string; readonly row: Plugin };

/** One plugin a create's tries load, as stamped on the status. */
export interface LoadedPlugin {
  readonly plugin: Plugin;
  readonly digest: string;
  readonly attached: boolean;
  readonly compared: boolean;
}

/** What a create's tries load (the module header). */
export interface EvaluatedLoad {
  /** The agent version's spec; undefined on an eval run of a plugin. */
  readonly agentSpec: AgentSpec | undefined;
  /** Every plugin a try loads, in status order. */
  readonly plugins: ReadonlyArray<LoadedPlugin>;
  /** The ids of the plugins whose cases run. */
  readonly selected: ReadonlySet<string>;
}

/** An eval run row as the phase rules read it. */
export interface EvalPhaseRow {
  readonly status?: {
    readonly phase: EvalRunPhase;
    readonly startedAt?: EvalRunStatus["startedAt"];
    readonly audit?: EvalRunStatus["audit"];
  };
}

/** Whether an eval run may still start tries: pending or running. */
export function isActiveEvalRun(evalRun: EvalPhaseRow): boolean {
  const phase = evalRun.status?.phase ?? EvalRunPhase.unspecified;
  return phase === EvalRunPhase.pending || phase === EvalRunPhase.running;
}

/**
 * How long past its workflow's execution timeout an eval run may still
 * show running: the workflow starts just after the row is written, and may
 * be writing its end at the timeout itself.
 */
const WORKFLOW_ENDED_MARGIN_MS = 60 * 60 * 1000;

/**
 * Whether a pending or running eval run's workflow has necessarily closed
 * without writing its end: the workflow starts at create, and its
 * execution timeout (workflows.ts EVAL_RUN_EXECUTION_TIMEOUT_MS), with a
 * margin, has passed since the row was created (or, with no creation
 * stamp, since it started running). Answered from the row alone, so a
 * read needs no engine.
 */
export function evalRunOutlivedItsWorkflow(evalRun: EvalPhaseRow, nowMs: number): boolean {
  if (!isActiveEvalRun(evalRun)) {
    return false;
  }
  const since = evalRun.status?.audit?.specAudit?.createdAt ?? evalRun.status?.startedAt;
  if (since === undefined) {
    return false;
  }
  return timestampMs(since) + EVAL_RUN_EXECUTION_TIMEOUT_MS + WORKFLOW_ENDED_MARGIN_MS < nowMs;
}

/**
 * The eval run as it should be answered: one that outlived its workflow is
 * stored failed, "the eval run's workflow ended without finishing",
 * through the atomic write that changes only a pending or running row, so
 * a get never shows it running for ever. Any other eval run, or a row gone
 * or a store fault meanwhile, is answered as read.
 */
export async function settleEndedEvalRun(store: Store, evalRun: EvalRun): Promise<EvalRun> {
  if (!evalRunOutlivedItsWorkflow(evalRun, Date.now())) {
    return evalRun;
  }
  try {
    return await settleUnlessFinished(store, evalRun.metadata?.id ?? "", failWorkflowEnded);
  } catch {
    return evalRun;
  }
}

/** Marks a status failed because its workflow ended without finishing. */
function failWorkflowEnded(status: EvalRunStatus): void {
  status.phase = EvalRunPhase.failed;
  status.error = EVAL_RUN_WORKFLOW_ENDED_ERROR;
  status.finishedAt = timestampNow();
}

/** SettleEndedEvalRun: get's answer, after the target is loaded (settleEndedEvalRun). */
export function newSettleEndedEvalRunStep(store: Store): PipelineStep<typeof EvalRunIdSchema> {
  return {
    name: "SettleEndedEvalRun",
    async execute(ctx: RequestContext<typeof EvalRunIdSchema>): Promise<void> {
      const target = ctx.get(TARGET_RESOURCE_KEY) as EvalRun | undefined;
      if (target !== undefined) {
        ctx.set(TARGET_RESOURCE_KEY, await settleEndedEvalRun(store, target));
      }
    },
  };
}

/**
 * The create lane's authorization question, for AuthorizeResolvedTarget
 * BEFORE the subject is read: can_edit on the agent or the plugin the
 * spec's subject names. The RPC is is_skip_authorization because the
 * target is the subject, not the request's own id (command.proto). A
 * server-composed request asks nothing: the entry-point request already
 * passed. The proto's rules refuse a request naming no subject before this
 * runs; one that still names none here is refused all the same.
 */
export function resolveEvalRunCreateTargets(
  ctx: RequestContext<typeof EvalRunSchema>,
): ReadonlyArray<AuthorizationTarget> {
  const subject = subjectOf(ctx.newState.spec);
  if (subject === undefined) {
    throw invalidArgumentError(EVAL_RUN_NO_SUBJECT_MESSAGE);
  }
  if (isServerComposedRequest(ctx.callerIdentity)) {
    return [];
  }
  return [
    subject.kind === "agent"
      ? {
          permission: IamPermission.can_edit,
          resourceKind: ApiResourceKind.agent,
          resourceId: subject.id,
          deniedMessage: EVAL_RUN_AGENT_DENIED_MESSAGE,
        }
      : {
          permission: IamPermission.can_edit,
          resourceKind: ApiResourceKind.plugin,
          resourceId: subject.id,
          deniedMessage: EVAL_RUN_PLUGIN_DENIED_MESSAGE,
        },
  ];
}

/** The create's subject, from the spec; refused when it names none. */
function requiredSubject(spec: EvalRunSpec | undefined): EvalRunSubject {
  const subject = subjectOf(spec);
  if (subject === undefined) {
    throw invalidArgumentError(EVAL_RUN_NO_SUBJECT_MESSAGE);
  }
  return subject;
}

/** LoadEvalRunSubject: reads the agent or the plugin the spec names into EVAL_RUN_SUBJECT_KEY. */
export function newLoadEvalRunSubjectStep(store: Store): PipelineStep<typeof EvalRunSchema> {
  return {
    name: "LoadEvalRunSubject",
    async execute(ctx: RequestContext<typeof EvalRunSchema>): Promise<void> {
      const subject = requiredSubject(ctx.newState.spec);
      ctx.set(EVAL_RUN_SUBJECT_KEY, await readSubject(store, subject));
    },
  };
}

/** The subject's row, NOT_FOUND naming it when it is gone. */
async function readSubject(store: Store, subject: EvalRunSubject): Promise<LoadedSubject> {
  try {
    if (subject.kind === "agent") {
      const row = await store.getResource(ApiResourceKind.agent, subject.id, AgentSchema);
      return { kind: "agent", org: row.metadata?.org ?? "", row };
    }
    const row = await store.getResource(ApiResourceKind.plugin, subject.id, PluginSchema);
    return { kind: "plugin", org: row.metadata?.org ?? "", row };
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError(subject.kind === "agent" ? "Agent" : "Plugin", subject.id);
    }
    throw internalError(error, `failed to load the ${subject.kind} to evaluate`);
  }
}

function stashed<T>(ctx: RequestContext<typeof EvalRunSchema>, key: string, what: string): T {
  const value = ctx.get(key) as T | undefined;
  if (value === undefined) {
    throw internalError(new Error(`${what} not found in context`), `${what} not found in context`);
  }
  return value;
}

/**
 * ResolveEvalRunDefaults: metadata.org is required and must be the
 * subject's organization (the request names it so the
 * deleting-organization interceptor covers the lane, and the subject's
 * organization is the one that pays); allow_real_servers with
 * real_mcp_servers is refused, as the format pairs --allow-real-servers
 * with --mocks record, never off. Then, by subject (the module header):
 * the plugin's current digest stamped (any other refused), or the agent's
 * version stamped, its plugins resolved, a compared plugin added (after
 * can_view on it when the agent does not attach it), and each case source
 * matched to a plugin a try loads. allow_tools is held to the servers a
 * try loads: every loaded plugin's, and on an agent the ones it and its
 * subagents write (writtenServerNames). The id is minted here.
 */
export function newResolveEvalRunDefaultsStep(
  store: Store,
  authorizer: Authorizer,
): PipelineStep<typeof EvalRunSchema> {
  return {
    name: "ResolveEvalRunDefaults",
    async execute(ctx: RequestContext<typeof EvalRunSchema>): Promise<void> {
      const metadata = ctx.newState.metadata;
      if (metadata === undefined || metadata.org === "") {
        throw invalidArgumentError("metadata.org is required for an eval run");
      }
      const subject = stashed<LoadedSubject>(ctx, EVAL_RUN_SUBJECT_KEY, "eval run subject");
      if (metadata.org !== subject.org) {
        throw failedPreconditionError(evalRunOrgMismatchMessage(subject.kind, subject.org));
      }
      const spec = ctx.newState.spec;
      if (spec === undefined) {
        throw invalidArgumentError("spec is required for an eval run");
      }
      if (spec.allowRealServers && spec.realMcpServers) {
        throw invalidArgumentError(EVAL_RUN_REAL_SERVERS_CONFLICT_MESSAGE);
      }
      const load =
        subject.kind === "plugin"
          ? await resolvePluginSubject(store, subject.row, spec)
          : await resolveAgentSubject(store, authorizer, ctx, subject.row, spec);
      const written = load.agentSpec === undefined ? undefined : await writtenServerNames(store, load.agentSpec, subject.org);
      const allowed = checkAllowTools(
        spec.allowTools,
        load.plugins.map(({ plugin }) => ({
          name: plugin.metadata?.name ?? "",
          servers: (plugin.status?.mcpServers ?? []).map((server) => server.name),
        })),
        written,
      );
      if (!allowed.ok) {
        throw invalidArgumentError(
          allowed.names === "plugin"
            ? evalRunOtherPluginToolMessage(allowed.entry, allowed.server)
            : evalRunUnknownServerToolMessage(allowed.entry, allowed.server),
        );
      }
      spec.allowTools = [...allowed.tools];
      ctx.set(EVAL_RUN_LOAD_KEY, load);
      assignServerId(ctx, generateId("evr"));
      if (metadata.name === "" && metadata.slug === "") {
        metadata.name = metadata.id;
      }
    },
  };
}

/** A plugin subject: its current version only, stamped; the one plugin a try loads, compared and selected. */
async function resolvePluginSubject(store: Store, plugin: Plugin, spec: EvalRunSpec): Promise<EvaluatedLoad> {
  const current = pluginVersionedBinding.headHashOf(plugin);
  if (current === "") {
    throw failedPreconditionError(evalRunNoCasesMessage("evals"));
  }
  const digest = await resolveVersionHash(store, pluginVersionedBinding, plugin, spec.pluginDigest);
  if (digest !== current) {
    throw failedPreconditionError(evalRunNotCurrentVersionMessage(current));
  }
  spec.pluginDigest = digest;
  const id = plugin.metadata?.id ?? "";
  return {
    agentSpec: undefined,
    plugins: [{ plugin, digest, attached: false, compared: true }],
    selected: new Set([id]),
  };
}

/**
 * An agent subject: the version stamped as its hash (NOT_FOUND naming a
 * version the agent does not hold); each attached plugin resolved at the
 * version a turn would run (NOT_FOUND for one gone); the compared plugin,
 * when the agent does not attach it, read at its current version after
 * can_view on it; then whose cases run. An agent with nothing whose cases
 * could run is refused.
 */
async function resolveAgentSubject(
  store: Store,
  authorizer: Authorizer,
  ctx: RequestContext<typeof EvalRunSchema>,
  agent: Agent,
  spec: EvalRunSpec,
): Promise<EvaluatedLoad> {
  const agentId = agent.metadata?.id ?? "";
  const agentOrg = agent.metadata?.org ?? "";
  const hash = await resolveVersionHash(store, agentVersionBinding, agent, spec.agentVersion);
  if (hash === undefined) {
    throw notFoundError("agent version", spec.agentVersion);
  }
  const version = await loadVersion(store, agentVersionBinding, agentId, hash);
  const agentSpec = version.resource.spec;
  const plugins: LoadedPlugin[] = [];
  for (const ref of agentSpec?.plugins ?? []) {
    const plugin = await loadPluginByReference(store, ref, agentOrg);
    plugins.push({
      plugin,
      digest: plugin.status?.digest ?? "",
      attached: true,
      compared: plugin.metadata?.id === spec.comparedPluginId,
    });
  }
  if (spec.comparedPluginId !== "" && !plugins.some((entry) => entry.compared)) {
    const compared = await readComparedPlugin(store, authorizer, ctx, spec.comparedPluginId);
    plugins.push({ plugin: compared, digest: compared.status?.digest ?? "", attached: false, compared: true });
  }
  if (plugins.length === 0) {
    throw failedPreconditionError(EVAL_RUN_NO_CASE_SOURCES_MESSAGE);
  }
  spec.agentVersion = hash;
  return { agentSpec, plugins, selected: selectedSources(spec, plugins, agentOrg) };
}

/**
 * A compared plugin the agent does not attach: can_view on it first (every
 * try reads it, and its viewers are not the agent's), then its row at the
 * version installed now. A server-composed request asks nothing.
 */
async function readComparedPlugin(
  store: Store,
  authorizer: Authorizer,
  ctx: RequestContext<typeof EvalRunSchema>,
  pluginId: string,
): Promise<Plugin> {
  if (!isServerComposedRequest(ctx.callerIdentity)) {
    const decision = await evaluateAuthorizer(authorizer, ctx.callerIdentity, {
      permission: IamPermission.can_view,
      resourceKind: ApiResourceKind.plugin,
      resourceId: pluginId,
    });
    if (decision.kind === "unavailable") {
      throw internalError(decision.cause, "failed to authorize the compared plugin");
    }
    if (decision.kind !== "allow") {
      throw permissionDeniedError(EVAL_RUN_COMPARED_DENIED_MESSAGE);
    }
  }
  try {
    return await store.getResource(ApiResourceKind.plugin, pluginId, PluginSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("Plugin", pluginId);
    }
    throw internalError(error, "failed to load the compared plugin");
  }
}

/**
 * The plugins whose cases run (the module header): each case source the
 * spec names, matched to a plugin a try loads by id, else by organization
 * and slug (INVALID_ARGUMENT naming one the try would not load); with none
 * named, the compared plugin, else every attached plugin.
 */
function selectedSources(spec: EvalRunSpec, plugins: ReadonlyArray<LoadedPlugin>, agentOrg: string): Set<string> {
  if (spec.cases.length === 0) {
    const compared = plugins.find((entry) => entry.compared);
    return new Set(
      (compared === undefined ? plugins : [compared]).map((entry) => entry.plugin.metadata?.id ?? ""),
    );
  }
  const selected = new Set<string>();
  for (const source of spec.cases) {
    if (source.source.case !== "plugin") {
      continue;
    }
    const ref = source.source.value;
    const match = plugins.find((entry) => namesPlugin(ref, entry.plugin, agentOrg));
    if (match === undefined) {
      throw invalidArgumentError(evalRunUnloadedCaseSourceMessage(ref.slug !== "" ? ref.slug : ref.id));
    }
    selected.add(match.plugin.metadata?.id ?? "");
  }
  return selected;
}

/** Whether a case source's reference names `plugin`: by id when it holds one, else by organization and slug. */
function namesPlugin(ref: ApiResourceReference, plugin: Plugin, agentOrg: string): boolean {
  if (ref.id !== "") {
    return ref.id === plugin.metadata?.id;
  }
  return ref.slug === plugin.metadata?.slug && (ref.org || agentOrg) === plugin.metadata?.org;
}

/**
 * ValidateEvalRunTargets: every target that names a model names one the
 * catalog runs on that engine, the write-time pin rule every saved model
 * choice follows (modelcatalog/pin-validation.ts), so a typo is refused
 * with a did-you-mean rather than planning tries that cannot start.
 */
export function newValidateEvalRunTargetsStep(catalog: ModelCatalogProvider): PipelineStep<typeof EvalRunSchema> {
  return {
    name: "ValidateEvalRunTargets",
    execute(ctx: RequestContext<typeof EvalRunSchema>): void {
      const targets = ctx.newState.spec?.targets ?? [];
      targets.forEach((target, index) => {
        const refusal = unknownModelPinRefusal(
          catalog,
          `spec.targets[${index}].model_name`,
          harnessName(target.harness),
          target.modelName,
        );
        if (refusal !== "") {
          throw invalidArgumentError(refusal);
        }
      });
    },
  };
}

/**
 * PlanEvalRun: refuses a case_glob that is not a glob; reads each selected
 * plugin's suite at its stamped digest; stamps every plugin a try loads on
 * the status (its id, slug, digest, whether attached and compared, and why
 * its cases do not run: not selected, or none at this version); refuses an
 * eval run with no cases at all, one whose filters keep none, and one
 * larger than an eval run may run across every plugin (counted, not
 * planned: the workflow plans the cells of an eval run that fits); and
 * writes the pending status with the agent version's hash and the planned
 * tries. Runs after BuildNewState and VaultAttachments, which own the rest
 * of the status.
 */
export function newPlanEvalRunStep(
  source: EvalSuiteSource,
  catalog: ModelCatalogProvider,
): PipelineStep<typeof EvalRunSchema> {
  return {
    name: "PlanEvalRun",
    async execute(ctx: RequestContext<typeof EvalRunSchema>): Promise<void> {
      const spec = ctx.newState.spec;
      if (spec === undefined) {
        throw invalidArgumentError("spec is required for an eval run");
      }
      const globError = caseGlobError(spec.caseGlob);
      if (globError !== undefined) {
        throw invalidArgumentError(evalRunCaseGlobMessage(spec.caseGlob, globError));
      }
      const load = stashed<EvaluatedLoad>(ctx, EVAL_RUN_LOAD_KEY, "eval run load");
      const onPlugin = load.agentSpec === undefined;
      const agentTarget = onPlugin ? undefined : agentTargetOf(load.agentSpec);
      const planSpec = matrixSpecOf(spec);
      const planCatalog = evalModelCatalogOf(catalog);
      let cases = 0;
      let tries = 0;
      let withCases = 0;
      let suiteDir = "evals";
      const stamped = [];
      for (const entry of load.plugins) {
        const pluginId = entry.plugin.metadata?.id ?? "";
        const stamp = create(EvalRunPluginSchema, {
          pluginId,
          pluginSlug: entry.plugin.metadata?.slug ?? "",
          pluginDigest: entry.digest,
          attached: entry.attached,
          compared: entry.compared,
        });
        stamped.push(stamp);
        if (!load.selected.has(pluginId)) {
          stamp.notRunReason = PLUGIN_NOT_SELECTED_REASON;
          continue;
        }
        let loaded;
        try {
          loaded = entry.digest === "" ? undefined : await loadEvalSuite(source, pluginId, entry.digest);
        } catch (error) {
          if (error instanceof ConnectError) {
            throw error;
          }
          throw internalError(error, "failed to read the plugins' evals");
        }
        if (loaded === undefined || loaded.suite.cases.length === 0) {
          suiteDir = loaded?.suite.dir ?? suiteDir;
          stamp.notRunReason = PLUGIN_NO_CASES_REASON;
          continue;
        }
        withCases++;
        const size = sizeOfMatrix(loaded.suite, planSpec, planCatalog, agentTarget);
        cases += size.cases;
        tries += size.tries;
      }
      if (withCases === 0) {
        throw failedPreconditionError(onPlugin ? evalRunNoCasesMessage(suiteDir) : EVAL_RUN_NO_CASES_MESSAGE);
      }
      if (cases > EVAL_RUN_MAX_CASES || tries > EVAL_RUN_MAX_TRIES) {
        throw failedPreconditionError(evalRunTooLargeMessage(cases, tries));
      }
      if (cases === 0) {
        throw failedPreconditionError(EVAL_RUN_NO_MATCHING_CASES_MESSAGE);
      }
      const status = (ctx.newState.status ??= create(EvalRunStatusSchema));
      status.phase = EvalRunPhase.pending;
      status.agentVersionHash = onPlugin ? "" : spec.agentVersion;
      status.plugins = stamped;
      status.triesTotal = tries;
    },
  };
}

/**
 * EnsureEvalRunSubjectStillExists: after the eval run and its access are
 * written, the subject is read again. A subject deleted meanwhile (its
 * delete listed its eval runs before this one was stored) takes the eval
 * run with it: the row and its access are removed here and the create
 * answers NOT_FOUND for the subject (the subject's delete sweeps the other
 * order, cascade.ts, which leaves one still running after its wait for the
 * organization's purge).
 */
export function newEnsureEvalRunSubjectStillExistsStep(
  store: Store,
  authorizationLifecycle: ResourceAuthorizationLifecycle | undefined,
  logger: Logger,
): PipelineStep<typeof EvalRunSchema> {
  return {
    name: "EnsureEvalRunSubjectStillExists",
    async execute(ctx: RequestContext<typeof EvalRunSchema>): Promise<void> {
      const subject = requiredSubject(ctx.newState.spec);
      try {
        if (subject.kind === "agent") {
          await store.getResource(ApiResourceKind.agent, subject.id, AgentSchema);
        } else {
          await store.getResource(ApiResourceKind.plugin, subject.id, PluginSchema);
        }
        return;
      } catch (error) {
        if (!(error instanceof ResourceNotFoundError)) {
          throw internalError(error, `failed to read the ${subject.kind} to evaluate again`);
        }
      }
      const evalRunId = ctx.newState.metadata?.id ?? "";
      logger.warn("an eval run's subject was deleted while it was created; removing the eval run", {
        evalRunId,
        subject: `${subject.kind} ${subject.id}`,
      });
      try {
        await store.deleteResource(ApiResourceKind.eval_run, evalRunId);
      } catch (error) {
        throw internalError(error, "failed to remove the eval run of a deleted subject");
      }
      await releaseNamesOfDeleted(store, logger, ApiResourceKind.eval_run, ctx.newState.metadata?.org ?? "", evalRunId);
      await cleanUpDeletedResource(authorizationLifecycle, logger, {
        kind: ApiResourceKind.eval_run,
        resourceId: evalRunId,
        orgId: ctx.newState.metadata?.org ?? "",
        caller: ctx.callerIdentity,
      });
      throw notFoundError(subject.kind === "agent" ? "Agent" : "Plugin", subject.id);
    },
  };
}

/**
 * StartEvalRunWorkflow: starts the eval run's workflow under its
 * deterministic id, after the row and its access are written. A start
 * that fails (no engine yet, a refusal, the deadline) marks the eval run
 * failed while it is still pending, with a fixed sentence every viewer of
 * the subject may read (the engine's own error is logged), and the create
 * answers that row: the eval run was created, and did not run. Only the
 * workflow's load writes running, so a start that failed after the
 * workflow did begin (its answer lost to the deadline) finds it running
 * and leaves it to the workflow, which records its tries, ends it, and
 * answers a cancel.
 */
export function newStartEvalRunWorkflowStep(
  store: Store,
  workflows: EvalRunWorkflows,
  logger: Logger,
): PipelineStep<typeof EvalRunSchema> {
  return {
    name: "StartEvalRunWorkflow",
    async execute(ctx: RequestContext<typeof EvalRunSchema>): Promise<void> {
      const evalRunId = ctx.newState.metadata?.id ?? "";
      try {
        await workflows.start(evalRunId);
        return;
      } catch (error) {
        logger.warn("an eval run's workflow could not start; marking it failed", {
          evalRunId,
          cause: error instanceof Error ? error.message : String(error),
        });
        const failed = await settleUnlessFinished(
          store,
          evalRunId,
          (status) => {
            status.phase = EvalRunPhase.failed;
            status.error = EVAL_RUN_NOT_STARTED_ERROR;
            status.finishedAt = timestampNow();
          },
          (row) => row.status?.phase === EvalRunPhase.pending,
        );
        ctx.setNewState(failed);
      }
    },
  };
}

/**
 * Writes `settle` onto an eval run's status only while `settleable` holds
 * for the stored row (by default, while it is pending or running), through
 * the store's atomic read-modify-write; answers the row as stored
 * afterwards either way.
 */
async function settleUnlessFinished(
  store: Store,
  evalRunId: string,
  settle: (status: EvalRunStatus) => void,
  settleable: (evalRun: EvalRun) => boolean = isActiveEvalRun,
): Promise<EvalRun> {
  try {
    return await store.updateResource(ApiResourceKind.eval_run, evalRunId, EvalRunSchema, (live) => {
      if (!settleable(live)) {
        return;
      }
      settle((live.status ??= create(EvalRunStatusSchema)));
    });
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("EvalRun", evalRunId);
    }
    throw internalError(error, "failed to save the eval run");
  }
}

/**
 * CancelEvalRun: a finished eval run is answered unchanged, and one that
 * outlived its workflow is failed (settleEndedEvalRun) without asking the
 * engine. Otherwise the workflow is asked to cancel, which it answers by
 * stopping the tries in flight and ending partial "cancelled"; when no
 * workflow runs under the eval run's id, a pending one (its start never
 * happened) is marked partial "cancelled" here, and a running one, whose
 * workflow ran and closed without writing its end, failed "the eval run's
 * workflow ended without finishing". No engine connection is UNAVAILABLE:
 * whether a workflow runs cannot be told.
 */
export function newCancelEvalRunStep(
  store: Store,
  workflows: EvalRunWorkflows,
): PipelineStep<typeof EvalRunIdSchema> {
  return {
    name: "CancelEvalRun",
    async execute(ctx: RequestContext<typeof EvalRunIdSchema>): Promise<void> {
      const target = ctx.get(TARGET_RESOURCE_KEY) as EvalRun | undefined;
      if (target === undefined) {
        throw internalError(new Error("eval run not found in context"), "eval run not found in context");
      }
      const evalRunId = target.metadata?.id ?? "";
      if (!isActiveEvalRun(target)) {
        ctx.set(EVAL_RUN_RESULT_KEY, target);
        return;
      }
      if (evalRunOutlivedItsWorkflow(target, Date.now())) {
        ctx.set(EVAL_RUN_RESULT_KEY, await settleUnlessFinished(store, evalRunId, failWorkflowEnded));
        return;
      }
      let outcome: "requested" | "not-found";
      try {
        outcome = await workflows.cancel(evalRunId);
      } catch (error) {
        if (error instanceof EvalRunEngineUnavailableError) {
          throw unavailableError(EVAL_RUN_NO_ENGINE_MESSAGE);
        }
        throw internalError(error, "failed to cancel the eval run");
      }
      if (outcome === "requested") {
        ctx.set(EVAL_RUN_RESULT_KEY, target);
        return;
      }
      if (target.status?.phase === EvalRunPhase.running) {
        // Only the workflow writes running: it ran, and closed without its end.
        ctx.set(EVAL_RUN_RESULT_KEY, await settleUnlessFinished(store, evalRunId, failWorkflowEnded));
        return;
      }
      ctx.set(
        EVAL_RUN_RESULT_KEY,
        await settleUnlessFinished(store, evalRunId, (status) => {
          status.phase = EvalRunPhase.partial;
          status.partialReason = EvalRunPartialReason.cancelled;
          status.finishedAt = timestampNow();
        }),
      );
    },
  };
}

/**
 * RefuseActiveEvalRunDelete: a pending or running eval run is refused,
 * naming cancel, because its tries' conversations may still hold an active
 * run, which a conversation's delete refuses.
 */
export function newRefuseActiveEvalRunDeleteStep(): PipelineStep<typeof EvalRunIdSchema> {
  return {
    name: "RefuseActiveEvalRunDelete",
    execute(ctx: RequestContext<typeof EvalRunIdSchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as EvalRun | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing eval run not found in context"),
          "existing eval run not found in context",
        );
      }
      if (isActiveEvalRun(existing)) {
        throw failedPreconditionError(evalRunActiveDeleteMessage(existing.metadata?.id ?? ""));
      }
    },
  };
}

/**
 * DeleteEvalRunTries: each try's conversation goes through the session
 * domain's own delete, which removes its runs and their scores. Runs
 * before the eval run's row, so a delete that fails partway is retried
 * from a row that still finds what is left.
 */
export function newDeleteEvalRunTriesStep(
  store: Store,
  sessions: () => TrySessionDeleter,
  logger: Logger,
): PipelineStep<typeof EvalRunIdSchema> {
  return {
    name: "DeleteEvalRunTries",
    async execute(ctx: RequestContext<typeof EvalRunIdSchema>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as EvalRun | undefined;
      await deleteEvalRunTries(store, sessions(), logger, existing?.metadata?.id ?? ctx.input.value);
    },
  };
}

/** A list request of either subject: the subject's id field, a page and labels. */
type SubjectListSchema = typeof ListEvalRunsByAgentRequestSchema | typeof ListEvalRunsByPluginRequestSchema;

/**
 * ListEvalRunsBySubject: one page of the subject's eval runs, newest
 * first, each kept only when the caller may view it. The RPC asked can_view
 * on the subject; an eval run's own can_view is narrower (the subject's
 * viewers in its own organization), so a child organization's viewer gets
 * an empty list rather than a refusal. Each eval run is answered without
 * its tries (every arm's list emptied; its scores, aggregates, per-target
 * results and notes kept), so a page stays small however many tries its
 * eval runs ran.
 */
export function newListEvalRunsBySubjectStep<Desc extends SubjectListSchema>(
  kind: EvalRunSubject["kind"],
  store: Store,
  authorizer: Authorizer,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: kind === "agent" ? "ListEvalRunsByAgent" : "ListEvalRunsByPlugin",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const input = ctx.input;
      const subjectId = "agentId" in input ? input.agentId : input.pluginId;
      const page = await readListPage({
        store,
        declaration: evalRunListIndex,
        query: { anyKey: [{ name: kind, value: subjectId }] },
        request: input,
        fingerprint: listPageFingerprint({
          lane: kind === "agent" ? "evalRun.listByAgent" : "evalRun.listByPlugin",
          subjectId,
          labels: sortedLabels(input.labels),
        }),
        decode: decodeOrSkip<EvalRun>(EvalRunSchema, {
          logger,
          message: "skipped an eval run row that does not decode",
          fields: { subjectId },
        }),
        keep: (evalRun) => {
          const about = subjectOf(evalRun.spec);
          return (
            about?.kind === kind &&
            about.id === subjectId &&
            matchesAllLabels(evalRun.metadata?.labels ?? {}, input.labels)
          );
        },
        scope: async (evalRuns) => {
          if (isServerComposedRequest(ctx.callerIdentity)) {
            return evalRuns;
          }
          const viewable: EvalRun[] = [];
          for (const evalRun of evalRuns) {
            const decision = await evaluateAuthorizer(authorizer, ctx.callerIdentity, {
              permission: IamPermission.can_view,
              resourceKind: ApiResourceKind.eval_run,
              resourceId: evalRun.metadata?.id ?? "",
            });
            if (decision.kind === "unavailable") {
              throw internalError(decision.cause, `failed to authorize the ${kind}'s eval runs`);
            }
            if (decision.kind === "allow") {
              viewable.push(evalRun);
            }
          }
          return viewable;
        },
        failure: `failed to list the ${kind}'s eval runs`,
      });
      const answered: EvalRun[] = [];
      for (const evalRun of page.entries) {
        const settled = await settleEndedEvalRun(store, evalRun);
        withoutTries(settled);
        answered.push(settled);
      }
      ctx.set(
        EVAL_RUN_RESULT_KEY,
        create(EvalRunListSchema, {
          entries: answered,
          nextPageToken: page.nextPageToken,
        }),
      );
    },
  };
}

/** Empties every arm's tries of `evalRun`, in place; every summary is kept. */
function withoutTries(evalRun: EvalRun): void {
  for (const plugin of evalRun.status?.plugins ?? []) {
    for (const evalCase of plugin.cases) {
      for (const target of evalCase.targets) {
        for (const arm of [target.withPlugin, target.withoutPlugin]) {
          if (arm !== undefined) {
            arm.tries = [];
          }
        }
      }
    }
  }
}
