/**
 * The EC builder ASSEMBLY test — panel finding (Reviewer B #3): the
 * pieces (envmerge, refresh, filter) are unit-tested standalone, but the
 * composition — resolve refs → merge layers → least-privilege filter →
 * OAuth injection with inline pre-flight refresh → EC persist — needs one
 * test driving a NON-EMPTY environment and a real token injection through
 * buildAndPersistExecutionContext. Go has no unit twin (its coverage is
 * the execution conformance suites); this pin is TS-only by design.
 *
 * Also pins the one declaration rule (the module header of the step): the
 * agent's env united with the session servers' env, and a session
 * server's saved key reaching the run from the personal environment — for
 * an agent-bound run and for the built-in assistant alike.
 *
 * And the minting PlatformClient's layer (#1256): an execution whose audit
 * names the client a minted user came through receives the client's
 * environments BELOW the instance layer and runtime_env; a creator with no
 * client reads no client at all; a deleted client or one of another
 * organization contributes nothing; an unresolvable ref fails the create;
 * and the layer survives the runner's status writes, so recovery — which
 * rebuilds from the persisted execution with no minted caller — delivers
 * it again.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentExecutionUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { EnvironmentValue } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { EnvironmentValueSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import type { ManagedEnvironmentService } from "../../mcpserver/oauth/managed-env.js";

import type { ExecutionContextBuilderDeps } from "../create-execution-context-step.js";
import { buildAndPersistExecutionContext } from "../create-execution-context-step.js";
import { applyUpdateStatusMerge } from "../update-status.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/**
 * The client port for every execution no minted user created: the layer
 * answers from the execution's own audit, so reaching this is a failure.
 */
const unreadPlatformClients: ExecutionContextBuilderDeps["platformClients"] = {
  findById: async () => {
    throw new Error("no minting client: the client must not be read");
  },
};

let dir: string;
let store: Store;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aexec-ecbuilder-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

it("an unresolvable environment ref surfaces the inner status code with Go's wrap chain", async () => {
  // Go wraps the typed resolution status with %w — a deleted environment
  // answers NotFound (caller-fixable), never an opaque Internal.
  const deps: ExecutionContextBuilderDeps = {
    store,
    logger: silentLogger,
    agentLoader: () => ({
      get: async () =>
        create(AgentSchema, { metadata: { id: "agt_x", org: "acme" } }),
    }),
    agentInstanceLoader: () => ({
      get: async (instanceId) =>
        create(AgentInstanceSchema, {
          metadata: { id: instanceId, org: "acme" },
          spec: {
            agentId: "agt_x",
            environmentRefs: [
              {
                kind: ApiResourceKind.environment,
                org: "acme",
                slug: "deleted-env",
              },
            ],
          },
        }),
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: "acme" },
          spec: { agentInstanceId: "agi_x" },
        }),
    }),
    environmentReader: () => ({
      list: async () => {
        throw new Error("unreached");
      },
      getSecretValue: async () => {
        throw new Error("unreached");
      },
    }),
    environmentResolution: {
      resolveByReference: async () => {
        throw new ConnectError(
          "environment not found: deleted-env",
          Code.NotFound,
        );
      },
    } as unknown as ExecutionContextBuilderDeps["environmentResolution"],
    executionContextCreator: () => ({
      create: async (ec) => ec,
    }),
    // The create path never deletes a context.
    executionContextDeleter: () => ({
      delete: () => Promise.reject(new Error("unused on the create path")),
    }),
    managedEnvService: {
      readSecretValue: async () => "",
      updateSecrets: async () => {},
    } as unknown as ManagedEnvironmentService,
    platformClients: unreadPlatformClients,
  };

  const execution = create(AgentExecutionSchema, {
    metadata: { id: "aexec_ref_gone", org: "acme" },
    spec: { sessionId: "ses_x", message: "hi" },
  });

  try {
    await buildAndPersistExecutionContext(deps, execution, "");
    expect.unreachable("expected NotFound");
  } catch (error) {
    const connectError = ConnectError.from(error);
    expect(connectError.code).toBe(Code.NotFound);
    expect(connectError.rawMessage).toBe(
      "resolve environment ref (org=acme, slug=deleted-env): " +
        "rpc error: code = NotFound desc = environment not found: deleted-env",
    );
  }
});

it("assembles merge → filter → OAuth injection → EC persist over a non-empty environment", async () => {
  const ORG = "acme";
  const EXEC_ID = "aexec_ec_assembly";
  const now = Math.floor(Date.now() / 1000);

  // An MCP server with spec.auth, an EXPIRED grant against it, and a
  // managed environment holding the refresh token — the full injection
  // chain including the inline pre-flight refresh.
  await store.saveResource(
    ApiResourceKind.mcp_server,
    "mcps_vendor",
    McpServerSchema,
    create(McpServerSchema, {
      metadata: { id: "mcps_vendor", org: ORG, slug: "vendor" },
      spec: { auth: {} },
    }),
  );
  await store.oauthGrants.upsert({
    identityAccountId: "",
    resourceId: "mcps_vendor",
    resourceKind: "mcp_server",
    orgId: ORG,
    accessTokenExpiresAt: now - 10, // expired → refresh must run
    clientId: "client-1",
    authMethod: "mcp_oauth",
    tokenEndpoint: "https://vendor.example/token",
    accessTokenEnvVar: "VENDOR_TOKEN",
    refreshTokenEnvVar: "VENDOR_REFRESH_TOKEN",
    environmentId: "env_managed",
    createdAt: 0,
    updatedAt: 0,
  });

  // The managed environment as a live map: the refresh writes rotated
  // tokens through updateSecrets, and the injection reads the access
  // token back — proving write-then-read, not two isolated stubs.
  const managedSecrets = new Map<string, string>([
    ["VENDOR_REFRESH_TOKEN", "rt-old"],
  ]);
  const managedEnvService = {
    readSecretValue: async (_envId: string, key: string) =>
      managedSecrets.get(key) ?? "",
    updateSecrets: async (
      _envId: string,
      variables: { [key: string]: EnvironmentValue },
    ) => {
      for (const [key, value] of Object.entries(variables)) {
        managedSecrets.set(key, value.value);
      }
    },
  } as unknown as ManagedEnvironmentService;

  const environment = create(EnvironmentSchema, {
    metadata: { id: "env_1", org: ORG, slug: "shared-secrets" },
    spec: {
      data: {
        API_KEY: { value: "key-123", isSecret: true },
        EXTRA: { value: "not-declared", isSecret: false },
      },
    },
  });

  const agent = create(AgentSchema, {
    metadata: { id: "agt_ec", org: ORG, slug: "ec-agent" },
    spec: {
      // Least-privilege: only API_KEY is declared — EXTRA must be
      // filtered out of the merge.
      env: { API_KEY: { isSecret: true } },
      mcpServerUsages: [{ mcpServerRef: { slug: "vendor", org: ORG } }],
    },
  });

  const createdEcs: ExecutionContext[] = [];
  const deps: ExecutionContextBuilderDeps = {
    store,
    logger: silentLogger,
    agentLoader: () => ({ get: async () => agent }),
    agentInstanceLoader: () => ({
      get: async (instanceId) =>
        create(AgentInstanceSchema, {
          metadata: { id: instanceId, org: ORG },
          spec: {
            agentId: "agt_ec",
            environmentRefs: [
              {
                kind: ApiResourceKind.environment,
                org: ORG,
                slug: "shared-secrets",
              },
            ],
          },
        }),
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: ORG },
          spec: { agentInstanceId: "agi_ec" },
        }),
    }),
    environmentReader: () => ({
      list: async () => {
        throw new Error("personal-env lookup not needed in this test");
      },
      getSecretValue: async () => {
        throw new Error("personal-env lookup not needed in this test");
      },
    }),
    environmentResolution: {
      resolveByReference: async () => environment,
    } as unknown as ExecutionContextBuilderDeps["environmentResolution"],
    executionContextCreator: () => ({
      create: async (ec) => {
        createdEcs.push(ec);
        return ec;
      },
    }),
    // The create path never deletes a context.
    executionContextDeleter: () => ({
      delete: () => Promise.reject(new Error("unused on the create path")),
    }),
    managedEnvService,
    platformClients: unreadPlatformClients,
    // The vendor's token endpoint: rotates the refresh token and issues
    // a fresh access token.
    fetchImpl: async () =>
      new Response(
        '{"access_token":"at-fresh","refresh_token":"rt-new","expires_in":3600}',
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  };

  const execution = create(AgentExecutionSchema, {
    metadata: { id: EXEC_ID, org: ORG },
    spec: {
      sessionId: "ses_ec",
      message: "hi",
      // runtime_env overrides the environment layer for declared keys.
      runtimeEnv: { API_KEY: { value: "runtime-wins", isSecret: true } },
    },
  });

  await buildAndPersistExecutionContext(deps, execution, "");

  expect(createdEcs).toHaveLength(1);
  const data = createdEcs[0]?.spec?.data ?? {};

  // Merge priority: runtime_env beat the environment layer.
  expect(data["API_KEY"]?.value).toBe("runtime-wins");
  expect(data["API_KEY"]?.isSecret).toBe(true);
  // Least-privilege filter: the undeclared key never reaches the EC.
  expect(data["EXTRA"]).toBeUndefined();
  // OAuth injection: the freshly-refreshed token, marked secret.
  expect(data["VENDOR_TOKEN"]?.value).toBe("at-fresh");
  expect(data["VENDOR_TOKEN"]?.isSecret).toBe(true);

  // The refresh wrote the rotated tokens back to the managed environment...
  expect(managedSecrets.get("VENDOR_REFRESH_TOKEN")).toBe("rt-new");
  // ...and the grant's expiry was advanced past the old one.
  const grant = await store.oauthGrants.find("", "mcps_vendor", ORG);
  expect(grant?.accessTokenExpiresAt ?? 0).toBeGreaterThan(now);
});

// ---------------------------------------------------------------------------
// The one declaration rule: the run declares what its agent declares AND
// what its session's MCP servers declare, and a session server's declared
// variables the merge chain never carried (no instance layer can) come
// from the caller's personal environment by declared key. Two shapes, one
// rule: an agent-bound run whose session added a server, and the built-in
// assistant, which is the case with no agent half at all.
// ---------------------------------------------------------------------------

/** A personal environment reader over a fixed map; every read is recorded. */
function personalEnvironmentOver(
  org: string,
  data: Record<string, string>,
  reads: string[],
): ReturnType<ExecutionContextBuilderDeps["environmentReader"]> {
  return {
    list: async () => ({
      $typeName: "ai.stigmer.agentic.environment.v1.EnvironmentList",
      totalCount: 1,
      items: [
        create(EnvironmentSchema, {
          metadata: { id: "env_personal", org, slug: "personal" },
          spec: {
            data: Object.fromEntries(
              Object.keys(data).map((key) => [key, { value: "***", isSecret: true }]),
            ),
          },
        }),
      ],
    }),
    getSecretValue: async (input) => {
      const key = input.key ?? "";
      reads.push(key);
      return create(EnvironmentValueSchema, {
        value: data[key] ?? "",
        isSecret: true,
      });
    },
  };
}

it("a session-level server's declared key saved in the personal environment reaches an agent-bound run", async () => {
  const ORG = "acme";
  await store.saveResource(
    ApiResourceKind.mcp_server,
    "mcps_github",
    McpServerSchema,
    create(McpServerSchema, {
      metadata: { id: "mcps_github", org: ORG, slug: "github" },
      spec: {
        env: {
          GITHUB_PAT: { isSecret: true },
          GITHUB_ORG: { isSecret: false, optional: true },
        },
      },
    }),
  );
  const agent = create(AgentSchema, {
    metadata: { id: "agt_rule", org: ORG, slug: "rule-agent" },
    // The agent declares its own key and nothing of the session's server.
    spec: { env: { API_KEY: { isSecret: true } } },
  });
  const reads: string[] = [];
  const createdEcs: ExecutionContext[] = [];
  const deps: ExecutionContextBuilderDeps = {
    store,
    logger: silentLogger,
    agentLoader: () => ({ get: async () => agent }),
    agentInstanceLoader: () => ({
      get: async (instanceId) =>
        create(AgentInstanceSchema, {
          metadata: { id: instanceId, org: ORG },
          spec: { agentId: "agt_rule" },
        }),
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: ORG },
          spec: {
            agentInstanceId: "agi_rule",
            // Added at the session level: no instance, no environment_refs.
            mcpServerUsages: [{ mcpServerRef: { slug: "github", org: ORG } }],
          },
        }),
    }),
    environmentReader: () =>
      personalEnvironmentOver(ORG, { GITHUB_PAT: "ghp-saved", API_KEY: "never-read" }, reads),
    environmentResolution: {
      resolveByReference: async () => {
        throw new Error("no environment refs on this instance");
      },
    } as unknown as ExecutionContextBuilderDeps["environmentResolution"],
    executionContextCreator: () => ({
      create: async (ec) => {
        createdEcs.push(ec);
        return ec;
      },
    }),
    // The create path never deletes a context.
    executionContextDeleter: () => ({
      delete: () => Promise.reject(new Error("unused on the create path")),
    }),
    managedEnvService: {
      readSecretValue: async () => "",
      updateSecrets: async () => {},
    } as unknown as ManagedEnvironmentService,
    platformClients: unreadPlatformClients,
  };
  const execution = create(AgentExecutionSchema, {
    metadata: { id: "aexec_rule", org: ORG },
    spec: {
      sessionId: "ses_rule",
      message: "hi",
      runtimeEnv: {
        API_KEY: { value: "runtime", isSecret: true },
        UNDECLARED: { value: "stripped", isSecret: false },
      },
    },
  });

  await buildAndPersistExecutionContext(deps, execution, "");

  const data = createdEcs[0]?.spec?.data ?? {};
  // The agent's own key still flows as before.
  expect(data["API_KEY"]?.value).toBe("runtime");
  // The session server's declared key survives the filter (the union) and
  // is resolved from the personal environment, marked secret as declared.
  expect(data["GITHUB_PAT"]?.value).toBe("ghp-saved");
  expect(data["GITHUB_PAT"]?.isSecret).toBe(true);
  // A key nobody declared is filtered, as before.
  expect(data["UNDECLARED"]).toBeUndefined();
  // Least privilege: only the session server's still-missing declared key
  // the personal environment HOLDS was read — never the agent's (already
  // present), never a key the environment lacks (the optional one is
  // skipped on the stored-keys check, no secret read), never the whole
  // environment.
  expect(reads).toEqual(["GITHUB_PAT"]);
  expect(data["GITHUB_ORG"]).toBeUndefined();
});

it("the built-in assistant: no instance, no agent, the session's servers are the declared set", async () => {
  const ORG = "acme";
  await store.saveResource(
    ApiResourceKind.mcp_server,
    "mcps_notes",
    McpServerSchema,
    create(McpServerSchema, {
      metadata: { id: "mcps_notes", org: ORG, slug: "notes" },
      spec: { env: { NOTES_TOKEN: { isSecret: true } } },
    }),
  );
  const reads: string[] = [];
  const createdEcs: ExecutionContext[] = [];
  const deps: ExecutionContextBuilderDeps = {
    store,
    logger: silentLogger,
    // Neither lane may be reached: there is no instance and no agent.
    agentLoader: () => ({
      get: async () => {
        throw new Error("agent loader must not be reached");
      },
    }),
    agentInstanceLoader: () => ({
      get: async () => {
        throw new Error("instance loader must not be reached");
      },
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: ORG },
          spec: {
            agentInstanceId: "",
            mcpServerUsages: [{ mcpServerRef: { slug: "notes", org: ORG } }],
          },
        }),
    }),
    environmentReader: () => personalEnvironmentOver(ORG, { NOTES_TOKEN: "nt-saved" }, reads),
    environmentResolution: {
      resolveByReference: async () => {
        throw new Error("no environment refs without an instance");
      },
    } as unknown as ExecutionContextBuilderDeps["environmentResolution"],
    executionContextCreator: () => ({
      create: async (ec) => {
        createdEcs.push(ec);
        return ec;
      },
    }),
    // The create path never deletes a context.
    executionContextDeleter: () => ({
      delete: () => Promise.reject(new Error("unused on the create path")),
    }),
    managedEnvService: {
      readSecretValue: async () => "",
      updateSecrets: async () => {},
    } as unknown as ManagedEnvironmentService,
    platformClients: unreadPlatformClients,
  };
  const execution = create(AgentExecutionSchema, {
    metadata: { id: "aexec_assistant", org: ORG },
    spec: {
      sessionId: "ses_assistant",
      message: "hi",
      runtimeEnv: { STRAY: { value: "stripped", isSecret: false } },
    },
  });

  await buildAndPersistExecutionContext(deps, execution, "");

  expect(createdEcs).toHaveLength(1);
  const data = createdEcs[0]?.spec?.data ?? {};
  expect(data["NOTES_TOKEN"]?.value).toBe("nt-saved");
  // The declared set is the session servers' alone, so the filter is
  // live: a stray runtime key is stripped, not passed through.
  expect(data["STRAY"]).toBeUndefined();
  expect(reads).toEqual(["NOTES_TOKEN"]);
});

// ---------------------------------------------------------------------------
// The minting PlatformClient's layer (#1256): keyed on the execution's
// audit created_by.platform_client_id, which the server stamped from the
// verified token, below every other layer.
// ---------------------------------------------------------------------------

const PC_ORG = "acme";

function environmentOf(
  slug: string,
  data: Record<string, string>,
  org = PC_ORG,
): ReturnType<typeof create<typeof EnvironmentSchema>> {
  return create(EnvironmentSchema, {
    metadata: { id: `env_${slug}`, org, slug },
    spec: {
      data: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, { value, isSecret: true }]),
      ),
    },
  });
}

/** A PlatformClient of `org` whose environment_refs name `slugs`. */
function mintingClient(org: string, ...slugs: string[]): PlatformClient {
  return create(PlatformClientSchema, {
    metadata: { id: "pcl_dashboard", org, slug: "dashboard" },
    spec: {
      environmentRefs: slugs.map((slug) => ({
        kind: ApiResourceKind.environment,
        org,
        slug,
      })),
    },
  });
}

/** An execution in PC_ORG created by an actor who came through `platformClientId`. */
function executionCreatedThrough(
  id: string,
  platformClientId: string,
  runtimeEnv: Record<string, string> = {},
): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: { id, org: PC_ORG },
    spec: {
      sessionId: `ses_${id}`,
      message: "hi",
      runtimeEnv: Object.fromEntries(
        Object.entries(runtimeEnv).map(([key, value]) => [key, { value, isSecret: true }]),
      ),
    },
    status: {
      audit: {
        specAudit: { createdBy: { id: "ida_pat", platformClientId } },
      },
    },
  });
}

/**
 * Builder deps for an agent that declares nothing (every merged key passes
 * the filter) over an instance whose one ref is `instance-secrets`. Every
 * resolved reference and every client read is recorded.
 */
function platformClientLayerDeps(opts: {
  readonly client: PlatformClient | undefined;
  readonly environments: ReadonlyArray<ReturnType<typeof environmentOf>>;
  readonly resolved: ApiResourceReference[];
  readonly clientReads: string[];
  readonly createdEcs: ExecutionContext[];
}): ExecutionContextBuilderDeps {
  return {
    store,
    logger: silentLogger,
    agentLoader: () => ({
      get: async () =>
        create(AgentSchema, { metadata: { id: "agt_pc", org: PC_ORG } }),
    }),
    agentInstanceLoader: () => ({
      get: async (instanceId) =>
        create(AgentInstanceSchema, {
          metadata: { id: instanceId, org: PC_ORG },
          spec: {
            agentId: "agt_pc",
            environmentRefs: [
              {
                kind: ApiResourceKind.environment,
                org: PC_ORG,
                slug: "instance-secrets",
              },
            ],
          },
        }),
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: PC_ORG },
          spec: { agentInstanceId: "agi_pc" },
        }),
    }),
    environmentReader: () => ({
      list: async () => {
        throw new Error("personal-env lookup not needed in this test");
      },
      getSecretValue: async () => {
        throw new Error("personal-env lookup not needed in this test");
      },
    }),
    environmentResolution: {
      resolveByReference: async (ref: ApiResourceReference) => {
        opts.resolved.push(ref);
        const found = opts.environments.find(
          (env) => env.metadata?.slug === ref.slug && env.metadata?.org === ref.org,
        );
        if (found === undefined) {
          throw new ConnectError(`environment not found: ${ref.slug}`, Code.NotFound);
        }
        return found;
      },
    } as unknown as ExecutionContextBuilderDeps["environmentResolution"],
    executionContextCreator: () => ({
      create: async (ec) => {
        opts.createdEcs.push(ec);
        return ec;
      },
    }),
    // The create path never deletes a context.
    executionContextDeleter: () => ({
      delete: () => Promise.reject(new Error("unused on the create path")),
    }),
    managedEnvService: {
      readSecretValue: async () => "",
      updateSecrets: async () => {},
    } as unknown as ManagedEnvironmentService,
    platformClients: {
      findById: async (id) => {
        opts.clientReads.push(id);
        return opts.client;
      },
    },
  };
}

const instanceSecrets = environmentOf("instance-secrets", {
  INSTANCE_WINS: "instance",
});
const clientSecrets = environmentOf("embed-secrets", {
  SHARED_API_SECRET: "client-secret",
  INSTANCE_WINS: "client",
  RUNTIME_WINS: "client",
});

it("a minted user's execution receives its client's environments below the instance layer and runtime_env", async () => {
  const resolved: ApiResourceReference[] = [];
  const clientReads: string[] = [];
  const createdEcs: ExecutionContext[] = [];
  const deps = platformClientLayerDeps({
    client: mintingClient(PC_ORG, "embed-secrets"),
    environments: [instanceSecrets, clientSecrets],
    resolved,
    clientReads,
    createdEcs,
  });

  await buildAndPersistExecutionContext(
    deps,
    executionCreatedThrough("aexec_pc_layer", "pcl_dashboard", {
      RUNTIME_WINS: "runtime",
    }),
    "",
  );

  const data = createdEcs[0]?.spec?.data ?? {};
  // The client's own key reaches the run.
  expect(data["SHARED_API_SECRET"]?.value).toBe("client-secret");
  // The precedence #1256 asks to pin: instance refs, then runtime_env,
  // override the client on a key conflict.
  expect(data["INSTANCE_WINS"]?.value).toBe("instance");
  expect(data["RUNTIME_WINS"]?.value).toBe("runtime");
  expect(clientReads).toEqual(["pcl_dashboard"]);
  expect(resolved.map((ref) => `${ref.org}/${ref.slug}`)).toEqual([
    "acme/instance-secrets",
    "acme/embed-secrets",
  ]);
});

it("no client, a deleted client and a client of another organization contribute nothing", async () => {
  // A creator who came through no client: no client is read at all.
  const noClient: ExecutionContext[] = [];
  await buildAndPersistExecutionContext(
    {
      ...platformClientLayerDeps({
        client: undefined,
        environments: [instanceSecrets],
        resolved: [],
        clientReads: [],
        createdEcs: noClient,
      }),
      platformClients: unreadPlatformClients,
    },
    executionCreatedThrough("aexec_pc_none", ""),
    "",
  );
  expect(noClient[0]?.spec?.data["INSTANCE_WINS"]?.value).toBe("instance");

  // The client was deleted since: the run proceeds without its layer.
  const deleted: ExecutionContext[] = [];
  const deletedReads: string[] = [];
  await buildAndPersistExecutionContext(
    platformClientLayerDeps({
      client: undefined,
      environments: [instanceSecrets, clientSecrets],
      resolved: [],
      clientReads: deletedReads,
      createdEcs: deleted,
    }),
    executionCreatedThrough("aexec_pc_deleted", "pcl_dashboard"),
    "",
  );
  expect(deletedReads).toEqual(["pcl_dashboard"]);
  expect(deleted[0]?.spec?.data["SHARED_API_SECRET"]).toBeUndefined();
  expect(deleted[0]?.spec?.data["INSTANCE_WINS"]?.value).toBe("instance");

  // A client of another organization: no environment value crosses an
  // organization, so its refs are never even resolved.
  const foreign: ExecutionContext[] = [];
  const foreignResolved: ApiResourceReference[] = [];
  await buildAndPersistExecutionContext(
    platformClientLayerDeps({
      client: mintingClient("globex", "embed-secrets"),
      environments: [instanceSecrets, environmentOf("embed-secrets", { SHARED_API_SECRET: "x" }, "globex")],
      resolved: foreignResolved,
      clientReads: [],
      createdEcs: foreign,
    }),
    executionCreatedThrough("aexec_pc_foreign", "pcl_dashboard"),
    "",
  );
  expect(foreign[0]?.spec?.data["SHARED_API_SECRET"]).toBeUndefined();
  expect(foreignResolved.map((ref) => ref.org)).toEqual(["acme"]);
});

it("a client environment that no longer exists fails the create with the client named in the chain", async () => {
  try {
    await buildAndPersistExecutionContext(
      platformClientLayerDeps({
        client: mintingClient(PC_ORG, "gone-secrets"),
        environments: [instanceSecrets],
        resolved: [],
        clientReads: [],
        createdEcs: [],
      }),
      executionCreatedThrough("aexec_pc_gone", "pcl_dashboard"),
      "",
    );
    expect.unreachable("expected NotFound");
  } catch (error) {
    const connectError = ConnectError.from(error);
    expect(connectError.code).toBe(Code.NotFound);
    expect(connectError.rawMessage).toBe(
      "resolve platform client pcl_dashboard environment_refs: " +
        "resolve environment ref (org=acme, slug=gone-secrets): " +
        "rpc error: code = NotFound desc = environment not found: gone-secrets",
    );
  }
});

it("the layer survives the runner's status writes, so recovery delivers it again", async () => {
  const execution = executionCreatedThrough("aexec_pc_recover", "pcl_dashboard");
  // The runner's progressive status write, as UpdateStatus applies it.
  applyUpdateStatusMerge(
    execution,
    create(AgentExecutionUpdateStatusInputSchema, {
      executionId: "aexec_pc_recover",
      status: { phase: ExecutionPhase.EXECUTION_FAILED, error: "boom" },
    }),
    silentLogger,
  );
  expect(
    execution.status?.audit?.specAudit?.createdBy?.platformClientId,
  ).toBe("pcl_dashboard");

  // Recover rebuilds from the persisted execution with no pre-resolved
  // instance and no minted caller (lifecycle.ts's recreate step).
  const createdEcs: ExecutionContext[] = [];
  await buildAndPersistExecutionContext(
    platformClientLayerDeps({
      client: mintingClient(PC_ORG, "embed-secrets"),
      environments: [instanceSecrets, clientSecrets],
      resolved: [],
      clientReads: [],
      createdEcs,
    }),
    execution,
    "",
  );
  expect(createdEcs[0]?.spec?.data["SHARED_API_SECRET"]?.value).toBe(
    "client-secret",
  );
});
