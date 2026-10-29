/**
 * Whether a conversation's Environment can be honoured, asked up front: when
 * the conversation is made (session create's AdmitSessionEnvironment) and
 * when each turn is created or recovered (planRunValues), so a person
 * learns it before a turn fails on it, never by an Environment silently
 * ignored. The local-program rule's shape (local-programs.ts).
 *
 * An Environment governs only a sandbox this server starts: the sandbox
 * lane composed, the conversation's target resolving to CLOUD, and its
 * turns routed to a per-session queue. That is exactly when the session
 * ensure step provisions one (sandbox/steps.ts), so a server with no
 * sandbox driver never applies an organization default it has no way to
 * honour. Anywhere else (a conversation on the person's own machine, in
 * the desktop app or the CLI) the agent's and organization's defaults do
 * not reach it, and an Environment the conversation names itself is
 * refused.
 *
 * Refused with FAILED_PRECONDITION, one sentence per cause:
 *   - the conversation runs outside a server-started sandbox and names one;
 *   - limited networking, or packages, this server's sandbox driver cannot
 *     enforce or install (domain/environment/facts.ts unservableReason): an
 *     operator can change the driver after the Environment was saved;
 *   - the Environment no longer exists;
 *   - under limited networking without allow_mcp_servers, an MCP server of
 *     the agent tree whose host no listed host admits, naming the server
 *     (Claude Managed Agents' rule).
 * And with PERMISSION_DENIED, at each turn: a person who may no longer view
 * an Environment the conversation or its routine named (vaults' "checked at
 * write and at run"). An agent's or the organization's default is vouched
 * for by whoever saved it and is not asked again, as an agent's plugins are
 * not.
 *
 * Tests: __tests__/environment-admission.test.ts.
 */
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { EnvironmentSource, ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { failedPreconditionError, internalError } from "../../pipeline/errors.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
import type { SandboxLane } from "../../sandbox/lane.js";
import type { EnvironmentFacts, EnvironmentSupport } from "../../sandbox/provisioner.js";
import { loadVersion } from "../../pipeline/steps/version-history.js";
import { agentVersionBinding } from "../agent/versions.js";
import { loadRunPlugins, runPluginReferences } from "./run-plugins.js";
import { runSubagents } from "./run-subagents.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { environmentFactsOf, environmentName, environmentSupportOf, isLimited, unservableReason } from "../environment/facts.js";
import { hostAdmits } from "../environment/hosts.js";
import { ROUTING_SESSION } from "./temporal/config.js";
import type { AgentExecutionTemporalConfig } from "./temporal/config.js";
import type { RunServer } from "./run-servers.js";
import { runServers, turnServerName } from "./run-servers.js";

/** Whether this server starts the sandbox a conversation runs in, and what its sandboxes can do. */
export interface EnvironmentPolicy {
  governs(target: ExecutionTarget): boolean;
  readonly support: EnvironmentSupport;
}

/** The deployment's policy: the condition the session ensure step provisions under (the module header). */
export function newEnvironmentPolicy(
  lane: SandboxLane,
  temporalConfig: Pick<AgentExecutionTemporalConfig, "resolveExecutionTarget" | "activityRouting">,
): EnvironmentPolicy {
  return {
    governs(target) {
      return (
        lane.enabled &&
        temporalConfig.activityRouting === ROUTING_SESSION &&
        temporalConfig.resolveExecutionTarget(target) === ExecutionTarget.CLOUD
      );
    },
    support: environmentSupportOf(lane),
  };
}

/** The refusal of an Environment a conversation names where no server-started sandbox runs it. */
export const LOCAL_ENVIRONMENT_MESSAGE =
  "this conversation runs on your own machine (the desktop app or the CLI), where an environment does not apply; " +
  "start it in a hosted sandbox, or remove its environment";

/** The refusal of a conversation whose Environment is gone. */
export function deletedEnvironmentMessage(name: string): string {
  return `this conversation's environment '${name}' was deleted; start a new conversation`;
}

/** The refusal of a person who may no longer view the Environment their conversation named. */
export function revokedEnvironmentMessage(name: string): string {
  return `you may no longer use this conversation's environment '${name}'; ask for access to it, or start a new conversation`;
}

/** The refusal of an MCP server a limited Environment does not reach. */
export function unlistedMcpHostMessage(environment: string, server: string, host: string): string {
  return (
    `environment '${environment}' limits networking and does not allow the agent's MCP servers, and MCP server '${server}' ` +
    `at '${host}' is not one of its allowed hosts; add the host to the environment, or allow its MCP servers`
  );
}

/** The host of an MCP server reached at an address, or `undefined` for a local program or an address that is not a URL. */
export function mcpServerHost(server: RunServer): string | undefined {
  if (server.entry.transport.case !== "http") {
    return undefined;
  }
  try {
    return new URL(server.entry.transport.value.url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** The hosts of the agent tree's MCP servers reached at an address, each once. */
export function mcpServerHosts(servers: readonly RunServer[]): string[] {
  return [...new Set(servers.map(mcpServerHost).filter((host): host is string => host !== undefined))];
}

/**
 * The conversation's Environment as it is now: the row its status names,
 * `"gone"` when that row no longer exists, or `undefined` when it names
 * none.
 */
export async function loadSessionEnvironment(
  store: Store,
  session: Session,
): Promise<Environment | "gone" | undefined> {
  const id = session.status?.environment?.id ?? "";
  if (id === "") {
    return undefined;
  }
  try {
    return await store.getResource(ApiResourceKind.environment, id, EnvironmentSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return "gone";
    }
    throw internalError(error, "failed to load the conversation's environment");
  }
}

/**
 * Every MCP server a conversation's turns would dial, read as a turn reads
 * them: the pinned agent version, each subagent at its pinned version, and
 * the plugins (the agent's, the conversation's and the subagents').
 */
export async function sessionRunServers(store: Store, session: Session): Promise<RunServer[]> {
  const org = session.metadata?.org ?? "";
  const agentId = session.status?.agentId ?? "";
  const versionHash = session.status?.agentVersionHash ?? "";
  const agent =
    agentId === ""
      ? undefined
      : (await loadVersion(store, agentVersionBinding, agentId, versionHash)).resource;
  const agentSpec = agent?.spec;
  const subagents = await runSubagents(store, agentSpec, org);
  const plugins = await loadRunPlugins(store, runPluginReferences(agentSpec, session, org, subagents), org);
  return runServers({
    agent:
      agent === undefined || agentSpec === undefined
        ? undefined
        : { id: agentId, name: agent.metadata?.slug ?? "", version: versionHash, spec: agentSpec },
    subagents,
    plugins,
  });
}

/**
 * The facts a session's sandbox gets for its Environment, read now:
 * `undefined` when it has none, refused when that Environment is gone (the
 * ensure step stamps it as the run's provisioning failure, and run create
 * and recover refuse the turn naming it). The agent tree is read only for a
 * limited Environment that allows its MCP servers.
 */
export async function sessionEnvironmentFacts(store: Store, session: Session): Promise<EnvironmentFacts | undefined> {
  const environment = await loadSessionEnvironment(store, session);
  if (environment === undefined) {
    return undefined;
  }
  if (environment === "gone") {
    const stamp = session.status?.environment;
    throw failedPreconditionError(deletedEnvironmentMessage(stamp?.slug || stamp?.id || ""));
  }
  const reachesServers = isLimited(environment) && (environment.spec?.networking?.allowMcpServers ?? false);
  return environmentFactsOf(environment, reachesServers ? mcpServerHosts(await sessionRunServers(store, session)) : []);
}

/** What one admission reads. */
export interface EnvironmentAdmission {
  readonly policy: EnvironmentPolicy;
  readonly session: Session;
  /** The conversation's Environment, as loadSessionEnvironment read it. */
  readonly environment: Environment | "gone" | undefined;
  /** Every MCP server the conversation's turns dial (run-servers.ts). */
  readonly servers: readonly RunServer[];
  /**
   * At a turn: who must still be able to view an Environment the
   * conversation or its routine named. Absent at session create, where the
   * reference rule's writer clause has just asked it.
   */
  readonly viewer?: { readonly authorizer: Authorizer; readonly caller: CallerIdentity };
}

/** Refuses a conversation whose Environment cannot be honoured (the module header); returns when it can. */
export async function admitEnvironment(admission: EnvironmentAdmission): Promise<void> {
  const { policy, session, environment } = admission;
  const target = session.spec?.executionTarget ?? ExecutionTarget.UNSPECIFIED;
  if (!policy.governs(target)) {
    if ((session.spec?.environmentRef?.id ?? "") !== "" || (session.spec?.environmentRef?.slug ?? "") !== "") {
      throw failedPreconditionError(LOCAL_ENVIRONMENT_MESSAGE);
    }
    return;
  }
  if (environment === undefined) {
    return;
  }
  if (environment === "gone") {
    const stamp = session.status?.environment;
    throw failedPreconditionError(deletedEnvironmentMessage(stamp?.slug || stamp?.id || ""));
  }
  const name = environmentName(environment);
  const reason = unservableReason(policy.support, environment);
  if (reason !== undefined) {
    throw failedPreconditionError(reason);
  }
  if (isLimited(environment) && !(environment.spec?.networking?.allowMcpServers ?? false)) {
    const listed = environment.spec?.networking?.allowedHosts ?? [];
    for (const server of admission.servers) {
      const host = mcpServerHost(server);
      if (host !== undefined && !listed.some((pattern) => hostAdmits(pattern, host))) {
        throw failedPreconditionError(unlistedMcpHostMessage(name, turnServerName(server), host));
      }
    }
  }
  const source = session.status?.environmentSource ?? EnvironmentSource.UNSPECIFIED;
  if (
    admission.viewer !== undefined &&
    (source === EnvironmentSource.SESSION || source === EnvironmentSource.ROUTINE)
  ) {
    await authorizeResolvedResource(
      admission.viewer.authorizer,
      admission.viewer.caller,
      {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.environment,
        resourceId: environment.metadata?.id ?? "",
      },
      revokedEnvironmentMessage(name),
    );
  }
}
