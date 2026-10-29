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
 * vaults, its resources and its own plugins), and the agent
 * from the stamp alone: the stamped version's spec (a turn that names an
 * agent always records its version, ResolveRunAgent). A stamped version
 * that no longer resolves refuses, naming it. The agent's organization is read
 * from its row as it is now (none when the row cannot be read), so the
 * resolver keeps the person's own values from another organization's
 * agent. No stamp is the built-in assistant: no agent, and the session's
 * own plugins are the whole tool set. The agent's subagents are read at
 * the versions its stamped version pins (run-subagents.ts), each bringing
 * its own keys and its plugins. The plugins are the agent version's, the
 * session's and the subagents', each once, less any the run excludes
 * (run-plugins.ts).
 *
 * Which entry fills each key is the vault resolver's one rule
 * (domain/vault/resolve.ts): the session's own repository tokens, its
 * vaults, the surface's vaults for a run with no person, and the person's
 * My vault; a required key found nowhere refuses the create naming who
 * must act. Two plugins of one name refuse the create, naming them. The run's
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

import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  RunCredentialsSchema,
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run, RunSchema, RunValueSource } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { goWrappedStatusError } from "../../pipeline/errors.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { Store } from "../../store/interface.js";
import type { VaultResolver } from "../vault/resolve.js";
import { runPersonOfCaller } from "../vault/resolve.js";

import type { AgentLoader } from "./create-steps.js";
import { QUEUED_MESSAGES_PERSON_KEY } from "./create-steps.js";
import { admitEnvironment, loadSessionEnvironment } from "./environment-admission.js";
import type { EnvironmentPolicy } from "./environment-admission.js";
import { refuseLocalPrograms } from "./local-programs.js";
import { runServers } from "./run-servers.js";
import type { LocalProgramPolicy } from "./local-programs.js";
import { loadRunPlugins, runPluginReferences } from "./run-plugins.js";
import { runSubagents } from "./run-subagents.js";
import { storedSessionOf } from "./session-binding.js";
import { sessionIdOf } from "./target.js";

export { ROUTINE_ID_LABEL_KEY } from "../vault/resolve.js";

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
  /** Where a plugin's local program cannot start; absent refuses nothing (local-programs.ts). */
  readonly localPrograms?: LocalProgramPolicy;
  /**
   * The Environment rule and the authorizer its turn-time view check asks
   * (environment-admission.ts); absent refuses nothing.
   */
  readonly environments?: { readonly policy: EnvironmentPolicy; readonly authorizer: Authorizer };
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
      const person = runPersonOfRequest(ctx);
      (execution.status ??= create(RunStatusSchema)).credentials = create(
        RunCredentialsSchema,
        person === undefined ? {} : { person },
      );
    },
  };
}

/**
 * The person a turn records (StampRunCredentials, above): the caller by
 * the platform's rule for a first-party human operator, when the
 * conversation is theirs; undefined otherwise. Read after the session was
 * validated, so a queued message records the answer its turn would
 * (run/send-message.ts), and a turn the queue starts records the answer
 * its messages recorded (create-steps.ts GuardQueuedMessages).
 */
export function runPersonOfRequest(ctx: RequestContext<typeof RunSchema>): string | undefined {
  const queued = ctx.get(QUEUED_MESSAGES_PERSON_KEY);
  if (typeof queued === "string") {
    return queued === "" ? undefined : queued;
  }
  const sender = runPersonOfCaller(ctx.callerIdentity);
  const stored = storedSessionOf(ctx);
  return stored === undefined || (stored.status?.audit?.specAudit?.createdBy?.id ?? "") === sender
    ? sender
    : undefined;
}

/** PlanRunValues: the create pipeline's step over the shared planner, before Persist. */
export function newPlanRunValuesStep(
  deps: RunValuePlannerDeps,
): PipelineStep<typeof RunSchema> {
  return {
    name: "PlanRunValues",
    async execute(ctx) {
      const execution = ctx.newState;
      const sources = await planRunValues(deps, execution, ctx.callerIdentity);
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
  caller?: CallerIdentity,
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
  const subagents = await runSubagents(deps.store, agentSpec, executionOrg);
  const plugins = await loadRunPlugins(
    deps.store,
    runPluginReferences(agentSpec, session, executionOrg, subagents),
    executionOrg,
    execution.spec?.excludedPluginIds,
  );
  refuseLocalPrograms(deps.localPrograms, session.spec?.executionTarget ?? ExecutionTarget.UNSPECIFIED, plugins);
  if (deps.environments !== undefined) {
    await admitEnvironment({
      policy: deps.environments.policy,
      session,
      environment: await loadSessionEnvironment(deps.store, session),
      servers: runServers({
        agent:
          agentSpec === undefined
            ? undefined
            : { id: agentId, name: agentName, version: execution.status?.agentVersionHash ?? "", spec: agentSpec },
        subagents,
        plugins,
      }),
      ...(caller !== undefined ? { viewer: { authorizer: deps.environments.authorizer, caller } } : {}),
    });
  }

  const sources = await deps.vaultResolver.planRun({
    execution,
    session,
    agentSpec,
    agentName,
    agentId,
    agentVersion: execution.status?.agentVersionHash ?? "",
    agentOrg,
    subagents,
    plugins,
  });
  deps.logger.info("Planned the run's values", {
    executionId,
    entries: sources.length,
  });
  return sources;
}

/**
 * Wrap chains: the INNERMOST status boundary renders through
 * goWrappedStatusError ("prefix: rpc error: code = X desc = …", the #852
 * wire shape); every OUTER wrap prepends plain text while preserving the
 * inner code. Plain errors chain as plain errors and land on the
 * pipeline's Internal fallback.
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
 * and its organization: the recorded version's snapshot (the name and
 * organization read best-effort from the agent as it is now; no
 * organization when it cannot be read). Failures keep the inner status
 * code with the wrap prefix, naming the version.
 */
async function loadRunAgent(
  deps: RunValuePlannerDeps,
  agentId: string,
  versionHash: string,
): Promise<{ spec: AgentSpec | undefined; name: string; org: string | undefined }> {
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
