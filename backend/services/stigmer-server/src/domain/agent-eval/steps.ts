/**
 * Agent eval domain steps: who may run an agent's evals, the agent version
 * and the plugin versions an eval runs, the cases it plans and the limits
 * it is held to, the workflow create starts, and the cancel and delete
 * that follow. The plugin eval's chain (domain/plugin-eval/steps.ts) is the
 * model, step for step, and its phase rules are shared.
 *
 * The create chain asks its question before it reads anything: can_edit on
 * the agent named in spec.agent_id, then the agent is read, so a caller
 * who cannot edit it learns nothing about whether it exists. The version is
 * resolved through the agent's version ladder (a hash or a tag; empty and
 * "latest" are the current version) and stamped as its hash. Each plugin
 * that version attaches is resolved as a turn resolves it
 * (domain/plugin/versions.ts loadPluginByReference: the reference's version
 * when it names one, else the version installed now) and stamped on the
 * status with its digest, whether its cases run or not: every try attaches
 * every one of them, pinned, so the agent runs as it would in a
 * conversation, at fixed versions (domain/plugin-eval/arm.ts).
 *
 * Status has one writer once create returns: the eval's workflow
 * (temporal/evals/). A start that fails marks the row failed only while it
 * is pending, a cancel only while it is pending or running, both through
 * the store's atomic read-modify-write.
 *
 * Proven by __tests__/steps.test.ts (each step's arms) and
 * __tests__/agent-eval.test.ts (the composed lanes).
 */
import { ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type {
  AgentEvalIdSchema,
  ListAgentEvalsByAgentRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/io_pb";
import { AgentEvalListSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/io_pb";
import {
  AgentEvalPluginSchema,
  AgentEvalStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/status_pb";
import type { AgentEvalStatus } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/status_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
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
  unavailableError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import type { AuthorizationTarget } from "../../pipeline/steps/authorize.js";
import { evaluateAuthorizer } from "../../pipeline/steps/authorize.js";
import { assignServerId, generateId } from "../../pipeline/steps/defaults.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { loadVersion, resolveVersionHash } from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { agentVersionBinding } from "../agent/versions.js";
import { loadPluginByReference } from "../plugin/versions.js";
import { checkAllowTools } from "../plugin-eval/allow-tools.js";
import {
  PLUGIN_EVAL_MAX_CASES,
  PLUGIN_EVAL_MAX_TRIES,
  PLUGIN_EVAL_NO_ENGINE_MESSAGE,
  PLUGIN_EVAL_NOT_STARTED_ERROR,
  PLUGIN_EVAL_REAL_SERVERS_CONFLICT_MESSAGE,
  PLUGIN_EVAL_WORKFLOW_ENDED_ERROR,
  pluginEvalCaseGlobMessage,
  pluginEvalTooLargeMessage,
} from "../plugin-eval/constants.js";
import { caseGlobError, evalModelCatalogOf, sizeOfMatrix } from "../plugin-eval/matrix.js";
import type { AgentTarget } from "../plugin-eval/matrix.js";
import { isActivePluginEval, pluginEvalOutlivedItsWorkflow } from "../plugin-eval/steps.js";
import type { EvalSuiteSource } from "../plugin-eval/suite.js";
import { loadEvalSuite } from "../plugin-eval/suite.js";
import { deletePluginEvalTries } from "../plugin-eval/tries.js";
import type { TrySessionDeleter } from "../plugin-eval/tries.js";
import { PluginEvalEngineUnavailableError } from "../plugin-eval/workflows.js";
import type { PluginEvalWorkflows } from "../plugin-eval/workflows.js";
import {
  AGENT_EVAL_CREATE_DENIED_MESSAGE,
  AGENT_EVAL_NO_CASES_MESSAGE,
  AGENT_EVAL_NO_PLUGINS_MESSAGE,
  PLUGIN_NO_CASES_REASON,
  PLUGIN_NOT_SELECTED_REASON,
  agentEvalActiveDeleteMessage,
  agentEvalOrgMismatchMessage,
  agentEvalOtherPluginToolMessage,
  agentEvalUnknownPluginMessage,
} from "./constants.js";
import { listAgentEvals } from "./queries.js";

/** Context key for the agent a create evaluates, stashed by LoadEvaluatedAgent. */
export const EVALUATED_AGENT_KEY = "evaluatedAgent";

/** Context key for the agent version and its plugins, stashed by ResolveAgentEvalDefaults. */
export const EVALUATED_VERSION_KEY = "evaluatedAgentVersion";

/** Context key for cancel's and listByAgent's answers. */
export const AGENT_EVAL_RESULT_KEY = "agentEvalResult";

/** The agent version a create evaluates: its spec, and every plugin it attaches as resolved now. */
export interface EvaluatedVersion {
  readonly spec: AgentSpec | undefined;
  readonly plugins: ReadonlyArray<Plugin>;
}

/** The agent version's default target, as a try with no target runs it (temporal/evals/agent-context.ts). */
export function agentTargetOf(spec: AgentSpec | undefined): AgentTarget {
  return {
    harness: spec === undefined || spec.harness === Harness.UNSPECIFIED ? Harness.NATIVE : spec.harness,
    modelName: spec?.runConfig?.modelName ?? "",
  };
}

/**
 * The create lane's authorization question, for AuthorizeResolvedTarget
 * BEFORE the agent is read: can_edit on the agent named in spec.agent_id.
 * A server-composed request asks nothing.
 */
export function resolveAgentEvalCreateTargets(
  ctx: RequestContext<typeof AgentEvalSchema>,
): ReadonlyArray<AuthorizationTarget> {
  if (isServerComposedRequest(ctx.callerIdentity)) {
    return [];
  }
  return [
    {
      permission: IamPermission.can_edit,
      resourceKind: ApiResourceKind.agent,
      resourceId: ctx.newState.spec?.agentId ?? "",
      deniedMessage: AGENT_EVAL_CREATE_DENIED_MESSAGE,
    },
  ];
}

/** LoadEvaluatedAgent: reads the agent named in spec.agent_id into EVALUATED_AGENT_KEY. */
export function newLoadEvaluatedAgentStep(store: Store): PipelineStep<typeof AgentEvalSchema> {
  return {
    name: "LoadEvaluatedAgent",
    async execute(ctx: RequestContext<typeof AgentEvalSchema>): Promise<void> {
      const agentId = ctx.newState.spec?.agentId ?? "";
      let agent: Agent;
      try {
        agent = await store.getResource(ApiResourceKind.agent, agentId, AgentSchema);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Agent", agentId);
        }
        throw internalError(error, "failed to load the agent to evaluate");
      }
      ctx.set(EVALUATED_AGENT_KEY, agent);
    },
  };
}

function stashed<T>(ctx: RequestContext<typeof AgentEvalSchema>, key: string, what: string): T {
  const value = ctx.get(key) as T | undefined;
  if (value === undefined) {
    throw internalError(new Error(`${what} not found in context`), `${what} not found in context`);
  }
  return value;
}

/**
 * ResolveAgentEvalDefaults: metadata.org is required and must be the
 * agent's organization (the one that pays); spec.agent_version is resolved
 * to the version's hash and stamped (NOT_FOUND naming a version the agent
 * does not hold); a version that attaches no plugin is refused; a
 * spec.plugins slug the version does not attach is INVALID_ARGUMENT; each
 * attached plugin is resolved at the version a turn would run (NOT_FOUND
 * for one gone); spec.allow_tools may name any of their servers;
 * spec.allow_real_servers with spec.real_mcp_servers is refused, as a
 * plugin eval's is; the id is minted here.
 */
export function newResolveAgentEvalDefaultsStep(store: Store): PipelineStep<typeof AgentEvalSchema> {
  return {
    name: "ResolveAgentEvalDefaults",
    async execute(ctx: RequestContext<typeof AgentEvalSchema>): Promise<void> {
      const metadata = ctx.newState.metadata;
      if (metadata === undefined || metadata.org === "") {
        throw invalidArgumentError("metadata.org is required for an agent eval");
      }
      const agent = stashed<Agent>(ctx, EVALUATED_AGENT_KEY, "evaluated agent");
      const agentOrg = agent.metadata?.org ?? "";
      if (metadata.org !== agentOrg) {
        throw failedPreconditionError(agentEvalOrgMismatchMessage(agentOrg));
      }
      const spec = ctx.newState.spec;
      if (spec === undefined) {
        throw invalidArgumentError("spec is required for an agent eval");
      }
      if (spec.allowRealServers && spec.realMcpServers) {
        throw invalidArgumentError(PLUGIN_EVAL_REAL_SERVERS_CONFLICT_MESSAGE);
      }
      const hash = await resolveVersionHash(store, agentVersionBinding, agent, spec.agentVersion);
      if (hash === undefined) {
        throw notFoundError("agent version", spec.agentVersion);
      }
      const version = await loadVersion(store, agentVersionBinding, spec.agentId, hash);
      const versionSpec = version.resource.spec;
      const refs = versionSpec?.plugins ?? [];
      if (refs.length === 0) {
        throw failedPreconditionError(AGENT_EVAL_NO_PLUGINS_MESSAGE);
      }
      const attachedSlugs = new Set(refs.map((ref) => ref.slug));
      for (const slug of spec.plugins) {
        if (!attachedSlugs.has(slug)) {
          throw invalidArgumentError(agentEvalUnknownPluginMessage(slug));
        }
      }
      const plugins: Plugin[] = [];
      for (const ref of refs) {
        plugins.push(await loadPluginByReference(store, ref, agentOrg));
      }
      const allowed = checkAllowTools(
        spec.allowTools,
        plugins.map((plugin) => ({
          name: plugin.metadata?.name ?? "",
          servers: (plugin.status?.mcpServers ?? []).map((server) => server.name),
        })),
      );
      if (!allowed.ok) {
        throw invalidArgumentError(agentEvalOtherPluginToolMessage(allowed.entry, allowed.server));
      }
      spec.allowTools = [...allowed.tools];
      spec.agentVersion = hash;
      ctx.set(EVALUATED_VERSION_KEY, { spec: versionSpec, plugins } satisfies EvaluatedVersion);
      assignServerId(ctx, generateId("aev"));
      if (metadata.name === "" && metadata.slug === "") {
        metadata.name = metadata.id;
      }
    },
  };
}

/** ValidateAgentEvalTargets: every target naming a model names one the catalog runs on that engine. */
export function newValidateAgentEvalTargetsStep(
  catalog: ModelCatalogProvider,
): PipelineStep<typeof AgentEvalSchema> {
  return {
    name: "ValidateAgentEvalTargets",
    execute(ctx: RequestContext<typeof AgentEvalSchema>): void {
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
 * PlanAgentEval: refuses a case_glob that is not a glob; reads each
 * selected plugin's suite at its stamped digest; stamps every attached
 * plugin on the status (its id, slug and digest, and why its cases do not
 * run: not selected, or none at this version); refuses an eval with no
 * cases at all, one whose filters keep none, and one larger than an eval
 * may run across every plugin (counted, not planned: the workflow plans the
 * cells of an eval that fits); and writes the pending status with the
 * agent version's hash and the planned tries.
 */
export function newPlanAgentEvalStep(
  source: EvalSuiteSource,
  catalog: ModelCatalogProvider,
): PipelineStep<typeof AgentEvalSchema> {
  return {
    name: "PlanAgentEval",
    async execute(ctx: RequestContext<typeof AgentEvalSchema>): Promise<void> {
      const spec = ctx.newState.spec;
      if (spec === undefined) {
        throw invalidArgumentError("spec is required for an agent eval");
      }
      const globError = caseGlobError(spec.caseGlob);
      if (globError !== undefined) {
        throw invalidArgumentError(pluginEvalCaseGlobMessage(spec.caseGlob, globError));
      }
      const version = stashed<EvaluatedVersion>(ctx, EVALUATED_VERSION_KEY, "evaluated agent version");
      const selected = new Set(spec.plugins);
      const agentTarget = agentTargetOf(version.spec);
      const planCatalog = evalModelCatalogOf(catalog);
      let cases = 0;
      let tries = 0;
      let withCases = 0;
      const stamped = [];
      for (const plugin of version.plugins) {
        const pluginId = plugin.metadata?.id ?? "";
        const digest = plugin.status?.digest ?? "";
        const entry = create(AgentEvalPluginSchema, {
          pluginId,
          pluginSlug: plugin.metadata?.slug ?? "",
          pluginDigest: digest,
        });
        stamped.push(entry);
        if (selected.size > 0 && !selected.has(entry.pluginSlug)) {
          entry.notRunReason = PLUGIN_NOT_SELECTED_REASON;
          continue;
        }
        let loaded;
        try {
          loaded = digest === "" ? undefined : await loadEvalSuite(source, pluginId, digest);
        } catch (error) {
          if (error instanceof ConnectError) {
            throw error;
          }
          throw internalError(error, "failed to read the plugins' evals");
        }
        if (loaded === undefined || loaded.suite.cases.length === 0) {
          entry.notRunReason = PLUGIN_NO_CASES_REASON;
          continue;
        }
        withCases++;
        const size = sizeOfMatrix(loaded.suite, spec, planCatalog, agentTarget);
        cases += size.cases;
        tries += size.tries;
      }
      if (withCases === 0) {
        throw failedPreconditionError(AGENT_EVAL_NO_CASES_MESSAGE);
      }
      if (cases > PLUGIN_EVAL_MAX_CASES || tries > PLUGIN_EVAL_MAX_TRIES) {
        throw failedPreconditionError(pluginEvalTooLargeMessage(cases, tries));
      }
      if (cases === 0) {
        throw failedPreconditionError("no eval case matches case_glob and case_tags");
      }
      const status = (ctx.newState.status ??= create(AgentEvalStatusSchema));
      status.phase = PluginEvalPhase.pending;
      status.agentVersionHash = spec.agentVersion;
      status.plugins = stamped;
      status.triesTotal = tries;
    },
  };
}

/**
 * EnsureEvaluatedAgentStillExists: after the eval and its access are
 * written, the agent is read again; an agent deleted meanwhile takes the
 * eval with it (the row and its access removed here, NOT_FOUND answered
 * for the agent), as the plugin eval's create does for its plugin.
 */
export function newEnsureEvaluatedAgentStillExistsStep(
  store: Store,
  authorizationLifecycle: ResourceAuthorizationLifecycle | undefined,
  logger: Logger,
): PipelineStep<typeof AgentEvalSchema> {
  return {
    name: "EnsureEvaluatedAgentStillExists",
    async execute(ctx: RequestContext<typeof AgentEvalSchema>): Promise<void> {
      const agentId = ctx.newState.spec?.agentId ?? "";
      try {
        await store.getResource(ApiResourceKind.agent, agentId, AgentSchema);
        return;
      } catch (error) {
        if (!(error instanceof ResourceNotFoundError)) {
          throw internalError(error, "failed to read the agent to evaluate again");
        }
      }
      const evalId = ctx.newState.metadata?.id ?? "";
      logger.warn("an agent eval's agent was deleted while it was created; removing the eval", {
        evalId,
        agentId,
      });
      try {
        await store.deleteResource(ApiResourceKind.agent_eval, evalId);
      } catch (error) {
        throw internalError(error, "failed to remove the agent eval of a deleted agent");
      }
      await cleanUpDeletedResource(authorizationLifecycle, logger, {
        kind: ApiResourceKind.agent_eval,
        resourceId: evalId,
        orgId: ctx.newState.metadata?.org ?? "",
        caller: ctx.callerIdentity,
      });
      throw notFoundError("Agent", agentId);
    },
  };
}

/**
 * StartAgentEvalWorkflow: starts the eval's workflow under its
 * deterministic id; a start that fails marks the eval failed while it is
 * still pending, with a fixed sentence (the engine's error is logged), and
 * the create answers that row.
 */
export function newStartAgentEvalWorkflowStep(
  store: Store,
  workflows: PluginEvalWorkflows,
  logger: Logger,
): PipelineStep<typeof AgentEvalSchema> {
  return {
    name: "StartAgentEvalWorkflow",
    async execute(ctx: RequestContext<typeof AgentEvalSchema>): Promise<void> {
      const evalId = ctx.newState.metadata?.id ?? "";
      try {
        await workflows.start(evalId);
        return;
      } catch (error) {
        logger.warn("an agent eval's workflow could not start; marking it failed", {
          evalId,
          cause: error instanceof Error ? error.message : String(error),
        });
        const failed = await settleUnlessFinished(
          store,
          evalId,
          (status) => {
            status.phase = PluginEvalPhase.failed;
            status.error = PLUGIN_EVAL_NOT_STARTED_ERROR;
            status.finishedAt = timestampNow();
          },
          (row) => row.status?.phase === PluginEvalPhase.pending,
        );
        ctx.setNewState(failed);
      }
    },
  };
}

/** Writes `settle` onto an eval's status only while `settleable` holds for the stored row. */
async function settleUnlessFinished(
  store: Store,
  evalId: string,
  settle: (status: AgentEvalStatus) => void,
  settleable: (agentEval: AgentEval) => boolean = isActivePluginEval,
): Promise<AgentEval> {
  try {
    return await store.updateResource(ApiResourceKind.agent_eval, evalId, AgentEvalSchema, (live) => {
      if (!settleable(live)) {
        return;
      }
      settle((live.status ??= create(AgentEvalStatusSchema)));
    });
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("AgentEval", evalId);
    }
    throw internalError(error, "failed to save the agent eval");
  }
}

function failWorkflowEnded(status: AgentEvalStatus): void {
  status.phase = PluginEvalPhase.failed;
  status.error = PLUGIN_EVAL_WORKFLOW_ENDED_ERROR;
  status.finishedAt = timestampNow();
}

/** The eval as it should be answered: one that outlived its workflow is stored and answered failed. */
export async function settleEndedAgentEval(store: Store, agentEval: AgentEval): Promise<AgentEval> {
  if (!pluginEvalOutlivedItsWorkflow(agentEval, Date.now())) {
    return agentEval;
  }
  try {
    return await settleUnlessFinished(store, agentEval.metadata?.id ?? "", failWorkflowEnded);
  } catch {
    return agentEval;
  }
}

/** SettleEndedAgentEval: get's answer, after the target is loaded. */
export function newSettleEndedAgentEvalStep(store: Store): PipelineStep<typeof AgentEvalIdSchema> {
  return {
    name: "SettleEndedAgentEval",
    async execute(ctx: RequestContext<typeof AgentEvalIdSchema>): Promise<void> {
      const target = ctx.get(TARGET_RESOURCE_KEY) as AgentEval | undefined;
      if (target !== undefined) {
        ctx.set(TARGET_RESOURCE_KEY, await settleEndedAgentEval(store, target));
      }
    },
  };
}

/**
 * CancelAgentEval: the plugin eval's cancel (domain/plugin-eval/steps.ts
 * CancelPluginEval) on an agent eval: a finished eval is answered
 * unchanged; one that outlived its workflow is failed; otherwise the
 * workflow is asked to cancel, and with none running a pending eval is
 * marked partial "cancelled" and a running one failed.
 */
export function newCancelAgentEvalStep(
  store: Store,
  workflows: PluginEvalWorkflows,
): PipelineStep<typeof AgentEvalIdSchema> {
  return {
    name: "CancelAgentEval",
    async execute(ctx: RequestContext<typeof AgentEvalIdSchema>): Promise<void> {
      const target = stashedTarget(ctx);
      const evalId = target.metadata?.id ?? "";
      if (!isActivePluginEval(target)) {
        ctx.set(AGENT_EVAL_RESULT_KEY, target);
        return;
      }
      if (pluginEvalOutlivedItsWorkflow(target, Date.now())) {
        ctx.set(AGENT_EVAL_RESULT_KEY, await settleUnlessFinished(store, evalId, failWorkflowEnded));
        return;
      }
      let outcome: "requested" | "not-found";
      try {
        outcome = await workflows.cancel(evalId);
      } catch (error) {
        if (error instanceof PluginEvalEngineUnavailableError) {
          throw unavailableError(PLUGIN_EVAL_NO_ENGINE_MESSAGE);
        }
        throw internalError(error, "failed to cancel the agent eval");
      }
      if (outcome === "requested") {
        ctx.set(AGENT_EVAL_RESULT_KEY, target);
        return;
      }
      if (target.status?.phase === PluginEvalPhase.running) {
        ctx.set(AGENT_EVAL_RESULT_KEY, await settleUnlessFinished(store, evalId, failWorkflowEnded));
        return;
      }
      ctx.set(
        AGENT_EVAL_RESULT_KEY,
        await settleUnlessFinished(store, evalId, (status) => {
          status.phase = PluginEvalPhase.partial;
          status.partialReason = PluginEvalPartialReason.cancelled;
          status.finishedAt = timestampNow();
        }),
      );
    },
  };
}

function stashedTarget(ctx: RequestContext<typeof AgentEvalIdSchema>): AgentEval {
  const target = ctx.get(TARGET_RESOURCE_KEY) as AgentEval | undefined;
  if (target === undefined) {
    throw internalError(new Error("agent eval not found in context"), "agent eval not found in context");
  }
  return target;
}

/** RefuseActiveAgentEvalDelete: a pending or running eval is refused, naming cancel. */
export function newRefuseActiveAgentEvalDeleteStep(): PipelineStep<typeof AgentEvalIdSchema> {
  return {
    name: "RefuseActiveAgentEvalDelete",
    execute(ctx: RequestContext<typeof AgentEvalIdSchema>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as AgentEval | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing agent eval not found in context"),
          "existing agent eval not found in context",
        );
      }
      if (isActivePluginEval(existing)) {
        throw failedPreconditionError(agentEvalActiveDeleteMessage(existing.metadata?.id ?? ""));
      }
    },
  };
}

/**
 * DeleteAgentEvalTries: each try's conversation goes through the session
 * domain's own delete, found by the label's index key as a plugin eval's
 * tries are (domain/plugin-eval/tries.ts).
 */
export function newDeleteAgentEvalTriesStep(
  store: Store,
  sessions: () => TrySessionDeleter,
  logger: Logger,
): PipelineStep<typeof AgentEvalIdSchema> {
  return {
    name: "DeleteAgentEvalTries",
    async execute(ctx: RequestContext<typeof AgentEvalIdSchema>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as AgentEval | undefined;
      await deletePluginEvalTries(store, sessions(), logger, existing?.metadata?.id ?? ctx.input.value);
    },
  };
}

/**
 * ListAgentEvalsByAgent: the agent's evals, newest first, each kept only
 * when the caller may view it (an eval's can_view is the agent's viewers in
 * its own organization, narrower than the agent's), each answered without
 * its tries.
 */
export function newListAgentEvalsByAgentStep(
  store: Store,
  authorizer: Authorizer,
  logger: Logger,
): PipelineStep<typeof ListAgentEvalsByAgentRequestSchema> {
  return {
    name: "ListAgentEvalsByAgent",
    async execute(ctx: RequestContext<typeof ListAgentEvalsByAgentRequestSchema>): Promise<void> {
      let evals: AgentEval[];
      try {
        evals = await listAgentEvals(store, logger, ctx.input.agentId);
      } catch (error) {
        throw internalError(error, "failed to list the agent's evals");
      }
      const answered: AgentEval[] = [];
      for (const agentEval of evals) {
        if (!isServerComposedRequest(ctx.callerIdentity)) {
          const decision = await evaluateAuthorizer(authorizer, ctx.callerIdentity, {
            permission: IamPermission.can_view,
            resourceKind: ApiResourceKind.agent_eval,
            resourceId: agentEval.metadata?.id ?? "",
          });
          if (decision.kind === "unavailable") {
            throw internalError(decision.cause, "failed to authorize the agent's evals");
          }
          if (decision.kind !== "allow") {
            continue;
          }
        }
        const settled = await settleEndedAgentEval(store, agentEval);
        withoutTries(settled);
        answered.push(settled);
      }
      ctx.set(AGENT_EVAL_RESULT_KEY, create(AgentEvalListSchema, { totalCount: answered.length, items: answered }));
    },
  };
}

/** Empties every arm's tries of `agentEval`, in place; every summary is kept. */
function withoutTries(agentEval: AgentEval): void {
  for (const plugin of agentEval.status?.plugins ?? []) {
    for (const evalCase of plugin.cases) {
      for (const target of evalCase.targets) {
        if (target.withPlugin !== undefined) {
          target.withPlugin.tries = [];
        }
      }
    }
  }
}
