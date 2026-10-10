/**
 * The run's value planner: decides where every value a run needs lives
 * and records it on the run as its source manifest
 * (RunStatus.credentials.sources), which the runner fetches the values by
 * when the run's work starts (VaultValueController.fetchValues). Nothing
 * is written outside the run's own row, so a create that fails afterwards
 * leaves nothing behind, and no value is opened here.
 *
 * Shared by the create pipeline (newPlanRunValuesStep, before Persist) and
 * the recover pipeline (lifecycle.ts's re-plan step, which writes the new
 * manifest onto the stored run): planning again from the CURRENT vaults is
 * the desired semantics ("fix the API key, then recover"). The agent is not
 * re-resolved: it is the agent and version the turn recorded
 * (status.agent_id, agent_version_hash, stamped by ResolveRunAgent), read
 * through getVersion, so recovery after an author's edit, or after the
 * session was repointed, plans for the agent the turn ran.
 *
 * Inputs: the session by the execution's session_id (its own values, its
 * vaults, its workspace entries and its own MCP servers), and the agent
 * from the stamp alone: the stamped version's spec, or the stamped agent
 * as it is now when the turn recorded no version. A stamped version that
 * no longer resolves refuses, naming it. The agent's organization is read
 * from its row as it is now (none when the row cannot be read), so the
 * resolver keeps the person's own values from another organization's
 * agent. No stamp is the built-in assistant: no agent, and the session's
 * own MCP servers are the whole tool set.
 *
 * Which entry fills each key is the vault resolver's one rule
 * (domain/vault/resolve.ts): the session's own repository tokens, its
 * vaults, the surface's vaults for a run with no person, and the person's
 * My vault; a required key found nowhere refuses the create naming who
 * must act. An agent and a conversation that use one tool name for two
 * different servers (or one of them gone) refuse the create, naming it:
 * the runner keeps the conversation's server under a shared name, so
 * values planned for the agent's would reach another server. The run's
 * person is the one recorded on the run at create (RunStatus.credentials,
 * stamped by StampRunCredentials), read from the run, so recovery uses
 * the person create used, never the recovering caller.
 *
 * The manifest is server-only like the person: StampRunCredentials
 * discards a client-sent value before this step writes it, and status
 * writes never change it (update-status.ts copies named fields only).
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";
import {
  RunCredentialsSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run, RunSchema, RunValueSource } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { failedPreconditionError, goWrappedStatusError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import type { Store } from "../../store/interface.js";
import type { VaultResolver } from "../vault/resolve.js";
import { runPersonOfCaller } from "../vault/resolve.js";

import type { AgentLoader } from "./create-steps.js";
import { storedSessionOf } from "./session-binding.js";
import { sessionIdOf } from "./target.js";

export { SCHEDULE_ID_LABEL_KEY } from "../vault/resolve.js";

// ---------------------------------------------------------------------------
// The narrow in-process edges the planner consumes (lazy providers).
// ---------------------------------------------------------------------------

export interface SessionLoader {
  get(sessionId: string): Promise<Session>;
}

export interface RunValuePlannerDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly agentLoader: () => AgentLoader;
  readonly sessionLoader: () => SessionLoader;
  /** The one rule for where each value lives (domain/vault/resolve.ts). */
  readonly vaultResolver: VaultResolver;
}

/**
 * StampRunCredentials: records whose turn this is, once, at create, by the
 * platform's one rule for a first-party human operator, and only when that
 * person is the conversation's creator. A person the conversation is
 * shared with (a participant) sends turns that record no person, so they
 * run on nobody's personal logins, only the vaults the conversation names
 * (domain/vault/resolve.ts, the module header). A new conversation is the
 * sender's own; a continued one is compared by its creator stamp, read
 * from the stored session ValidateSessionOrganization recorded. A stamp
 * that does not name the sender's account id (a row stamped before
 * accounts existed) records no person: it fails closed. Runs after the
 * status is built and before the plan is: the planner reads it from the
 * run, here and on recover. A client-sent value, its sources included, is
 * discarded.
 */
export function newStampRunCredentialsStep(): PipelineStep<typeof RunSchema> {
  return {
    name: "StampRunCredentials",
    execute(ctx) {
      const execution = ctx.newState;
      const sender = runPersonOfCaller(ctx.callerIdentity);
      const stored = storedSessionOf(ctx);
      const person =
        stored === undefined ||
        (stored.status?.audit?.specAudit?.createdBy?.id ?? "") === sender
          ? sender
          : undefined;
      (execution.status ??= create(RunStatusSchema)).credentials = create(
        RunCredentialsSchema,
        person === undefined ? {} : { person },
      );
    },
  };
}

/** PlanRunValues: the create pipeline's step over the shared planner, before Persist. */
export function newPlanRunValuesStep(
  deps: RunValuePlannerDeps,
): PipelineStep<typeof RunSchema> {
  return {
    name: "PlanRunValues",
    async execute(ctx) {
      const execution = ctx.newState;
      const sources = await planRunValues(deps, execution);
      (execution.status ??= create(RunStatusSchema)).credentials ??= create(RunCredentialsSchema);
      execution.status.credentials.sources = sources;
    },
  };
}

/**
 * Plans the run's values via the execution's session_id and its agent
 * stamp: the same inputs on create and on recover. Failures throw; the
 * create pipeline surfaces them as-is.
 */
export async function planRunValues(
  deps: RunValuePlannerDeps,
  execution: Run,
): Promise<RunValueSource[]> {
  const executionId = execution.metadata?.id ?? "";
  const executionOrg = execution.metadata?.org ?? "";

  let session: Session;
  try {
    session = await loadRunSession(deps, execution);
  } catch (error) {
    chainError("resolve session", error);
  }

  const agentId = execution.status?.agentId ?? "";
  let agentSpec: AgentSpec | undefined;
  let agentName = "";
  let agentOrg: string | undefined;
  if (agentId !== "") {
    ({ spec: agentSpec, name: agentName, org: agentOrg } = await loadRunAgent(
      deps,
      agentId,
      execution.status?.agentVersionHash ?? "",
    ));
  }
  const findServer = serverFinder(deps, executionOrg);
  await refuseOneNameForTwoServers(agentSpec, session, findServer, executionOrg);
  const tools = await loadRunTools(
    mergeAgentAndSessionMcpUsages(agentSpec, session),
    findServer,
  );

  const sources = await deps.vaultResolver.planRun({
    execution,
    session,
    agentSpec,
    agentName,
    agentOrg,
    tools,
  });
  deps.logger.info("Planned the run's values", {
    executionId,
    entries: sources.length,
  });
  return sources;
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
  deps: RunValuePlannerDeps,
  execution: Run,
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
 * The spec of the agent a turn runs, its name for the resolver's messages
 * and its organization: the recorded version's snapshot when the turn
 * recorded one (the name and organization read best-effort from the agent
 * as it is now; no organization when it cannot be read), else the agent as
 * it is now, read once. Failures keep the inner status code with Go's wrap
 * prefix, naming the version when one was recorded.
 */
async function loadRunAgent(
  deps: RunValuePlannerDeps,
  agentId: string,
  versionHash: string,
): Promise<{ spec: AgentSpec | undefined; name: string; org: string | undefined }> {
  if (versionHash === "") {
    try {
      const agent = await deps.agentLoader().get(agentId);
      return {
        spec: agent.spec,
        name: agent.metadata?.name || agent.metadata?.slug || agentId,
        org: agent.metadata?.org,
      };
    } catch (error) {
      if (error instanceof ConnectError) {
        throw goWrappedStatusError(`load agent ${agentId}`, error);
      }
      chainError(`load agent ${agentId}`, error);
    }
  }
  let spec: AgentSpec | undefined;
  try {
    spec = (await deps.agentLoader().getVersion(agentId, versionHash))
      .specSnapshot;
  } catch (error) {
    const what = `load agent ${agentId} at the version this turn recorded (${versionHash})`;
    if (error instanceof ConnectError) {
      throw goWrappedStatusError(what, error);
    }
    chainError(what, error);
  }
  return { spec, ...(await agentNameAndOrgOf(deps, agentId)) };
}

/**
 * The agent's display name for the resolver's messages and its
 * organization, or its id and no organization when it cannot be read.
 */
async function agentNameAndOrgOf(
  deps: RunValuePlannerDeps,
  agentId: string,
): Promise<{ name: string; org: string | undefined }> {
  try {
    const agent = await deps.agentLoader().get(agentId);
    return {
      name: agent.metadata?.name || agent.metadata?.slug || agentId,
      org: agent.metadata?.org,
    };
  } catch {
    return { name: agentId, org: undefined };
  }
}

/** Finds an MCP server a usage names, or undefined when it is gone. */
type ServerFinder = (usage: McpServerUsage) => Promise<McpServer | undefined>;

/**
 * Finds the server a usage names, by slug in the usage's org or the
 * execution's, reading each server once per plan. A server that is gone
 * is undefined; a store fault fails the plan, so a run never starts
 * quietly without a tool it uses.
 */
function serverFinder(
  deps: RunValuePlannerDeps,
  executionOrg: string,
): ServerFinder {
  const found = new Map<string, Promise<McpServer | undefined>>();
  return (usage) => {
    // Callers pass only named usages. An empty organization would match
    // a tool of that name in any organization, so none is looked up.
    const slug = usage.mcpServerRef?.slug ?? "";
    const org = usage.mcpServerRef?.org || executionOrg;
    if (org === "") {
      return Promise.resolve(undefined);
    }
    const key = `${org}/${slug}`;
    let server = found.get(key);
    if (server === undefined) {
      server = findResourceBySlug(
        deps.store,
        ApiResourceKind.mcp_server,
        McpServerSchema,
        slug,
        org,
      );
      found.set(key, server);
    }
    return server;
  };
}

/**
 * Refuses a run whose agent and conversation use one tool name for two
 * different servers. The runner keeps the conversation's server under a
 * shared name and this plan keeps the agent's, so the values planned here
 * would go to a server nobody planned for. One side naming a server that is
 * gone counts as different: the conversation's server would run unjudged.
 * Both naming the very same server is one tool, used once; both gone is
 * left to the runner's own refusal.
 */
async function refuseOneNameForTwoServers(
  agentSpec: AgentSpec | undefined,
  session: Session,
  findServer: ServerFinder,
  executionOrg: string,
): Promise<void> {
  const agentUsages = new Map<string, McpServerUsage>();
  for (const usage of agentSpec?.mcpServerUsages ?? []) {
    const slug = usage.mcpServerRef?.slug ?? "";
    if (slug !== "") {
      agentUsages.set(slug, usage);
    }
  }
  const sessionUsages = new Map<string, McpServerUsage>();
  for (const usage of session.spec?.mcpServerUsages ?? []) {
    const slug = usage.mcpServerRef?.slug ?? "";
    if (slug !== "") {
      sessionUsages.set(slug, usage);
    }
  }
  for (const [slug, sessionUsage] of sessionUsages) {
    const agentUsage = agentUsages.get(slug);
    if (agentUsage === undefined) {
      continue;
    }
    const [agentServer, sessionServer] = await Promise.all([
      findServer(agentUsage),
      findServer(sessionUsage),
    ]);
    if (agentServer === undefined && sessionServer === undefined) {
      continue;
    }
    if (agentServer?.metadata?.id !== sessionServer?.metadata?.id) {
      const named = (usage: McpServerUsage): string =>
        `${usage.mcpServerRef?.org || executionOrg}/${slug}`;
      throw failedPreconditionError(
        `the agent and this conversation both use a tool named '${slug}', but they name two different servers ` +
          `(${named(agentUsage)} and ${named(sessionUsage)}): ` +
          "remove it from the agent or from the conversation",
      );
    }
  }
}

/**
 * Loads every MCP server a run uses (the agent's and the session's). A
 * server that cannot be found is skipped: the runner resolves the same
 * usages for real and refuses there with the tool's own error; this pass
 * needs only the declarations of the servers that exist.
 */
async function loadRunTools(
  usages: readonly McpServerUsage[],
  findServer: ServerFinder,
): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  for (const usage of usages) {
    const server = await findServer(usage);
    if (server !== undefined) {
      servers.push(server);
    }
  }
  return servers;
}

/**
 * Combines MCP server usages from the agent and session, deduplicating by
 * slug with agent-level usages taking priority — so servers added at the
 * session level (e.g. via the UI at runtime) are included in OAuth token
 * injection too (Go mergeAgentAndSessionMcpUsages). A slug both use for
 * two different servers has been refused before this runs
 * (refuseOneNameForTwoServers), so the priority only picks between two
 * references to one server.
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
