/**
 * The ExecutionContext builder: resolves a run's values through the one
 * credential rule (domain/credential/resolve.ts) and persists them as the
 * run's ExecutionContext. Shared by the create pipeline
 * (newCreateExecutionContextStep) and the recover pipeline (lifecycle.ts's
 * recreate step): recovery rebuilds the context the failed run's cleanup
 * deleted, from the CURRENT credentials ("fix the key, then recover"), for
 * the person the run recorded at create, never the recoverer.
 *
 * The run's requirements, each with its declarer:
 *   - the agent's own `env`, at the version the turn recorded (the agent
 *     and version stamped by ResolveRunAgent, read through getVersion, so
 *     recovery after an author's edit rebuilds from the agent the turn
 *     ran); none for a turn of the built-in assistant;
 *   - each MCP server the agent or the session uses, with its own `env`
 *     and its sign-in (personal or the organization's) — a server that
 *     cannot be found is skipped here and refused by the runner, which
 *     resolves the same usages for real;
 *   - the git host of each workspace repository, with GITHUB_TOKEN,
 *     optional (a public repository needs no token).
 *
 * The run's person is the one its create recorded (run-credentials.ts);
 * a run with no person reads the surface that started it: the minting
 * platform client (audit stamp), or the schedule, share or channel its
 * lineage label names. Every input is read from the persisted run, never
 * from the request, so recovery resolves exactly what create resolved,
 * against today's credentials.
 *
 * A refusal (a required key nothing provides, an assignment whose writer
 * may no longer use its credential, two declarers disagreeing on one key)
 * fails the create with FailedPrecondition naming what to fix, instead of
 * a run that starts and fails halfway.
 */
import { create } from "@bufbuild/protobuf";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import type { CredentialAssignment } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSignIn } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ConnectError } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import type { ExecutionContextDeleter } from "../executioncontext/internal-delete.js";
import { goWrappedStatusError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { GIT_TOKEN_KEY, resolveCredentials } from "../credential/resolve.js";
import type {
  CredentialResolverDeps,
  Requirement,
  RunSurface,
} from "../credential/resolve.js";
import type { PlatformClientStore } from "../platformclient/store.js";

import type { AgentLoader } from "./create-steps.js";
import {
  CHANNEL_ID_LABEL_KEY,
  recordedPersonOf,
  SCHEDULE_ID_LABEL_KEY,
  SHARE_ID_LABEL_KEY,
} from "./run-credentials.js";
import { sessionIdOf } from "./target.js";

export { SCHEDULE_ID_LABEL_KEY };

// ---------------------------------------------------------------------------
// The narrow in-process edges the builder consumes (lazy providers).
// ---------------------------------------------------------------------------

export interface SessionLoader {
  get(sessionId: string): Promise<Session>;
}
export interface ExecutionContextCreator {
  create(ec: ExecutionContext): Promise<ExecutionContext>;
}

export interface ExecutionContextBuilderDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly agentLoader: () => AgentLoader;
  readonly sessionLoader: () => SessionLoader;
  readonly executionContextCreator: () => ExecutionContextCreator;
  /**
   * The server's own delete of a context, through its delete chain: the
   * recover step removes the interrupted run's stale context with it
   * before recreating one (stigmer#1647).
   */
  readonly executionContextDeleter: () => ExecutionContextDeleter;
  /** The one credential rule's dependencies (domain/credential/resolve.ts). */
  readonly credentials: CredentialResolverDeps;
  /**
   * The PlatformClient port the minting client's assignments are read
   * through. The port, not the Store: a composition may keep client rows
   * in a table of its own (domain/platformclient/store.ts).
   */
  readonly platformClients: Pick<PlatformClientStore, "findById">;
}

/**
 * CreateExecutionContext — the create pipeline's step: runs the shared
 * builder, then clears the consumed runtime_env from the run (a
 * create-only concern; recover has no runtime_env to clear), so secrets
 * never appear in the persisted run or in Temporal workflow history.
 */
export function newCreateExecutionContextStep(
  deps: ExecutionContextBuilderDeps,
): PipelineStep<typeof RunSchema> {
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
        const spec = (execution.spec ??= create(RunSpecSchema));
        spec.runtimeEnv = {};
      }
    },
  };
}

/**
 * Resolves the run's values and persists a fresh ExecutionContext, from
 * the persisted run alone — the same inputs on create and on recover.
 */
export async function buildAndPersistExecutionContext(
  deps: ExecutionContextBuilderDeps,
  execution: Run,
): Promise<void> {
  const executionId = execution.metadata?.id ?? "";
  const executionOrg = execution.metadata?.org ?? "";

  let session: Session;
  try {
    session = await loadRunSession(deps, execution);
  } catch (error) {
    chainError("resolve session", error);
  }

  const agentId = execution.status?.agentId ?? "";
  const agent =
    agentId === ""
      ? undefined
      : await loadRunAgent(deps, agentId, execution.status?.agentVersionHash ?? "");

  const servers = await loadMcpServers(
    deps,
    mergeAgentAndSessionMcpUsages(agent?.spec, session),
    executionOrg,
  );
  const requirements = runRequirements(agent, servers, session);
  const person = recordedPersonOf(execution);
  const surface = person === undefined ? await runSurface(deps, execution) : undefined;

  const values = await resolveCredentials(deps.credentials, {
    runId: executionId,
    org: executionOrg,
    person,
    runtimeEnv: execution.spec?.runtimeEnv ?? {},
    surface,
    requirements,
  });

  const ec = create(ExecutionContextSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "ExecutionContext",
    metadata: {
      name: `exec-ctx-${executionId}`,
      org: executionOrg,
    },
    spec: {
      executionId,
      data: Object.fromEntries(values),
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
    dataEntries: values.size,
    builtInAssistant: agentId === "",
  });
}

/**
 * Go's %w wrap chains, mirrored: the INNERMOST status boundary renders
 * through goWrappedStatusError; every OUTER wrap prepends plain text while
 * preserving the inner code. Plain errors chain as plain errors and land
 * on the pipeline's Internal fallback.
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
  execution: Run,
): Promise<Session> {
  const sessionId = sessionIdOf(execution.spec);
  if (sessionId === "") {
    throw new Error("no session_id on execution");
  }
  try {
    return await deps.sessionLoader().get(sessionId);
  } catch (error) {
    if (error instanceof ConnectError) {
      throw goWrappedStatusError(`load session ${sessionId}`, error);
    }
    throw new Error(
      `load session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The agent a turn runs: where it lives, and its spec at the recorded version. */
interface RunAgent {
  readonly org: string;
  readonly slug: string;
  readonly spec: AgentSpec | undefined;
}

/**
 * The agent a turn runs: its organization and slug from the agent as it
 * is now (the declarer a credential serves is named by them), and its
 * spec from the recorded version's snapshot when the turn recorded one.
 * Failures keep the inner status code with Go's wrap prefix, naming the
 * version when one was recorded.
 */
async function loadRunAgent(
  deps: ExecutionContextBuilderDeps,
  agentId: string,
  versionHash: string,
): Promise<RunAgent> {
  let current: Agent;
  try {
    current = await deps.agentLoader().get(agentId);
  } catch (error) {
    if (error instanceof ConnectError) {
      throw goWrappedStatusError(`load agent ${agentId}`, error);
    }
    chainError(`load agent ${agentId}`, error);
  }
  const org = current.metadata?.org ?? "";
  const slug = current.metadata?.slug ?? "";
  if (versionHash === "") {
    return { org, slug, spec: current.spec };
  }
  try {
    const version = await deps.agentLoader().getVersion(agentId, versionHash);
    return { org, slug, spec: version.specSnapshot };
  } catch (error) {
    const what = `load agent ${agentId} at the version this turn recorded (${versionHash})`;
    if (error instanceof ConnectError) {
      throw goWrappedStatusError(what, error);
    }
    chainError(what, error);
  }
}

/**
 * Combines MCP server usages from the agent and session, deduplicating by
 * slug with agent-level usages taking priority, so servers added at the
 * session level (e.g. via the UI at runtime) declare their requirements
 * too.
 */
export function mergeAgentAndSessionMcpUsages(
  agentSpec: AgentSpec | undefined,
  session: Session | undefined,
): McpServerUsage[] {
  const merged = new Map<string, McpServerUsage>();
  for (const usage of session?.spec?.mcpServerUsages ?? []) {
    const slug = usage.mcpServerRef?.slug ?? "";
    if (slug !== "") {
      merged.set(slug, usage);
    }
  }
  for (const usage of agentSpec?.mcpServerUsages ?? []) {
    const slug = usage.mcpServerRef?.slug ?? "";
    if (slug !== "") {
      merged.set(slug, usage);
    }
  }
  return [...merged.values()];
}

/**
 * The MCP servers a run uses, by slug in the usage's organization or the
 * run's. A server that cannot be found is skipped: the runner resolves
 * the same usages for real and refuses there with the tool's own error.
 */
async function loadMcpServers(
  deps: ExecutionContextBuilderDeps,
  usages: ReadonlyArray<McpServerUsage>,
  executionOrg: string,
): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  for (const usage of usages) {
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

/** Every requirement of the run, each with its declarer (the module header). */
export function runRequirements(
  agent: RunAgent | undefined,
  servers: ReadonlyArray<McpServer>,
  session: Session | undefined,
): Requirement[] {
  const requirements: Requirement[] = [];
  if (agent !== undefined) {
    for (const [key, declaration] of Object.entries(agent.spec?.env ?? {})) {
      requirements.push({
        declarer: { kind: "agent", org: agent.org, slug: agent.slug },
        key,
        declaration,
      });
    }
  }
  for (const server of servers) {
    for (const [key, declaration] of Object.entries(server.spec?.env ?? {})) {
      requirements.push({
        declarer: {
          kind: "mcp_server",
          id: server.metadata?.id ?? "",
          org: server.metadata?.org ?? "",
          slug: server.metadata?.slug ?? "",
          signIn:
            server.spec?.signIn ?? McpServerSignIn.unspecified,
        },
        key,
        declaration,
      });
    }
  }
  const hosts = new Set<string>();
  for (const entry of session?.spec?.workspaceEntries ?? []) {
    const source = entry.source?.source;
    if (source?.case !== "gitRepo") {
      continue;
    }
    const host = gitHostOf(source.value.url);
    if (host !== undefined && !hosts.has(host)) {
      hosts.add(host);
      requirements.push({
        declarer: { kind: "git_host", host },
        key: GIT_TOKEN_KEY,
        declaration: { isSecret: true, optional: true },
      });
    }
  }
  return requirements;
}

/** A repository URL's host, lowercased; undefined for one that does not parse. */
function gitHostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "" ? undefined : host;
  } catch {
    return undefined;
  }
}

/**
 * The surface that started a run with no person, from server-stamped
 * facts (run-credentials.ts): the minting platform client first, then the
 * schedule, share or channel its lineage label names. A surface that is
 * gone, or that belongs to another organization than the run, assigns
 * nothing: a run's values never cross organizations.
 */
async function runSurface(
  deps: ExecutionContextBuilderDeps,
  execution: Run,
): Promise<RunSurface | undefined> {
  const executionOrg = execution.metadata?.org ?? "";
  const executionId = execution.metadata?.id ?? "";
  const platformClientId =
    execution.status?.audit?.specAudit?.createdBy?.platformClientId ?? "";
  if (platformClientId !== "") {
    let client;
    try {
      client = await deps.platformClients.findById(platformClientId);
    } catch (error) {
      throw new Error(
        `load platform client ${platformClientId} for credential resolution: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (client === undefined || (client.metadata?.org ?? "") !== executionOrg) {
      deps.logger.warn(
        "The minting platform client is gone or belongs to another organization — no assignments delivered",
        { platformClientId, executionId },
      );
      return undefined;
    }
    return {
      noun: "platform client",
      id: platformClientId,
      assignments: client.spec?.credentials ?? [],
    };
  }

  const labels = execution.metadata?.labels ?? {};
  const scheduleId = labels[SCHEDULE_ID_LABEL_KEY] ?? "";
  if (scheduleId !== "") {
    const schedule = await surfaceRow(deps, ApiResourceKind.schedule, ScheduleSchema, scheduleId, execution);
    const target = schedule?.spec?.target;
    return surfaceOf(
      "schedule",
      scheduleId,
      schedule?.metadata?.org,
      executionOrg,
      target?.case === "agent" ? target.value.credentials : [],
    );
  }
  const shareId = labels[SHARE_ID_LABEL_KEY] ?? "";
  if (shareId !== "") {
    const share = await surfaceRow(deps, ApiResourceKind.agent_share, AgentShareSchema, shareId, execution);
    return surfaceOf("share link", shareId, share?.metadata?.org, executionOrg, share?.spec?.credentials ?? []);
  }
  const channelId = labels[CHANNEL_ID_LABEL_KEY] ?? "";
  if (channelId !== "") {
    const channel = await surfaceRow(deps, ApiResourceKind.agent_channel, AgentChannelSchema, channelId, execution);
    return surfaceOf("channel", channelId, channel?.metadata?.org, executionOrg, channel?.spec?.credentials ?? []);
  }
  return undefined;
}

function surfaceOf(
  noun: string,
  id: string,
  surfaceOrg: string | undefined,
  executionOrg: string,
  assignments: ReadonlyArray<CredentialAssignment>,
): RunSurface {
  return {
    noun,
    id,
    assignments: surfaceOrg === executionOrg ? assignments : [],
  };
}

/** A surface's row by id; undefined when it is gone (logged), a store fault thrown. */
async function surfaceRow<Desc extends DescMessage>(
  deps: ExecutionContextBuilderDeps,
  kind: ApiResourceKind,
  schema: Desc,
  id: string,
  execution: Run,
): Promise<MessageShape<Desc> | undefined> {
  try {
    return await deps.store.getResource(kind, id, schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      deps.logger.warn(
        "The surface that started this run is gone — no assignments delivered",
        { surface: ApiResourceKind[kind], id, executionId: execution.metadata?.id ?? "" },
      );
      return undefined;
    }
    throw new Error(
      `load ${ApiResourceKind[kind]} ${id} for credential resolution: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
