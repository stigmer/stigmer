/**
 * Pins the Environment rule (../environment-admission.ts): whether a
 * conversation's Environment can be honoured, asked at session create and
 * at each turn.
 *
 * What it pins:
 *   - the deployment's policy governs only a sandbox this server starts:
 *     the lane enabled, per-session routing, and the target resolving to
 *     CLOUD (UNSPECIFIED through the configured default); its support is
 *     the lane's driver's statement;
 *   - an MCP server's host is its URL's host, lower case; a local program
 *     and an address that is not a URL have none; the tree's hosts are
 *     listed once;
 *   - admitEnvironment, where the policy does not govern: a conversation
 *     naming its own Environment (by id or slug) is refused with
 *     LOCAL_ENVIRONMENT_MESSAGE, and one naming none passes whatever it
 *     resolved;
 *   - where it governs: none passes; a deleted Environment is refused with
 *     deletedEnvironmentMessage naming the stamp's slug; limited networking
 *     or packages the current support cannot serve are refused with the
 *     unservable sentence; under limited networking without
 *     allow_mcp_servers an agent MCP server whose host no listed host
 *     admits is refused with unlistedMcpHostMessage (a listed host, exact
 *     or by wildcard, admits it, and a local program is not asked), while
 *     allow_mcp_servers admits any;
 *   - at a turn (a viewer handed in), a person who may no longer view an
 *     Environment the conversation (source session) or its routine (source
 *     routine) named is refused PERMISSION_DENIED with
 *     revokedEnvironmentMessage, the question being can_view on the
 *     Environment's id; an agent- or organization-sourced Environment is
 *     not asked again, nor is any at session create (no viewer), nor for
 *     the server acting as itself;
 *   - loadSessionEnvironment and sessionEnvironmentFacts read the stamped
 *     row now: none, gone (refused naming it), or its facts, the pinned
 *     agent's MCP hosts added only for a limited Environment allowing them;
 *     a store that cannot read the row answers INTERNAL;
 *   - planRunValues (run create and recover) runs the rule with the turn's
 *     caller as the viewer, before any value is asked for: an unlisted MCP
 *     host of the conversation's plugin, a deleted Environment and a
 *     revoked view each refuse the turn, and a listed host plans it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import type { EnvironmentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { McpServerEntrySchema, PluginStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { EnvironmentSource, ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer, AuthzCheck, AuthzDecision } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import type { SandboxLane } from "../../../sandbox/lane.js";
import type { EnvironmentSupport } from "../../../sandbox/provisioner.js";
import type { RunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";
import type { RunCredentialInput } from "../../vault/resolve.js";
import { provisionerStating } from "../../environment/__tests__/support.js";
import {
  LOCAL_ENVIRONMENT_MESSAGE,
  admitEnvironment,
  deletedEnvironmentMessage,
  loadSessionEnvironment,
  mcpServerHost,
  mcpServerHosts,
  newEnvironmentPolicy,
  revokedEnvironmentMessage,
  sessionEnvironmentFacts,
  unlistedMcpHostMessage,
} from "../environment-admission.js";
import type { EnvironmentPolicy } from "../environment-admission.js";
import { planRunValues } from "../plan-run-values-step.js";
import type { RunValuePlannerDeps } from "../plan-run-values-step.js";
import type { RunServer } from "../run-servers.js";
import { runServers, serversOf } from "../run-servers.js";
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_CLOUD,
  DEFAULT_EXECUTION_TARGET_LOCAL,
  ROUTING_GLOBAL,
  ROUTING_SESSION,
} from "../temporal/config.js";

const ORG = "org_1";
const FULL: EnvironmentSupport = { limitedNetworking: true, packages: true };
const AGENT_HASH = "a".repeat(64);

function lane(support: EnvironmentSupport | undefined): SandboxLane {
  const credentials: RunnerCredentialProvider = {
    isEnabled: () => false,
    mint: () => {
      throw new Error("the Environment rule mints nothing");
    },
    verify: () => {
      throw new Error("the Environment rule verifies nothing");
    },
  };
  return { enabled: true, provisioner: provisionerStating(support), credentials };
}

function temporal(routing: string, defaultTarget: string): AgentExecutionTemporalConfig {
  return new AgentExecutionTemporalConfig("agent_execution_stigmer", "stigmer_runner", routing, defaultTarget);
}

/** A policy that governs every target, with `support`. */
function governing(support: EnvironmentSupport = FULL): EnvironmentPolicy {
  return { governs: () => true, support };
}

const LOCAL_ONLY: EnvironmentPolicy = { governs: () => false, support: FULL };

function environment(
  spec: MessageInitShape<typeof EnvironmentSpecSchema>,
  id = "env_01box",
  slug = "box",
): Environment {
  return create(EnvironmentSchema, { metadata: { id, org: ORG, slug }, spec });
}

const LIMITED = environment({
  networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com", "*.linear.app"] },
});

function conversation(opts: {
  spec?: { executionTarget?: ExecutionTarget; environmentRef?: { id?: string; slug?: string } };
  environmentId?: string;
  source?: EnvironmentSource;
  agentId?: string;
  plugins?: { org: string; slug: string }[];
}): Session {
  return create(SessionSchema, {
    metadata: { id: "ses_1", org: ORG, slug: "chat" },
    spec: {
      executionTarget: opts.spec?.executionTarget ?? ExecutionTarget.CLOUD,
      ...(opts.spec?.environmentRef === undefined ? {} : { environmentRef: opts.spec.environmentRef }),
      plugins: opts.plugins ?? [],
    },
    status: {
      ...(opts.environmentId === undefined
        ? {}
        : {
            environment: { kind: ApiResourceKind.environment, org: ORG, id: opts.environmentId, slug: "box" },
            environmentSource: opts.source ?? EnvironmentSource.SESSION,
          }),
      ...(opts.agentId === undefined ? {} : { agentId: opts.agentId, agentVersionHash: AGENT_HASH }),
    },
  });
}

function agentServers(...servers: { name: string; url: string }[]): RunServer[] {
  return runServers({
    agent: { id: "agt_1", name: "reviewer", version: AGENT_HASH, spec: create(AgentSpecSchema, { mcpServers: servers }) },
    subagents: [],
    plugins: [],
  });
}

/** An authorizer answering `decision` to every question, recording each. */
function recording(decision: AuthzDecision): { authorizer: Authorizer; asked: AuthzCheck[] } {
  const asked: AuthzCheck[] = [];
  return {
    asked,
    authorizer: {
      authorize: async (_caller, check) => {
        asked.push(check);
        return decision;
      },
    },
  };
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the deployment's policy", () => {
  it("governs a CLOUD target on an enabled lane with per-session routing, UNSPECIFIED through a CLOUD default", () => {
    const policy = newEnvironmentPolicy(lane(FULL), temporal(ROUTING_SESSION, DEFAULT_EXECUTION_TARGET_CLOUD));
    expect(policy.governs(ExecutionTarget.CLOUD)).toBe(true);
    expect(policy.governs(ExecutionTarget.UNSPECIFIED)).toBe(true);
    expect(policy.governs(ExecutionTarget.LOCAL)).toBe(false);
    expect(policy.support).toEqual(FULL);
  });

  it("governs nothing without a lane, without per-session routing, or where UNSPECIFIED resolves to LOCAL", () => {
    expect(newEnvironmentPolicy({ enabled: false }, temporal(ROUTING_SESSION, DEFAULT_EXECUTION_TARGET_CLOUD)).governs(
      ExecutionTarget.CLOUD,
    )).toBe(false);
    expect(newEnvironmentPolicy(lane(FULL), temporal(ROUTING_GLOBAL, DEFAULT_EXECUTION_TARGET_CLOUD)).governs(
      ExecutionTarget.CLOUD,
    )).toBe(false);
    const localDefault = newEnvironmentPolicy(lane(FULL), temporal(ROUTING_SESSION, DEFAULT_EXECUTION_TARGET_LOCAL));
    expect(localDefault.governs(ExecutionTarget.UNSPECIFIED)).toBe(false);
    expect(localDefault.governs(ExecutionTarget.CLOUD)).toBe(true);
  });

  it("takes its support from the driver's statement: none stated is none", () => {
    const policy = newEnvironmentPolicy(lane(undefined), temporal(ROUTING_SESSION, DEFAULT_EXECUTION_TARGET_CLOUD));
    expect(policy.support).toEqual({ limitedNetworking: false, packages: false });
  });
});

describe("mcpServerHost and mcpServerHosts", () => {
  it("reads an addressed server's host, lower case, and none for a local program or an address that is not a URL", () => {
    const plugin = {
      id: "plg_1",
      name: "files",
      status: create(PluginStatusSchema, {
        mcpServers: [
          create(McpServerEntrySchema, { name: "remote", transport: { case: "http", value: { url: "https://MCP.Linear.app:8443/sse" } } }),
          create(McpServerEntrySchema, { name: "disk", transport: { case: "stdio", value: { command: "npx" } } }),
          create(McpServerEntrySchema, { name: "broken", transport: { case: "http", value: { url: "not a url" } } }),
          create(McpServerEntrySchema, { name: "again", transport: { case: "http", value: { url: "https://mcp.linear.app/other" } } }),
        ],
      }),
    };
    const servers = serversOf(plugin);
    expect(servers.map(mcpServerHost)).toEqual(["mcp.linear.app", undefined, undefined, "mcp.linear.app"]);
    expect(mcpServerHosts(servers)).toEqual(["mcp.linear.app"]);
  });
});

describe("admitEnvironment", () => {
  it("refuses a conversation that names its own Environment where no server-started sandbox runs it, by id or slug", async () => {
    for (const ref of [{ id: "env_01box" }, { slug: "box" }]) {
      const error = await refusal(
        admitEnvironment({
          policy: LOCAL_ONLY,
          session: conversation({ spec: { executionTarget: ExecutionTarget.LOCAL, environmentRef: ref } }),
          environment: LIMITED,
          servers: [],
        }),
      );
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toBe(LOCAL_ENVIRONMENT_MESSAGE);
    }
  });

  it("passes a conversation that names none where the policy does not govern, whatever it holds", async () => {
    await expect(
      admitEnvironment({
        policy: { governs: () => false, support: { limitedNetworking: false, packages: false } },
        session: conversation({ environmentId: "env_01box", source: EnvironmentSource.ORGANIZATION }),
        environment: LIMITED,
        servers: agentServers({ name: "far", url: "https://far.example.org/mcp" }),
      }),
    ).resolves.toBeUndefined();
  });

  it("passes a governed conversation with no Environment", async () => {
    await expect(
      admitEnvironment({ policy: governing(), session: conversation({}), environment: undefined, servers: [] }),
    ).resolves.toBeUndefined();
  });

  it("refuses a conversation whose Environment was deleted, naming it", async () => {
    const error = await refusal(
      admitEnvironment({
        policy: governing(),
        session: conversation({ environmentId: "env_01box" }),
        environment: "gone",
        servers: [],
      }),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(deletedEnvironmentMessage("box"));
  });

  it("refuses limited networking, and packages, the current support cannot serve", async () => {
    const limited = await refusal(
      admitEnvironment({
        policy: governing({ limitedNetworking: false, packages: true }),
        session: conversation({ environmentId: "env_01box" }),
        environment: LIMITED,
        servers: [],
      }),
    );
    expect(limited.code).toBe(Code.FailedPrecondition);
    expect(limited.rawMessage).toContain("environment 'box' limits networking to listed hosts");
    const packaged = await refusal(
      admitEnvironment({
        policy: governing({ limitedNetworking: true, packages: false }),
        session: conversation({ environmentId: "env_01box" }),
        environment: environment({ packages: { npm: ["typescript"] } }),
        servers: [],
      }),
    );
    expect(packaged.code).toBe(Code.FailedPrecondition);
    expect(packaged.rawMessage).toContain("environment 'box' installs packages");
  });

  it("refuses an MCP server whose host a limited Environment does not list, naming the server and the host", async () => {
    const error = await refusal(
      admitEnvironment({
        policy: governing(),
        session: conversation({ environmentId: "env_01box" }),
        environment: LIMITED,
        servers: agentServers(
          { name: "tracker", url: "https://mcp.linear.app/sse" },
          { name: "search", url: "https://Search.Example.org/mcp" },
        ),
      }),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(unlistedMcpHostMessage("box", "search", "search.example.org"));
  });

  it("admits MCP servers a listed host admits, exactly or by wildcard, and does not ask a local program", async () => {
    const plugin = {
      id: "plg_1",
      name: "files",
      status: create(PluginStatusSchema, {
        mcpServers: [create(McpServerEntrySchema, { name: "disk", transport: { case: "stdio", value: { command: "npx" } } })],
      }),
    };
    await expect(
      admitEnvironment({
        policy: governing(),
        session: conversation({ environmentId: "env_01box" }),
        environment: LIMITED,
        servers: [
          ...agentServers(
            { name: "tracker", url: "https://mcp.linear.app/sse" },
            { name: "code", url: "https://api.github.com/mcp" },
          ),
          ...serversOf(plugin),
        ],
      }),
    ).resolves.toBeUndefined();
    // One more label than the wildcard: not admitted.
    const deeper = await refusal(
      admitEnvironment({
        policy: governing(),
        session: conversation({ environmentId: "env_01box" }),
        environment: LIMITED,
        servers: agentServers({ name: "tracker", url: "https://eu.mcp.linear.app/sse" }),
      }),
    );
    expect(deeper.rawMessage).toBe(unlistedMcpHostMessage("box", "tracker", "eu.mcp.linear.app"));
  });

  it("admits any MCP server when the limited Environment allows its MCP servers", async () => {
    await expect(
      admitEnvironment({
        policy: governing(),
        session: conversation({ environmentId: "env_01box" }),
        environment: environment({
          networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"], allowMcpServers: true },
        }),
        servers: agentServers({ name: "search", url: "https://search.example.org/mcp" }),
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses, at a turn, a person who may no longer view the Environment the conversation or its routine named", async () => {
    for (const source of [EnvironmentSource.SESSION, EnvironmentSource.ROUTINE]) {
      const { authorizer, asked } = recording({ kind: "deny", reason: "no" });
      const error = await refusal(
        admitEnvironment({
          policy: governing(),
          session: conversation({ environmentId: "env_01box", source }),
          environment: LIMITED,
          servers: [],
          viewer: { authorizer, caller: testCallerIdentity() },
        }),
      );
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(revokedEnvironmentMessage("box"));
      expect(asked).toEqual([
        { permission: IamPermission.can_view, resourceKind: ApiResourceKind.environment, resourceId: "env_01box" },
      ]);
    }
  });

  it("does not ask again for an agent's or the organization's default, at create, or for the server acting as itself", async () => {
    for (const source of [EnvironmentSource.AGENT, EnvironmentSource.ORGANIZATION]) {
      const { authorizer, asked } = recording({ kind: "deny", reason: "no" });
      await admitEnvironment({
        policy: governing(),
        session: conversation({ environmentId: "env_01box", source }),
        environment: LIMITED,
        servers: [],
        viewer: { authorizer, caller: testCallerIdentity() },
      });
      expect(asked).toEqual([]);
    }
    const { authorizer, asked } = recording({ kind: "deny", reason: "no" });
    await admitEnvironment({
      policy: governing(),
      session: conversation({ environmentId: "env_01box", source: EnvironmentSource.SESSION }),
      environment: LIMITED,
      servers: [],
      viewer: { authorizer, caller: testCallerIdentity({ callerClass: "internal" }) },
    });
    await admitEnvironment({
      policy: governing(),
      session: conversation({ environmentId: "env_01box", source: EnvironmentSource.SESSION }),
      environment: LIMITED,
      servers: [],
    });
    expect(asked).toEqual([]);
  });

  it("admits a person who may still view it", async () => {
    const { authorizer, asked } = recording({ kind: "allow" });
    await admitEnvironment({
      policy: governing(),
      session: conversation({ environmentId: "env_01box", source: EnvironmentSource.ROUTINE }),
      environment: LIMITED,
      servers: [],
      viewer: { authorizer, caller: testCallerIdentity() },
    });
    expect(asked).toHaveLength(1);
  });
});

describe("over a real store", () => {
  let dir: string;
  let store: Store;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "environment-admission-test-"));
    store = namingSaves(SqliteStore.open(path.join(dir, "stigmer.db")));
    await store.saveResource(ApiResourceKind.environment, "env_01box", EnvironmentSchema, LIMITED);
    await store.saveResource(
      ApiResourceKind.environment,
      "env_01open",
      EnvironmentSchema,
      environment(
        { networking: { type: NetworkingType.limited, allowedHosts: ["api.github.com"], allowMcpServers: true } },
        "env_01open",
        "open",
      ),
    );
    await store.saveResource(
      ApiResourceKind.agent,
      "agt_1",
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_1", org: ORG, slug: "reviewer" },
        spec: { mcpServers: [{ name: "search", url: "https://search.example.org/mcp" }] },
        status: { versionHash: AGENT_HASH },
      }),
    );
    await store.saveResource(
      ApiResourceKind.plugin,
      "plg_far",
      PluginSchema,
      create(PluginSchema, {
        metadata: { id: "plg_far", org: ORG, slug: "far", name: "far" },
        status: {
          digest: "c".repeat(64),
          mcpServers: [{ name: "far", transport: { case: "http", value: { url: "https://far.example.org/mcp" } } }],
        },
      }),
    );
    await store.saveResource(
      ApiResourceKind.plugin,
      "plg_near",
      PluginSchema,
      create(PluginSchema, {
        metadata: { id: "plg_near", org: ORG, slug: "near", name: "near" },
        status: {
          digest: "c".repeat(64),
          mcpServers: [{ name: "near", transport: { case: "http", value: { url: "https://api.github.com/mcp" } } }],
        },
      }),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("loadSessionEnvironment and sessionEnvironmentFacts", () => {
    it("read none, a row, or a deleted row", async () => {
      expect(await loadSessionEnvironment(store, conversation({}))).toBeUndefined();
      expect(await sessionEnvironmentFacts(store, conversation({}))).toBeUndefined();
      expect((await loadSessionEnvironment(store, conversation({ environmentId: "env_01box" }))) as Environment).toEqual(
        LIMITED,
      );
      expect(await loadSessionEnvironment(store, conversation({ environmentId: "env_01gone" }))).toBe("gone");
      const gone = await refusal(sessionEnvironmentFacts(store, conversation({ environmentId: "env_01gone" })));
      expect(gone.code).toBe(Code.FailedPrecondition);
      expect(gone.rawMessage).toBe(deletedEnvironmentMessage("box"));
    });

    it("answer INTERNAL when the store cannot read the conversation's Environment", async () => {
      const faulty = { getResource: async () => Promise.reject(new Error("disk unreadable")) } as unknown as Store;
      const failed = await refusal(loadSessionEnvironment(faulty, conversation({ environmentId: "env_01box" })));
      expect(failed.code).toBe(Code.Internal);
      expect(failed.rawMessage).toBe("failed to load the conversation's environment");
    });

    it("add the pinned agent's MCP hosts only for a limited Environment that allows them", async () => {
      const closed = await sessionEnvironmentFacts(store, conversation({ environmentId: "env_01box", agentId: "agt_1" }));
      expect(closed?.network).toEqual({
        mode: "limited",
        hosts: [
          { host: "api.github.com", cleartext: false },
          { host: "*.linear.app", cleartext: false },
        ],
      });
      const open = await sessionEnvironmentFacts(store, conversation({ environmentId: "env_01open", agentId: "agt_1" }));
      expect(open?.id).toBe("env_01open");
      expect(open?.network).toEqual({
        mode: "limited",
        hosts: [
          { host: "api.github.com", cleartext: false },
          { host: "search.example.org", cleartext: false },
        ],
      });
    });
  });

  describe("planRunValues, at run create and recover", () => {
    function deps(
      session: Session,
      asked: RunCredentialInput[],
      authorizer: Authorizer,
    ): RunValuePlannerDeps {
      return {
        store,
        logger: silentLogger,
        agentLoader: () => ({
          get: async () => {
            throw new Error("the turn names no agent");
          },
          getVersion: async () => {
            throw new Error("the turn names no agent");
          },
        }),
        sessionLoader: () => ({ get: async () => session }),
        vaultResolver: {
          planRun: async (input) => {
            asked.push(input);
            return [];
          },
          openRun: async () => {
            throw new Error("the planner never opens a value");
          },
          planConnect: async () => {
            throw new Error("the run planner never asks the connect lane's question");
          },
          openConnect: async () => {
            throw new Error("the planner never opens a value");
          },
        },
        environments: { policy: governing(), authorizer },
      };
    }

    function turn(): Run {
      return create(RunSchema, {
        metadata: { id: "run_1", org: ORG },
        spec: { target: { case: "sessionId", value: "ses_1" }, message: "hi" },
      });
    }

    const PERSON: CallerIdentity = testCallerIdentity({ identityId: "ida_person" });

    it("refuses a turn whose conversation's plugin dials a host the limited Environment does not list, before any value is asked for", async () => {
      const asked: RunCredentialInput[] = [];
      const session = conversation({ environmentId: "env_01box", plugins: [{ org: ORG, slug: "far" }] });
      const error = await refusal(planRunValues(deps(session, asked, recording({ kind: "allow" }).authorizer), turn(), PERSON));
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toContain("environment 'box' limits networking and does not allow the agent's MCP servers");
      expect(error.rawMessage).toContain("at 'far.example.org' is not one of its allowed hosts");
      expect(asked).toEqual([]);
    });

    it("plans a turn whose servers' hosts are listed, asking the turn's caller can_view", async () => {
      const asked: RunCredentialInput[] = [];
      const { authorizer, asked: checks } = recording({ kind: "allow" });
      const session = conversation({ environmentId: "env_01box", plugins: [{ org: ORG, slug: "near" }] });
      await planRunValues(deps(session, asked, authorizer), turn(), PERSON);
      expect(asked).toHaveLength(1);
      expect(checks.map((check) => check.resourceId)).toEqual(["env_01box"]);
    });

    it("refuses a turn whose Environment was deleted, and one whose person may no longer view it", async () => {
      const deleted = await refusal(
        planRunValues(
          deps(conversation({ environmentId: "env_01gone" }), [], recording({ kind: "allow" }).authorizer),
          turn(),
          PERSON,
        ),
      );
      expect(deleted.rawMessage).toBe(deletedEnvironmentMessage("box"));
      const revoked = await refusal(
        planRunValues(
          deps(conversation({ environmentId: "env_01box" }), [], recording({ kind: "deny", reason: "no" }).authorizer),
          turn(),
          PERSON,
        ),
      );
      expect(revoked.code).toBe(Code.PermissionDenied);
      expect(revoked.rawMessage).toBe(revokedEnvironmentMessage("box"));
    });
  });
});
