import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { AgentInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/command_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { GitHubService } from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import type {
  DemoScenario,
  FixtureEntry,
  StreamFixtureHandler,
  UnaryFixtureHandler,
} from "./types";
import { rpcKey } from "./types";

/**
 * A fixture specification returned by fixture entry helpers.
 *
 * Pass one or more specs to {@link buildScenario} to construct a
 * {@link DemoScenario} ready for {@link createDemoClient}.
 *
 * The `searchResourceKind` field is set automatically by search-backed
 * helpers (`fixtures.agent.list`, `fixtures.skill.list`,
 * `fixtures.mcpServer.list`). Do not set it manually.
 */
export interface FixtureSpec {
  readonly key: string;
  readonly entry: FixtureEntry;
  readonly searchResourceKind?: ApiResourceKind;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function unarySpec(
  service: { readonly typeName: string },
  method: string,
  handler: UnaryFixtureHandler,
): FixtureSpec {
  return { key: rpcKey(service, method), entry: { unary: handler } };
}

function streamSpec(
  service: { readonly typeName: string },
  method: string,
  handler: StreamFixtureHandler,
): FixtureSpec {
  return { key: rpcKey(service, method), entry: { stream: handler } };
}

function searchListSpec(
  kind: ApiResourceKind,
  handler: UnaryFixtureHandler,
): FixtureSpec {
  return {
    key: rpcKey(SearchService, "search"),
    entry: { unary: handler },
    searchResourceKind: kind,
  };
}

// ---------------------------------------------------------------------------
// Fixture entry helpers — organized by resource domain
// ---------------------------------------------------------------------------

/**
 * Fixture entry helpers mirroring the `Stigmer` SDK client shape.
 *
 * Each method wraps a user-provided handler into a {@link FixtureSpec}
 * that {@link buildScenario} assembles into a {@link DemoScenario}.
 *
 * Method names match the SDK client methods (e.g. `fixtures.session.get`
 * mirrors `client.session.get`). JSDoc on each method documents which
 * React hooks consume that RPC.
 *
 * @example
 * ```ts
 * import { fixtures, buildScenario, createDemoClient } from "@stigmer/react/demo";
 *
 * const scenario = buildScenario(
 *   fixtures.session.get(() => mySession),
 *   fixtures.agentExecution.listBySession(() => myExecutionList),
 *   fixtures.agentExecution.subscribe(() => [snapshot1, snapshot2]),
 * );
 * const client = createDemoClient(scenario);
 * ```
 */
export const fixtures = {
  // ---- Session ----

  session: {
    /** Hooks: `useSession`, `useSessionConversation` */
    get: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(SessionQueryController, "get", handler),

    /** Hooks: `useSessionList` */
    list: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(SessionQueryController, "list", handler),

    /** Hooks: `useCreateSession` */
    create: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(SessionCommandController, "create", handler),

    /** Hooks: `useUpdateSession`, `useSessionConversation` */
    update: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(SessionCommandController, "update", handler),
  },

  // ---- Agent Execution ----

  agentExecution: {
    /** Hooks: `useCreateAgentExecution` */
    create: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentExecutionCommandController, "create", handler),

    /** Hooks: `useSessionExecutions`, `useSessionConversation` */
    listBySession: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentExecutionQueryController, "listBySession", handler),

    /**
     * Hooks: `useExecutionStream`, `useSessionConversation`
     *
     * The handler returns an **array** of `AgentExecution` snapshots that
     * the transport yields as a server stream.
     */
    subscribe: (handler: StreamFixtureHandler): FixtureSpec =>
      streamSpec(AgentExecutionQueryController, "subscribe", handler),

    /** Hooks: `useSubmitApproval`, `useSessionConversation` */
    submitApproval: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentExecutionCommandController, "submitApproval", handler),

    /** Hooks: `useArtifactContent`, `useDetectSkillPackage` */
    getArtifactContent: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentExecutionQueryController, "getArtifactContent", handler),

    /** Hooks: `useAttachments` */
    uploadAttachment: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentExecutionCommandController, "uploadAttachment", handler),
  },

  // ---- Agent ----

  agent: {
    /** Hooks: `useAgentRefFromSession` */
    get: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentQueryController, "get", handler),

    /** Hooks: `useAgent`, `useCreateSession`, `useAgentSetup` */
    getByReference: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentQueryController, "getByReference", handler),

    /** Hooks: `useDefaultAgent` */
    getDefault: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentQueryController, "getDefault", handler),

    /**
     * Hooks: `useAgentList`, `useAgentSearch`, `useAgentCount`
     *
     * Routes through `SearchService` — use {@link buildScenario} to avoid
     * key collisions with `fixtures.skill.list` and `fixtures.mcpServer.list`.
     */
    list: (handler: UnaryFixtureHandler): FixtureSpec =>
      searchListSpec(ApiResourceKind.agent, handler),

    /** Hooks: `useApplyResource` */
    apply: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentCommandController, "apply", handler),

    /** Hooks: `useUpdateVisibility` (when kind is Agent) */
    updateVisibility: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentCommandController, "updateVisibility", handler),
  },

  // ---- Skill ----

  skill: {
    /** Hooks: `useSkill` */
    getByReference: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(SkillQueryController, "getByReference", handler),

    /**
     * Hooks: `useSkillList`, `useSkillSearch`, `useSkillCount`
     *
     * Routes through `SearchService` — use {@link buildScenario} to avoid
     * key collisions with `fixtures.agent.list` and `fixtures.mcpServer.list`.
     */
    list: (handler: UnaryFixtureHandler): FixtureSpec =>
      searchListSpec(ApiResourceKind.skill, handler),

    /** Hooks: `useApplyResource` (when kind is Skill) */
    pushFromExecutionArtifact: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(SkillCommandController, "pushFromExecutionArtifact", handler),

    /** Hooks: `useUpdateVisibility` (when kind is Skill) */
    updateVisibility: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(SkillCommandController, "updateVisibility", handler),
  },

  // ---- MCP Server ----

  mcpServer: {
    /** Hooks: `useMcpServer`, `useMcpServerSetup` */
    getByReference: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(McpServerQueryController, "getByReference", handler),

    /**
     * Hooks: `useMcpServerList`, `useMcpServerSearch`, `useMcpServerCount`
     *
     * Routes through `SearchService` — use {@link buildScenario} to avoid
     * key collisions with `fixtures.agent.list` and `fixtures.skill.list`.
     */
    list: (handler: UnaryFixtureHandler): FixtureSpec =>
      searchListSpec(ApiResourceKind.mcp_server, handler),

    /** Hooks: `useMcpServerConnect` */
    connect: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(McpServerCommandController, "connect", handler),

    /** Hooks: `useApplyResource` (when kind is McpServer) */
    apply: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(McpServerCommandController, "apply", handler),

    /** Hooks: `useUpdateVisibility` (when kind is McpServer) */
    updateVisibility: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(McpServerCommandController, "updateVisibility", handler),

    /** Hooks: `useOAuthGrantStatus` */
    getOAuthGrantStatus: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(McpServerQueryController, "getOAuthGrantStatus", handler),

    /** Hooks: `useOrgOAuthApp` */
    getOrgOAuthApp: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(McpServerQueryController, "getOrgOAuthApp", handler),
  },

  // ---- Environment ----

  environment: {
    /** Components: `EnvironmentVariableEditor` */
    get: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(EnvironmentQueryController, "get", handler),

    /** Hooks: `useEnvironment` */
    getByReference: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(EnvironmentQueryController, "getByReference", handler),

    /** Hooks: `useEnvironmentList`, `usePersonalEnvironment` */
    list: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(EnvironmentQueryController, "list", handler),

    /** Hooks: `useCreateEnvironment`, `usePersonalEnvironment` */
    create: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(EnvironmentCommandController, "create", handler),

    /** Hooks: `useUpdateEnvironment` */
    update: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(EnvironmentCommandController, "update", handler),

    /** Hooks: `useUpdateEnvironmentVariables`, `usePersonalEnvironment` */
    updateVariables: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(EnvironmentCommandController, "updateVariables", handler),

    /** Hooks: `useRemoveEnvironmentVariables`, `usePersonalEnvironment` */
    removeVariables: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(EnvironmentCommandController, "removeVariables", handler),

    /** Hooks: `useRevealSecretValue`, `useGitHubConnection` */
    getSecretValue: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(EnvironmentQueryController, "getSecretValue", handler),
  },

  // ---- Agent Instance ----

  agentInstance: {
    /** Hooks: `useAgentRefFromSession` */
    get: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentInstanceQueryController, "get", handler),

    /** Hooks: `useAgentInstance` */
    getByReference: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentInstanceQueryController, "getByReference", handler),

    /** Hooks: `useAgentInstanceList`, `useAgentSetup` */
    list: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentInstanceQueryController, "list", handler),

    /** Hooks: `useCreateAgentInstance`, `usePersonalAgentInstance`, `useAgentSetup` */
    create: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(AgentInstanceCommandController, "create", handler),
  },

  // ---- Organization ----

  organization: {
    /** Hooks: `useCreateOrganization` */
    create: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(OrganizationCommandController, "create", handler),
  },

  // ---- API Key ----

  apiKey: {
    /** Hooks: `useApiKeyList` */
    findAll: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(ApiKeyQueryController, "findAll", handler),

    /** Hooks: `useCreateApiKey` */
    create: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(ApiKeyCommandController, "create", handler),

    /** Hooks: `useDeleteApiKey` */
    delete: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(ApiKeyCommandController, "delete", handler),
  },

  // ---- GitHub ----

  github: {
    /** Hooks: `useGitHubConnection` */
    getOAuthAuthorizeUrl: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(GitHubService, "getOAuthAuthorizeUrl", handler),

    /** Hooks: `useGitHubConnection` */
    exchangeOAuthCode: (handler: UnaryFixtureHandler): FixtureSpec =>
      unarySpec(GitHubService, "exchangeOAuthCode", handler),
  },
} as const;

// ---------------------------------------------------------------------------
// Scenario builder
// ---------------------------------------------------------------------------

/**
 * Assemble {@link FixtureSpec} entries into a {@link DemoScenario}.
 *
 * This is the recommended way to construct scenarios because it correctly
 * merges search-backed list fixtures (`agent.list`, `skill.list`,
 * `mcpServer.list`) that share the same underlying `SearchService` RPC.
 * Using `new Map([...])` directly with these helpers would cause silent
 * key collisions where the last entry wins.
 *
 * @example
 * ```ts
 * import { fixtures, buildScenario, createDemoClient } from "@stigmer/react/demo";
 *
 * const scenario = buildScenario(
 *   fixtures.session.get(() => mySession),
 *   fixtures.agent.list(() => myAgentSearchResponse),
 *   fixtures.skill.list(() => mySkillSearchResponse),
 * );
 * const client = createDemoClient(scenario);
 * ```
 */
export function buildScenario(...specs: FixtureSpec[]): DemoScenario {
  const entries: [string, FixtureEntry][] = [];
  const searchHandlers = new Map<ApiResourceKind, UnaryFixtureHandler>();

  for (const spec of specs) {
    if (spec.searchResourceKind !== undefined) {
      if (spec.entry.unary) {
        searchHandlers.set(spec.searchResourceKind, spec.entry.unary);
      }
    } else {
      entries.push([spec.key, spec.entry]);
    }
  }

  if (searchHandlers.size > 0) {
    const searchKey = rpcKey(SearchService, "search");
    entries.push([
      searchKey,
      {
        unary: (request: unknown) => {
          const req = request as { kinds?: ApiResourceKind[] };
          const kind = req.kinds?.[0];
          if (kind !== undefined) {
            const handler = searchHandlers.get(kind);
            if (handler) return handler(request);
          }
          const registered = [...searchHandlers.keys()]
            .map((k) => ApiResourceKind[k])
            .join(", ");
          throw new Error(
            `No search fixture for resource kind ${kind !== undefined ? ApiResourceKind[kind] ?? kind : "(none)"}. ` +
              `Registered kinds: ${registered || "(none)"}. ` +
              `Add a fixture with fixtures.agent.list(), fixtures.skill.list(), or fixtures.mcpServer.list().`,
          );
        },
      },
    ]);
  }

  return { fixtures: new Map(entries) };
}
