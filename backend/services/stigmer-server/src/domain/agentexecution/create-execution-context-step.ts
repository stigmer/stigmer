/**
 * The ExecutionContext builder — ports create_execution_context_step.go:
 * builds and persists an ExecutionContext with a fully-merged environment
 * for an agent execution. Shared by the create pipeline
 * (newCreateExecutionContextStep) and the recover pipeline
 * (lifecycle.ts's recreate step): recovery must rebuild the EC because
 * the failed run's workflow cleanup deleted it, and re-resolving from the
 * CURRENT environment configuration is the desired semantics ("fix the API
 * key, then recover"). The agent is not re-resolved: it is the agent and
 * version the turn recorded (status.agent_id, agent_version_hash, stamped
 * by ResolveRunAgent), read through getVersion, so recovery after an
 * author's edit, or after the session was repointed, rebuilds from the
 * agent the turn ran.
 *
 * Resolution: the session by the execution's session_id (its workspace
 * entries and its own MCP servers shape the environment), and the agent
 * from the stamp alone: the stamped version's spec (agentLoader.getVersion),
 * or the stamped agent as it is now when the turn recorded no version (an
 * agent written before agents were versioned, or with no recorded
 * version). A stamped version that no longer resolves refuses, naming it:
 * running the agent's current version would run and record something
 * nobody asked for. No stamp is the built-in assistant
 * (session/v1/spec.proto): no agent, and the session's own MCP servers are
 * the whole tool set.
 *
 * Merge priority (lowest to highest): the minting PlatformClient's
 * environment_refs, for an execution a PlatformClient-minted user created
 * (#1256) → schedule/workflow-task environment_refs (the
 * share/channel/schedule/agent_call layering; resolved through the
 * environment RuntimeResolutionService — decrypted, the RPC surface
 * redacts, oss#405) → spec.runtime_env. Every layer is keyed on the
 * persisted execution alone (its labels, its audit), never on the
 * request's caller, so recovery rebuilds exactly what create built.
 *
 * Then ONE declaration rule for every shape: the run declares what its
 * agent declares and what its session's MCP servers declare, and the
 * least-privilege filter keeps exactly those keys. The declared keys still
 * missing after the merge are resolved the way the MCP connect lane
 * resolves them — OAuth tokens from the managed grant, the rest from the
 * run's person's personal environment, by declared key only
 * (domain/environment/personal.ts), after every layer. The built-in
 * assistant is the case with no agent half, not an arm of its own. The
 * person's values reach what the agent's author wrote (its shell receives
 * exactly the keys it declares) as they reach MCP servers a session's
 * owner chose, but only for an agent of the run's own organization: an
 * agent another organization published reads none of the person's keys.
 * The console names the keys an agent will read before the first
 * message. Around that rule: the workspace-provisioning
 * re-injection, and the required-keys warning.
 *
 * Every personal read is the RUN'S PERSON'S (run-person.ts): the
 * execution's own creator, read from the persisted row like every layer
 * above, so recovery reads the same person's values create read. A run
 * with no person (a schedule fire) reads no one's.
 */
import { create } from "@bufbuild/protobuf";

import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { EnvironmentSecretValueInputSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import {
  EnvVarDeclarationSchema,
  EnvironmentValueSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type {
  EnvVarDeclaration,
  EnvironmentValue,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

import { Code, ConnectError } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import type { ExecutionContextDeleter } from "../executioncontext/internal-delete.js";
import {
  filterByDeclaredKeys,
  mergeEnvironmentLayers,
  validateRequiredKeys,
} from "../../envmerge/envmerge.js";
import {
  failedPreconditionError,
  goWrappedStatusError,
  internalError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import {
  loadVersion,
  truncateHash,
} from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { OAuthGrant, Store } from "../../store/interface.js";
import {
  fillDeclaredFromPersonalEnvironment,
  resolveDeclaredFromPersonalEnvironment,
} from "../environment/personal.js";
import type { PersonalEnvironmentResolution } from "../environment/personal.js";
import type { RuntimeResolutionService } from "../environment/resolution/resolution.js";
import type { ManagedEnvironmentService } from "../mcpserver/oauth/managed-env.js";
import { refreshTokenIfExpired } from "../mcpserver/oauth/refresh.js";
import type { PlatformClientStore } from "../platformclient/store.js";
import { findAgentCallStep } from "../workflow/validation/agent-call-steps.js";
import { workflowVersionBinding } from "../workflow/version-resolution.js";

import type { AgentLoader } from "./create-steps.js";
import { runPersonOf, SCHEDULE_ID_LABEL_KEY } from "./run-person.js";
import { sessionIdOf } from "./target.js";

export { SCHEDULE_ID_LABEL_KEY };

/**
 * Workflow provenance labels, stamped by the workflow runner's CallAgent
 * activity on every execution it creates. Consumed as the
 * environment-resolution key — OSS has no caller tokens to carry a claim,
 * and this single-user edition has no trust boundary the labels could
 * widen.
 */
export const WORKFLOW_EXECUTION_ID_LABEL_KEY =
  "stigmer.ai/workflow-execution-id";
export const WORKFLOW_TASK_LABEL_KEY = "stigmer.ai/workflow-task";

/**
 * Environment variable keys the agent-runner needs for workspace
 * provisioning, re-injected after env_spec filtering when the session has
 * git_repo workspace entries (GITHUB_TOKEN is a session-level workspace
 * concern, not an agent-declared tool dependency).
 */
export const WORKSPACE_PROVISIONING_KEYS = ["GITHUB_TOKEN"];

// ---------------------------------------------------------------------------
// The narrow in-process edges the builder consumes (lazy providers).
// ---------------------------------------------------------------------------

export interface SessionLoader {
  get(sessionId: string): Promise<Session>;
}
export interface EnvironmentReader {
  getSecretValue(
    input: MessageInitShape<typeof EnvironmentSecretValueInputSchema>,
  ): Promise<EnvironmentValue>;
}
export interface ExecutionContextCreator {
  create(ec: ExecutionContext): Promise<ExecutionContext>;
}

export interface ExecutionContextBuilderDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly agentLoader: () => AgentLoader;
  readonly sessionLoader: () => SessionLoader;
  readonly environmentReader: () => EnvironmentReader;
  readonly environmentResolution: RuntimeResolutionService;
  readonly executionContextCreator: () => ExecutionContextCreator;
  /**
   * The server's own delete of a context, through its delete chain: the
   * recover step removes the interrupted run's stale context with it
   * before recreating one (stigmer#1647).
   */
  readonly executionContextDeleter: () => ExecutionContextDeleter;
  readonly managedEnvService: ManagedEnvironmentService;
  /**
   * The PlatformClient port the minting client's environment layer reads
   * (4.7). The port, not the Store: a composition may keep client rows in
   * a table of its own (domain/platformclient/store.ts).
   */
  readonly platformClients: Pick<PlatformClientStore, "findById">;
  /** Test seam forwarded to the OAuth token-endpoint refresh. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * CreateExecutionContext — the create pipeline's step: runs the shared
 * builder, then clears the consumed runtime_env from the execution — a
 * create-only concern (recover has no runtime_env to clear). Clearing
 * ensures secrets never appear in the persisted execution or in Temporal
 * workflow history.
 */
export function newCreateExecutionContextStep(
  deps: ExecutionContextBuilderDeps,
): PipelineStep<typeof AgentExecutionSchema> {
  return {
    name: "CreateExecutionContext",
    async execute(ctx) {
      const execution = ctx.newState;

      await buildAndPersistExecutionContext(deps, execution);

      if (Object.keys(execution.spec?.runtimeEnv ?? {}).length > 0) {
        deps.logger.debug(
          "Clearing runtime_env from execution (consumed into ExecutionContext)",
          {
            executionId: execution.metadata?.id ?? "",
            clearedEntries: Object.keys(execution.spec?.runtimeEnv ?? {})
              .length,
          },
        );
        const spec = (execution.spec ??= create(AgentExecutionSpecSchema));
        spec.runtimeEnv = {};
      }
    },
  };
}

/**
 * Resolves the environment for the execution and persists a fresh
 * ExecutionContext (Go buildAndPersist), via the execution's session_id
 * and its agent stamp — the same inputs on create and on recover. Failures
 * throw — the create pipeline surfaces them as-is; the wrapping context
 * matches Go's %w chains in the logged (never wire) message.
 */
export async function buildAndPersistExecutionContext(
  deps: ExecutionContextBuilderDeps,
  execution: AgentExecution,
): Promise<void> {
  const executionId = execution.metadata?.id ?? "";
  const executionOrg = execution.metadata?.org ?? "";

  // 1. The session: its workspace entries and its own MCP servers shape
  // the environment below.
  let session: Session;
  try {
    session = await loadRunSession(deps, execution);
  } catch (error) {
    chainError("resolve session", error);
  }

  // 2. The agent's spec (env declarations, MCP usages) at the version the
  // turn recorded — in-process, full chain traversal. The agent is the
  // recorded one even if the session has since been moved to another
  // agent or to the built-in assistant: the runner runs the recorded
  // agent, so the context declares for it too. Load failures keep the
  // inner status code with Go's wrap prefix. None for a turn of the
  // built-in assistant.
  const agentId = execution.status?.agentId ?? "";
  let agentSpec: AgentSpec | undefined;
  if (agentId !== "") {
    agentSpec = await loadRunAgentSpec(
      deps,
      agentId,
      execution.status?.agentVersionHash ?? "",
    );
  }
  const sessionMcpServers = await loadSessionMcpServers(
    deps,
    session,
    executionOrg,
  );

  // 3. Schedule-created executions: the schedule's own environment_refs
  // (the AgentShare/AgentChannel layering). This is how a tool-using agent
  // becomes schedulable: the schedule binds the credentials its
  // unattended runs need without touching the agent.
  let environments = await resolveScheduleEnvironments(deps, execution);

  // 4. Workflow-created executions (agent_call): the task's own
  // environment_refs, the same layering — fourth in the
  // share/channel/schedule lineage (issue #358). At most one of 3 and 4
  // applies: an execution is created by a schedule fire or by a workflow
  // task, never both.
  const workflowEnvironments = await resolveWorkflowTaskEnvironments(
    deps,
    execution,
  );
  if (workflowEnvironments.length > 0) {
    environments = [...workflowEnvironments, ...environments];
  }

  // 4.5 PlatformClient-minted executions: the minting client's own
  // environment_refs, BELOW every other layer — the fifth application of
  // the connection-resource mechanism (#381, restored by #1256). The key
  // is the execution's audit created_by, which the server stamped from
  // the verified token, so it holds on recover, where no minted caller
  // exists. Independent of 4.5/4.6: a minted user's own turn carries no
  // schedule or workflow provenance, and a fire or a workflow task stamps
  // no minted actor.
  const platformClientEnvironments = await resolvePlatformClientEnvironments(
    deps,
    execution,
  );
  if (platformClientEnvironments.length > 0) {
    environments = [...platformClientEnvironments, ...environments];
  }

  // 5. Merge all layers.
  const merged = mergeEnvironmentLayers(
    environments,
    execution.spec?.runtimeEnv ?? {},
  );

  // 6. Least-privilege whitelist over the ONE declared set: the agent's
  // env united with the session servers' env (the module header's rule).
  // Empty declarations pass everything through.
  const declarations = unionDeclarations(
    agentSpec?.env ?? {},
    sessionMcpServers,
  );
  const filterResult = filterByDeclaredKeys(merged, declarations);
  let filtered = filterResult.filtered;
  if (filterResult.excludedKeys.length > 0) {
    deps.logger.warn("Filtered env vars not declared by the agent or the session's servers", {
      executionId,
      agentId,
      excludedKeys: filterResult.excludedKeys,
    });
  }

  // 6.5 Re-inject workspace-provisioning keys excluded by the filter,
  // and fall back to the run's person's personal environment for keys
  // never in the merge chain at all.
  const person = runPersonOf(execution);
  if (person === undefined) {
    deps.logger.info(
      "Run has no person; personal environment not consulted",
      { executionId },
    );
  }
  filtered = injectWorkspaceProvisioningKeys(
    deps.logger,
    filtered,
    merged,
    session,
    executionId,
  );
  filtered = await injectFromPersonalEnvironment(
    deps,
    filtered,
    session,
    executionOrg,
    person,
    executionId,
  );

  // 6.8 Inject OAuth tokens from managed environments — iterated
  // over the merged agent + session MCP usages so session-level servers
  // (added at runtime) get their tokens too. Refresh failures are FATAL
  // (FailedPrecondition): an expired token must prevent execution rather
  // than fail opaquely mid-run with a 401.
  const mergedMcpUsages = mergeAgentAndSessionMcpUsages(
    agentSpec,
    session,
  );
  const oauthTargets = new Set<string>();
  try {
    filtered = await injectMcpOAuthFromManagedEnvironment(
      deps,
      filtered,
      mergedMcpUsages,
      executionOrg,
      executionId,
      oauthTargets,
    );
  } catch (error) {
    throw failedPreconditionError(
      error instanceof Error ? error.message : String(error),
    );
  }

  // 6.85 The run's declared variables the layers did not carry, the
  // agent's and the session servers' alike: the run's person's personal
  // environment, by declared key, after every layer. Never an OAuth
  // target of any server the run uses (the managed grant's alone), and
  // never a key an agent of another organization declares. Non-fatal —
  // the run fails at the tool with a clearer error if a key is truly
  // required, the posture of every fallback here.
  for (const server of sessionMcpServers) {
    const target = server.spec?.auth?.targetEnvVar ?? "";
    if (target !== "") {
      oauthTargets.add(target);
    }
  }
  filtered = await injectDeclaredFromPersonalEnvironment(
    deps,
    filtered,
    declarations,
    {
      oauthTargets,
      agentId,
      agentEnv: agentSpec?.env ?? {},
    },
    executionOrg,
    person,
    executionId,
  );

  // 6.9 Warn on missing required declared vars — the downstream
  // execution fails with a clearer error if truly needed.
  const missingRequired = validateRequiredKeys(filtered, declarations);
  if (missingRequired.length > 0) {
    deps.logger.warn(
      "Required env vars missing after environment merge — execution may fail",
      { executionId, agentId, missingRequired },
    );
  }

  deps.logger.info("Merged environment layers for execution context", {
    executionId,
    mergedCount: merged.size,
    filteredCount: filtered.size,
    environmentLayerCount: environments.length,
    builtInAssistant: agentId === "",
  });

  // 7. Build and persist the ExecutionContext through the in-process
  // client (the executioncontext create pipeline owns encryption,
  // ciphertext rejection, and indexing).
  const ec = create(ExecutionContextSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "ExecutionContext",
    metadata: {
      name: `exec-ctx-${executionId}`,
      org: executionOrg,
    },
    spec: {
      executionId,
      data: Object.fromEntries(filtered),
    },
  });
  let created: ExecutionContext;
  try {
    created = await deps.executionContextCreator().create(ec);
  } catch (error) {
    if (error instanceof ConnectError) {
      throw goWrappedStatusError(
        `create execution context for ${executionId}`,
        error,
      );
    }
    chainError(`create execution context for ${executionId}`, error);
  }

  deps.logger.info("Successfully created execution context", {
    executionContextId: created.metadata?.id ?? "",
    executionId,
    dataEntries: filtered.size,
  });
}

/**
 * Go's %w wrap chains, mirrored: the INNERMOST status boundary renders
 * through goWrappedStatusError ("prefix: rpc error: code = X desc = …");
 * every OUTER wrap prepends plain text while preserving the inner code —
 * exactly how nested fmt.Errorf("%s: %w") chains reach the wire through
 * the pipeline's errors.As branch (the #852 leak). Plain errors chain as
 * plain errors and land on the pipeline's Internal fallback, Go's
 * non-status path.
 */
function chainError(prefix: string, error: unknown): never {
  if (error instanceof ConnectError) {
    throw new ConnectError(`${prefix}: ${error.rawMessage}`, error.code);
  }
  throw new Error(
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * The run's session, by the execution's session_id. A persisted execution
 * always carries one (CreateSessionIfNeeded gives every turn its session,
 * and lifecycle.ts recover reads persisted turns), so the no-session arm
 * is an invariant, not a shape.
 */
async function loadRunSession(
  deps: ExecutionContextBuilderDeps,
  execution: AgentExecution,
): Promise<Session> {
  const sessionId = sessionIdOf(execution.spec);
  if (sessionId === "") {
    throw new Error("no session_id on execution");
  }
  let session: Session;
  try {
    session = await deps.sessionLoader().get(sessionId);
  } catch (error) {
    if (error instanceof ConnectError) {
      throw goWrappedStatusError(`load session ${sessionId}`, error);
    }
    throw new Error(
      `load session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return session;
}

/**
 * The spec of the agent a turn runs: the recorded version's snapshot when
 * the turn recorded one, else the agent as it is now. Failures keep the
 * inner status code with Go's wrap prefix, naming the version when one was
 * recorded.
 */
async function loadRunAgentSpec(
  deps: ExecutionContextBuilderDeps,
  agentId: string,
  versionHash: string,
): Promise<AgentSpec | undefined> {
  if (versionHash === "") {
    try {
      return (await deps.agentLoader().get(agentId)).spec;
    } catch (error) {
      if (error instanceof ConnectError) {
        throw goWrappedStatusError(`load agent ${agentId}`, error);
      }
      chainError(`load agent ${agentId}`, error);
    }
  }
  try {
    return (await deps.agentLoader().getVersion(agentId, versionHash))
      .specSnapshot;
  } catch (error) {
    const what = `load agent ${agentId} at the version this turn recorded (${versionHash})`;
    if (error instanceof ConnectError) {
      throw goWrappedStatusError(what, error);
    }
    chainError(what, error);
  }
}

/**
 * Loads the MCP servers a session declares on its own (spec.mcp_server_usages),
 * by slug in the usage's org or the execution's. A server that cannot be
 * found is skipped: the runner resolves the same usages for real and
 * refuses there with the tool's own error; this pass only needs the
 * declarations of the servers that exist.
 */
async function loadSessionMcpServers(
  deps: ExecutionContextBuilderDeps,
  session: Session | undefined,
  executionOrg: string,
): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  for (const usage of session?.spec?.mcpServerUsages ?? []) {
    const slug = usage.mcpServerRef?.slug ?? "";
    const org = usage.mcpServerRef?.org || executionOrg;
    if (slug === "" || org === "") {
      continue;
    }
    let server: McpServer | undefined;
    try {
      server = await findResourceBySlug(
        deps.store,
        ApiResourceKind.mcp_server,
        McpServerSchema,
        slug,
        org,
      );
    } catch {
      continue;
    }
    if (server !== undefined) {
      servers.push(server);
    }
  }
  return servers;
}

/**
 * The one declared set of a run: the agent's env declarations united with
 * every session server's. On a key both declare, the agent's declaration
 * wins (it is the author's word for the run as a whole; the server's is
 * the tool's word for itself).
 */
function unionDeclarations(
  agentEnv: { readonly [key: string]: EnvVarDeclaration },
  sessionMcpServers: readonly McpServer[],
): { [key: string]: EnvVarDeclaration } {
  const union: { [key: string]: EnvVarDeclaration } = {};
  for (const server of sessionMcpServers) {
    Object.assign(union, server.spec?.env ?? {});
  }
  Object.assign(union, agentEnv);
  return union;
}

/** What the personal-environment fill must leave alone. */
interface PersonalFillLimits {
  /** Every OAuth target variable of a server the run uses: the managed grant's alone. */
  readonly oauthTargets: ReadonlySet<string>;
  /** The run's agent ("" for the built-in assistant). */
  readonly agentId: string;
  /** The keys that agent declares, at the version the run records. */
  readonly agentEnv: { readonly [key: string]: EnvVarDeclaration };
}

/**
 * Resolves the run's declared variables still missing after every layer
 * and the OAuth injection — the agent's and its session servers' (the one
 * declared set, unionDeclarations) — from the run's person's personal
 * environment, by the one rule every run shares
 * (environment/personal.ts `fillDeclaredFromPersonalEnvironment`). Left
 * alone: every OAuth-target variable of a server the run uses, the
 * agent's and the session's (an absent grant is the sign-in the console
 * asks for, not a personal-environment lookup), and every key the agent
 * declares when the agent belongs to another organization than the run.
 */
async function injectDeclaredFromPersonalEnvironment(
  deps: ExecutionContextBuilderDeps,
  filtered: Map<string, ExecutionValue>,
  declarations: { readonly [key: string]: EnvVarDeclaration },
  limits: PersonalFillLimits,
  executionOrg: string,
  person: string | undefined,
  executionId: string,
): Promise<Map<string, ExecutionValue>> {
  return fillDeclaredFromPersonalEnvironment(
    deps.environmentReader(),
    deps.store,
    deps.logger,
    filtered,
    {
      declarations,
      exclude: limits.oauthTargets,
      owner: {
        noun: "agent",
        id: limits.agentId,
        declares: limits.agentEnv,
        orgOf: () => agentOrgOf(deps, limits.agentId),
      },
      executionOrg,
      person,
      executionId,
    },
  );
}

/**
 * The organization an agent belongs to, or "" when it cannot be read. Only
 * asked for an agent that declares keys, so never for the built-in
 * assistant.
 */
async function agentOrgOf(
  deps: ExecutionContextBuilderDeps,
  agentId: string,
): Promise<string> {
  try {
    return (await deps.agentLoader().get(agentId)).metadata?.org ?? "";
  } catch {
    return "";
  }
}

/**
 * Fetches each referenced Environment in order via the runtime-resolution
 * service, NOT the GetByReference RPC: the RPC surface redacts secret
 * values (oss#405); this internal path returns them decrypted for the
 * execution-context merge. An unresolvable ref fails the create — an
 * authoring error must surface as a deterministic refusal, never a silent
 * run without credentials.
 */
async function resolveEnvironments(
  deps: ExecutionContextBuilderDeps,
  refs: ApiResourceReference[],
): Promise<Environment[]> {
  if (refs.length === 0) {
    return [];
  }
  const environments: Environment[] = [];
  for (const ref of refs) {
    try {
      environments.push(await deps.environmentResolution.resolveByReference(ref));
    } catch (error) {
      // The resolution service throws typed statuses (NotFound for a
      // deleted environment) — the inner code must reach the wire so a
      // caller-fixable authoring error never masquerades as a 500.
      if (error instanceof ConnectError) {
        throw goWrappedStatusError(
          `resolve environment ref (org=${ref.org}, slug=${ref.slug})`,
          error,
        );
      }
      chainError(
        `resolve environment ref (org=${ref.org}, slug=${ref.slug})`,
        error,
      );
    }
  }
  return environments;
}

/**
 * Resolves the environment_refs of the schedule that created this
 * execution (the stigmer.ai/schedule-id label). No label — the common
 * case — answers empty at the cost of one map lookup; a DELETED schedule
 * degrades to no schedule environments; an unresolvable REF fails the
 * create (Go resolveScheduleEnvironments).
 */
async function resolveScheduleEnvironments(
  deps: ExecutionContextBuilderDeps,
  execution: AgentExecution,
): Promise<Environment[]> {
  const scheduleId =
    execution.metadata?.labels[SCHEDULE_ID_LABEL_KEY] ?? "";
  if (scheduleId === "") {
    return [];
  }

  let schedule;
  try {
    schedule = await deps.store.getResource(
      ApiResourceKind.schedule,
      scheduleId,
      ScheduleSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      deps.logger.warn(
        "Schedule-labeled execution's schedule row is gone — running without schedule environments",
        { scheduleId, executionId: execution.metadata?.id ?? "" },
      );
      return [];
    }
    throw new Error(
      `load schedule ${scheduleId} for environment resolution: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const target = schedule.spec?.target;
  const refs =
    target?.case === "agent" ? (target.value.environmentRefs ?? []) : [];
  if (refs.length === 0) {
    return [];
  }

  // A manifest ref may omit the org (relative to the schedule's own —
  // the same-org invariant pins agent_ref.org == metadata.org).
  const resolved = refs.map((ref) =>
    ref.org === ""
      ? create(ApiResourceReferenceSchema, {
          kind: ref.kind,
          org: schedule.metadata?.org ?? "",
          slug: ref.slug,
        })
      : ref,
  );

  try {
    return await resolveEnvironments(deps, resolved);
  } catch (error) {
    chainError(`resolve schedule ${scheduleId} environment_refs`, error);
  }
}

/**
 * Resolves the environment_refs of the PlatformClient whose minted user
 * created this execution (its audit created_by.platform_client_id, stamped
 * by the server from the verified token). No minting client — every
 * execution not created by a minted user — answers empty without a read.
 * A DELETED client degrades to no client environments (the schedule
 * layer's posture; its tokens are already refused). A client of another
 * organization than the execution's contributes nothing: no environment
 * value crosses an organization, the run-time twin of the reference
 * rule's cross-organization clause (pipeline/steps/references.ts). An
 * expired client still contributes: expiry stops minting, not the tokens
 * already minted. Environment visibility is not consulted, as for every
 * layer (the reference rule's reasoning: the server resolves the
 * environment on the run's behalf). An unresolvable REF fails the create.
 */
async function resolvePlatformClientEnvironments(
  deps: ExecutionContextBuilderDeps,
  execution: AgentExecution,
): Promise<Environment[]> {
  const platformClientId =
    execution.status?.audit?.specAudit?.createdBy?.platformClientId ?? "";
  if (platformClientId === "") {
    return [];
  }
  const executionId = execution.metadata?.id ?? "";

  let client;
  try {
    client = await deps.platformClients.findById(platformClientId);
  } catch (error) {
    throw new Error(
      `load platform client ${platformClientId} for environment resolution: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (client === undefined) {
    deps.logger.warn(
      "Minting platform client is gone — running without its environments",
      { platformClientId, executionId },
    );
    return [];
  }

  const clientOrg = client.metadata?.org ?? "";
  const executionOrg = execution.metadata?.org ?? "";
  if (clientOrg !== executionOrg) {
    deps.logger.warn(
      "Minting platform client belongs to another organization — its environments are not delivered",
      { platformClientId, clientOrg, executionOrg, executionId },
    );
    return [];
  }

  const refs = client.spec?.environmentRefs ?? [];
  if (refs.length === 0) {
    return [];
  }
  // Stored refs are absolute (NormalizeReferences on the client's writes);
  // an empty org is filled from the client's own, as the schedule layer
  // does for its manifest refs.
  const resolved = refs.map((ref) =>
    ref.org === ""
      ? create(ApiResourceReferenceSchema, {
          kind: ref.kind,
          org: clientOrg,
          slug: ref.slug,
        })
      : ref,
  );

  try {
    return await resolveEnvironments(deps, resolved);
  } catch (error) {
    chainError(
      `resolve platform client ${platformClientId} environment_refs`,
      error,
    );
  }
}

/**
 * Resolves the environment_refs of the agent_call step that created this
 * execution (the workflow-provenance labels), read from the workflow
 * version the workflow run pinned (`status.workflow_version_hash`), never
 * the head, so an author's edit after the run started never changes what
 * a running step receives (stigmer#1906). A version covers every step's
 * environment_refs (the workflow's version hash is its whole spec's), and
 * the step is found at any depth by its name, which save keeps unique
 * across the workflow (domain/workflow/validation/agent-call-steps.ts). A
 * run with no pin (a workflow saved before versioning) reads the head, as
 * the runner's hydrate does.
 *
 * Missing labels — every non-workflow execution — answer empty; a deleted
 * workflow execution or workflow, or a step the version does not hold,
 * degrades to no workflow environments. A pinned version the workflow no
 * longer holds fails the create naming it, as the runner fails the run:
 * the step is never handed another version's keys. An unresolvable REF
 * fails the create.
 */
async function resolveWorkflowTaskEnvironments(
  deps: ExecutionContextBuilderDeps,
  execution: AgentExecution,
): Promise<Environment[]> {
  const labels = execution.metadata?.labels ?? {};
  const workflowExecutionId = labels[WORKFLOW_EXECUTION_ID_LABEL_KEY] ?? "";
  const taskName = labels[WORKFLOW_TASK_LABEL_KEY] ?? "";
  if (workflowExecutionId === "" || taskName === "") {
    return [];
  }
  const executionId = execution.metadata?.id ?? "";

  let workflowExecution;
  try {
    workflowExecution = await deps.store.getResource(
      ApiResourceKind.workflow_execution,
      workflowExecutionId,
      WorkflowExecutionSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      deps.logger.warn(
        "Workflow-labeled execution's workflow execution row is gone — running without workflow environments",
        { workflowExecutionId, executionId },
      );
      return [];
    }
    throw new Error(
      `load workflow execution ${workflowExecutionId} for environment resolution: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const workflowId = workflowExecution.spec?.workflowId ?? "";
  if (workflowId === "") {
    return [];
  }
  const workflow = await loadPinnedWorkflow(
    deps,
    workflowId,
    workflowExecution.status?.workflowVersionHash ?? "",
    executionId,
  );
  if (workflow === undefined) {
    return [];
  }

  const refs = agentCallTaskEnvironmentRefs(deps.logger, workflow, taskName);
  if (refs.length === 0) {
    return [];
  }

  // A ref may omit the org (relative form); resolution follows the
  // workflow's org — also the execution's billing org.
  const resolved = refs.map((ref) =>
    ref.org === ""
      ? create(ApiResourceReferenceSchema, {
          kind: ref.kind,
          org: workflow.metadata?.org ?? "",
          slug: ref.slug,
        })
      : ref,
  );

  try {
    return await resolveEnvironments(deps, resolved);
  } catch (error) {
    chainError(
      `resolve workflow ${workflowId} task "${taskName}" environment_refs`,
      error,
    );
  }
}

/**
 * The workflow as the run pinned it: the version `versionHash` names
 * (version-history.ts `loadVersion`, getVersion's own reader), or the head
 * when the run pinned none. Undefined when the workflow is gone (the
 * degrade case); a pinned version the live workflow no longer holds is
 * FAILED_PRECONDITION naming it; a store fault is Internal.
 */
export async function loadPinnedWorkflow(
  deps: Pick<ExecutionContextBuilderDeps, "store" | "logger">,
  workflowId: string,
  versionHash: string,
  executionId: string,
): Promise<Workflow | undefined> {
  try {
    if (versionHash === "") {
      return await deps.store.getResource(
        ApiResourceKind.workflow,
        workflowId,
        WorkflowSchema,
      );
    }
    return (
      await loadVersion(deps.store, workflowVersionBinding, workflowId, versionHash)
    ).resource;
  } catch (error) {
    const notFound =
      error instanceof ResourceNotFoundError ||
      (error instanceof ConnectError && error.code === Code.NotFound);
    if (!notFound) {
      throw new Error(
        `load workflow ${workflowId} for environment resolution: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (versionHash !== "" && (await workflowExists(deps, workflowId))) {
      throw failedPreconditionError(
        `workflow ${workflowId} no longer holds version ${truncateHash(versionHash)}, the version its run started on`,
      );
    }
    deps.logger.warn(
      "Workflow-labeled execution's workflow row is gone — running without workflow environments",
      { workflowId, executionId },
    );
    return undefined;
  }
}

/** Whether the workflow's row exists; a store fault is Internal. */
async function workflowExists(
  deps: Pick<ExecutionContextBuilderDeps, "store">,
  workflowId: string,
): Promise<boolean> {
  try {
    await deps.store.getResource(
      ApiResourceKind.workflow,
      workflowId,
      WorkflowSchema,
    );
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return false;
    }
    throw internalError(error, `failed to load workflow ${workflowId}`);
  }
}

/**
 * The environment_refs of the agent_call step named `taskName`, found at
 * any depth of the workflow (nested lists and compensate included). A
 * missing or renamed step answers empty: the binding no longer exists in
 * this version, the degrade-not-fail case. A version saved before step
 * names were unique may hold several: the first in walk order answers,
 * and the duplicate is logged.
 */
export function agentCallTaskEnvironmentRefs(
  logger: Logger,
  workflow: Workflow,
  taskName: string,
): ApiResourceReference[] {
  const { step, matches } = findAgentCallStep(workflow.spec, taskName);
  if (matches > 1) {
    logger.warn(
      "Workflow version holds several agent_call steps of one name — reading the first",
      { workflowId: workflow.metadata?.id ?? "", taskName, matches },
    );
  }
  return step?.config.environmentRefs ?? [];
}

/**
 * Re-injects provisioning keys excluded by the declared-key filter, only
 * when the session actually has git_repo workspace entries (Go
 * injectWorkspaceProvisioningKeys; the copy-on-write is preserved so the
 * caller's maps are never mutated).
 */
function injectWorkspaceProvisioningKeys(
  logger: Logger,
  filtered: Map<string, ExecutionValue>,
  merged: Map<string, ExecutionValue>,
  session: Session,
  executionId: string,
): Map<string, ExecutionValue> {
  const hasGitRepo = (session.spec?.workspaceEntries ?? []).some(
    (entry) => entry.source?.source.case === "gitRepo",
  );
  if (!hasGitRepo) {
    return filtered;
  }

  let out = filtered;
  let injected = false;
  for (const key of WORKSPACE_PROVISIONING_KEYS) {
    if (out.has(key)) {
      continue;
    }
    const val = merged.get(key);
    if (val === undefined) {
      continue;
    }
    if (!injected) {
      out = new Map(out);
      injected = true;
    }
    out.set(key, val);
    logger.info(
      "Re-injected workspace-provisioning key after env_spec filter (session has git_repo entries)",
      { executionId, key },
    );
  }
  return out;
}

/**
 * The fallback for provisioning keys absent from the merge chain
 * entirely: the run's person's personal environment, through the one
 * lookup every personal read shares (domain/environment/personal.ts), each
 * key optional. Only when the session actually has git_repo workspace
 * entries, and never for a run with no person. ALL failures are non-fatal
 * — the downstream git clone fails with a clear auth error if the token
 * is truly required (Go injectFromPersonalEnvironment).
 */
async function injectFromPersonalEnvironment(
  deps: ExecutionContextBuilderDeps,
  filtered: Map<string, ExecutionValue>,
  session: Session,
  executionOrg: string,
  person: string | undefined,
  executionId: string,
): Promise<Map<string, ExecutionValue>> {
  const hasGitRepo = (session.spec?.workspaceEntries ?? []).some(
    (entry) => entry.source?.source.case === "gitRepo",
  );
  if (!hasGitRepo || person === undefined) {
    return filtered;
  }

  const wanted: { [key: string]: EnvVarDeclaration } = {};
  for (const key of WORKSPACE_PROVISIONING_KEYS) {
    if (!filtered.has(key)) {
      wanted[key] = create(EnvVarDeclarationSchema, {
        isSecret: true,
        optional: true,
      });
    }
  }
  if (Object.keys(wanted).length === 0) {
    return filtered;
  }

  let resolution: PersonalEnvironmentResolution;
  try {
    resolution = await resolveDeclaredFromPersonalEnvironment(
      deps.environmentReader(),
      deps.store,
      deps.logger,
      executionOrg,
      person,
      wanted,
    );
  } catch (error) {
    deps.logger.warn(
      "Failed to resolve provisioning keys from the personal environment (non-fatal)",
      {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return filtered;
  }
  if (resolution.kind === "no-personal-environment") {
    deps.logger.debug(
      "No personal environment for the run's person — skipping provisioning key injection",
      { executionId, org: executionOrg },
    );
    return filtered;
  }
  const entries = Object.entries(resolution.values);
  if (entries.length === 0) {
    return filtered;
  }
  const out = new Map(filtered);
  for (const [key, value] of entries) {
    out.set(key, value);
    deps.logger.info(
      "Injected workspace-provisioning key from the run's person's personal environment",
      { executionId, key },
    );
  }
  return out;
}

/**
 * Combines MCP server usages from the agent and session, deduplicating by
 * slug with agent-level usages taking priority — so servers added at the
 * session level (e.g. via the UI at runtime) are included in OAuth token
 * injection too (Go mergeAgentAndSessionMcpUsages).
 */
export function mergeAgentAndSessionMcpUsages(
  agentSpec: AgentSpec | undefined,
  session: Session | undefined,
): McpServerUsage[] {
  const merged = new Map<string, McpServerUsage>();
  // Session usages first (lower priority).
  for (const usage of session?.spec?.mcpServerUsages ?? []) {
    const slug = usage.mcpServerRef?.slug ?? "";
    if (slug !== "") {
      merged.set(slug, usage);
    }
  }
  // Agent usages override (higher priority).
  for (const usage of agentSpec?.mcpServerUsages ?? []) {
    const slug = usage.mcpServerRef?.slug ?? "";
    if (slug !== "") {
      merged.set(slug, usage);
    }
  }
  return [...merged.values()];
}

/**
 * Reads OAuth-managed access tokens from managed environments for MCP
 * servers with spec.auth (recording each such server's target variable in
 * `oauthTargets`, grant or none, for the personal-environment fill to
 * leave alone): grant lookup by (identity="", server_id, org) —
 * OSS single-user — then inline pre-flight refresh if expired, then the
 * token read. Refresh failures THROW (fatal; the caller maps to
 * FailedPrecondition); read failures are non-fatal skips (Go
 * injectMcpOAuthFromManagedEnvironment).
 */
async function injectMcpOAuthFromManagedEnvironment(
  deps: ExecutionContextBuilderDeps,
  filtered: Map<string, ExecutionValue>,
  mcpServerUsages: McpServerUsage[],
  executionOrg: string,
  executionId: string,
  oauthTargets?: Set<string>,
): Promise<Map<string, ExecutionValue>> {
  if (mcpServerUsages.length === 0) {
    return filtered;
  }

  let out = filtered;
  let injected = false;
  for (const usage of mcpServerUsages) {
    const ref = usage.mcpServerRef;
    const slug = ref?.slug ?? "";
    if (slug === "") {
      continue;
    }
    let serverOrg = ref?.org ?? "";
    if (serverOrg === "") {
      serverOrg = executionOrg;
    }
    if (serverOrg === "") {
      continue;
    }

    let mcpServer;
    try {
      mcpServer = await findResourceBySlug(
        deps.store,
        ApiResourceKind.mcp_server,
        McpServerSchema,
        slug,
        serverOrg,
      );
    } catch {
      continue;
    }
    if (mcpServer === undefined || mcpServer.spec?.auth === undefined) {
      continue;
    }
    const target = mcpServer.spec.auth.targetEnvVar;
    if (target !== "") {
      oauthTargets?.add(target);
    }

    const mcpServerId = mcpServer.metadata?.id ?? "";
    const grant = await deps.store.oauthGrants
      .find("", mcpServerId, serverOrg)
      .catch(() => undefined);
    if (grant === undefined) {
      continue;
    }

    const oauthKey = grant.accessTokenEnvVar;
    if (oauthKey === "") {
      continue;
    }
    if (out.has(oauthKey)) {
      continue;
    }

    const managedEnvId = grant.environmentId;
    if (managedEnvId === "") {
      deps.logger.warn(
        "OAuth grant has no managed environment ID — skipping token injection",
        { mcpServerId, executionId },
      );
      continue;
    }

    // Inline pre-flight refresh if expired; failures are fatal — an
    // expired token must not be silently injected.
    let refreshResult;
    try {
      refreshResult = await inlineRefreshIfExpired(deps, grant, managedEnvId);
    } catch (error) {
      throw new Error(
        `OAuth token refresh failed for MCP server '${mcpServerId}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (refreshResult !== undefined && refreshResult.refreshed) {
      try {
        await deps.store.oauthGrants.upsert({
          ...grant,
          accessTokenExpiresAt: refreshResult.newExpiresAt,
        });
      } catch (error) {
        deps.logger.warn(
          "Failed to update OAuth grant after inline refresh (non-fatal)",
          {
            mcpServerId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    let tokenValue: string;
    try {
      tokenValue = await deps.managedEnvService.readSecretValue(
        managedEnvId,
        oauthKey,
      );
    } catch (error) {
      deps.logger.warn(
        "Failed to read OAuth token from managed environment (non-fatal)",
        {
          mcpServerId,
          oauthKey,
          managedEnvId,
          executionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      continue;
    }
    if (tokenValue === "") {
      deps.logger.warn(
        "Failed to read OAuth token from managed environment (non-fatal)",
        { mcpServerId, oauthKey, managedEnvId, executionId },
      );
      continue;
    }

    if (!injected) {
      out = new Map(out);
      injected = true;
    }
    out.set(
      oauthKey,
      create(ExecutionValueSchema, { value: tokenValue, isSecret: true }),
    );
    deps.logger.info("Injected OAuth token from managed environment", {
      executionId,
      mcpServerId,
      oauthKey,
      managedEnvId,
    });
  }
  return out;
}

/**
 * Reads the refresh token from the managed environment and refreshes if
 * the access token is expired; undefined when the refresh token is
 * unavailable (Go inlineRefreshIfExpired). No client_secret resolution on
 * this path — DCR/public clients work without it, and vendor OAuth's
 * connect pre-flight owns the OAuthApp lookup; no secret means no
 * token-endpoint auth method either.
 */
async function inlineRefreshIfExpired(
  deps: ExecutionContextBuilderDeps,
  grant: OAuthGrant,
  managedEnvId: string,
): Promise<import("../mcpserver/oauth/refresh.js").RefreshResult | undefined> {
  let currentRefreshToken: string;
  try {
    currentRefreshToken = await deps.managedEnvService.readSecretValue(
      managedEnvId,
      grant.refreshTokenEnvVar,
    );
  } catch {
    return undefined;
  }
  if (currentRefreshToken === "") {
    return undefined;
  }

  const result = await refreshTokenIfExpired(
    grant,
    currentRefreshToken,
    "",
    "",
    deps.logger,
    deps.fetchImpl ?? fetch,
  );
  if (!result.refreshed) {
    return result;
  }

  const tokenVariables: { [key: string]: EnvironmentValue } = {
    [grant.accessTokenEnvVar]: create(EnvironmentValueSchema, {
      value: result.newAccessToken,
      isSecret: true,
    }),
  };
  if (result.newRefreshToken !== currentRefreshToken) {
    tokenVariables[grant.refreshTokenEnvVar] = create(EnvironmentValueSchema, {
      value: result.newRefreshToken,
      isSecret: true,
    });
  }
  try {
    await deps.managedEnvService.updateSecrets(managedEnvId, tokenVariables);
  } catch (error) {
    throw new Error(
      `failed to write refreshed tokens to managed environment: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return result;
}
