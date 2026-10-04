/**
 * The EC builder ASSEMBLY test: the
 * pieces (envmerge, refresh, filter) are unit-tested standalone, but the
 * composition — resolve refs → merge layers → least-privilege filter →
 * OAuth injection with inline pre-flight refresh → EC persist — needs one
 * test driving a NON-EMPTY environment and a real token injection through
 * buildAndPersistExecutionContext. Go has no unit twin (its coverage is
 * the execution conformance suites); this pin is TS-only by design.
 *
 * The builder's inputs are the execution alone: the session it loads by
 * the target oneof's session id, and the agent the turn's stamp names (a
 * turn with no stamp declares no agent half, whatever its session pins).
 * The environment layers here are the schedule's (a schedule-labelled
 * execution, which has no person) and the minting PlatformClient's (one
 * that keeps the run's person, for the personal-environment bridge).
 *
 * Also pins the one declaration rule (the module header of the step): the
 * agent's env united with the session servers' env, and a declared key
 * the layers did not carry reaching the run from the personal environment
 * after every layer — an agent's key and a session server's alike, for an
 * agent-bound run and for the built-in assistant — never a key a layer
 * already carried, and never a session server's OAuth target key, which
 * is the managed grant's.
 *
 * And the minting PlatformClient's layer (#1256): an execution whose audit
 * names the client a minted user came through receives the client's
 * environments BELOW the schedule layer and runtime_env; a creator with no
 * client reads no client at all; a deleted client or one of another
 * organization contributes nothing; an unresolvable ref fails the create;
 * and the layer survives the runner's status writes, so recovery — which
 * rebuilds from the persisted execution with no minted caller — delivers
 * it again.
 *
 * And the agent half is the agent the turn recorded at create: a turn with
 * a recorded version rebuilds from that version's spec, never the agent's
 * head, so recovery after an author's edit declares what the turn ran with;
 * a recorded version that no longer resolves refuses, naming it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentVersionEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type { AgentVersionEntry } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentExecutionUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { EnvironmentValue } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { EnvironmentValueSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
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
import {
  buildAndPersistExecutionContext,
  SCHEDULE_ID_LABEL_KEY,
} from "../create-execution-context-step.js";
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

/**
 * Saves schedule `id` of `org` whose agent target names the environments
 * `slugs`, and answers the labels an execution it fired carries: the
 * schedule layer, the environment layer these tests drive.
 */
async function scheduleLayer(
  id: string,
  org: string,
  ...slugs: string[]
): Promise<{ [key: string]: string }> {
  await store.saveResource(
    ApiResourceKind.schedule,
    id,
    ScheduleSchema,
    create(ScheduleSchema, {
      metadata: { id, org, slug: id },
      spec: {
        target: {
          case: "agent",
          value: {
            environmentRefs: slugs.map((slug) => ({
              kind: ApiResourceKind.environment,
              org,
              slug,
            })),
          },
        },
      },
    }),
  );
  return { [SCHEDULE_ID_LABEL_KEY]: id };
}

it("an unresolvable environment ref surfaces the inner status code with Go's wrap chain", async () => {
  // Go wraps the typed resolution status with %w — a deleted environment
  // answers NotFound (caller-fixable), never an opaque Internal.
  const deps: ExecutionContextBuilderDeps = {
    store,
    logger: silentLogger,
    agentLoader: () => ({
      get: async () =>
        create(AgentSchema, { metadata: { id: "agt_x", org: "acme" } }),
      getVersion: async () => {
        throw new Error("this turn records no agent version");
      },
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: "acme" },
          spec: { agentRef: { org: "acme", slug: "agent-x" } },
          status: { agentId: "agt_x" },
        }),
    }),
    environmentReader: () => ({
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
    metadata: {
      id: "aexec_ref_gone",
      org: "acme",
      labels: await scheduleLayer("sch_ref_gone", "acme", "deleted-env"),
    },
    spec: { target: { case: "sessionId", value: "ses_x" }, message: "hi" },
    status: { agentId: "agt_x" },
  });

  try {
    await buildAndPersistExecutionContext(deps, execution);
    expect.unreachable("expected NotFound");
  } catch (error) {
    const connectError = ConnectError.from(error);
    expect(connectError.code).toBe(Code.NotFound);
    expect(connectError.rawMessage).toBe(
      "resolve schedule sch_ref_gone environment_refs: " +
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
  const sessionReads: string[] = [];
  const deps: ExecutionContextBuilderDeps = {
    store,
    logger: silentLogger,
    agentLoader: () => ({
      get: async () => agent,
      getVersion: async () => {
        throw new Error("this turn records no agent version");
      },
    }),
    sessionLoader: () => ({
      get: async (sessionId) => {
        sessionReads.push(sessionId);
        return create(SessionSchema, {
          metadata: { id: sessionId, org: ORG },
          spec: { agentRef: { org: ORG, slug: "ec-agent" } },
          status: { agentId: "agt_ec" },
        });
      },
    }),
    environmentReader: () => ({
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
    metadata: {
      id: EXEC_ID,
      org: ORG,
      labels: await scheduleLayer("sch_ec", ORG, "shared-secrets"),
    },
    spec: {
      target: { case: "sessionId", value: "ses_ec" },
      message: "hi",
      // runtime_env overrides the environment layer for declared keys.
      runtimeEnv: { API_KEY: { value: "runtime-wins", isSecret: true } },
    },
    status: { agentId: "agt_ec" },
  });

  await buildAndPersistExecutionContext(deps, execution);

  // The session is the one the target oneof names.
  expect(sessionReads).toEqual(["ses_ec"]);
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
// what its session's MCP servers declare, and the declared variables no
// layer carried come from the run's person's personal environment by
// declared key, after every layer. Two shapes, one rule: an agent-bound
// run whose session added a server, and the built-in assistant, which is
// the case with no agent half at all. Whose environment is pinned in
// personal-environment-reach.test.ts.
// ---------------------------------------------------------------------------

/**
 * Saves `person`'s personal environment holding `data`'s keys and answers
 * its secret reads from `data`; every read is recorded.
 */
async function personalEnvironmentOver(
  org: string,
  person: string,
  data: Record<string, string>,
  reads: string[],
): Promise<ReturnType<ExecutionContextBuilderDeps["environmentReader"]>> {
  const id = `env_personal_${person}`;
  await store.saveResource(
    ApiResourceKind.environment,
    id,
    EnvironmentSchema,
    create(EnvironmentSchema, {
      metadata: { id, org, slug: id, labels: { "stigmer.ai/personal": "true" } },
      spec: {
        data: Object.fromEntries(
          Object.keys(data).map((key) => [key, { value: "ciphertext", isSecret: true }]),
        ),
      },
      status: { audit: { specAudit: { createdBy: { id: person } } } },
    }),
  );
  return {
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
  const personal = await personalEnvironmentOver(
    ORG,
    "acc_rule",
    { GITHUB_PAT: "ghp-saved", API_KEY: "never-read" },
    reads,
  );
  const deps: ExecutionContextBuilderDeps = {
    store,
    logger: silentLogger,
    agentLoader: () => ({
      get: async () => agent,
      getVersion: async () => {
        throw new Error("this turn records no agent version");
      },
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: ORG },
          spec: {
            agentRef: { org: ORG, slug: "rule-agent" },
            // Added at the session level: no environment_refs carry it.
            mcpServerUsages: [{ mcpServerRef: { slug: "github", org: ORG } }],
          },
          status: { agentId: "agt_rule" },
        }),
    }),
    environmentReader: () => personal,
    environmentResolution: {
      resolveByReference: async () => {
        throw new Error("no environment layer on this run");
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
    status: {
      agentId: "agt_rule",
      audit: { specAudit: { createdBy: { id: "acc_rule" } } },
    },
    spec: {
      target: { case: "sessionId", value: "ses_rule" },
      message: "hi",
      runtimeEnv: {
        API_KEY: { value: "runtime", isSecret: true },
        UNDECLARED: { value: "stripped", isSecret: false },
      },
    },
  });

  await buildAndPersistExecutionContext(deps, execution);

  const data = createdEcs[0]?.spec?.data ?? {};
  // The agent's own key still flows as before.
  expect(data["API_KEY"]?.value).toBe("runtime");
  // The session server's declared key survives the filter (the union) and
  // is resolved from the personal environment, marked secret as declared.
  expect(data["GITHUB_PAT"]?.value).toBe("ghp-saved");
  expect(data["GITHUB_PAT"]?.isSecret).toBe(true);
  // A key nobody declared is filtered, as before.
  expect(data["UNDECLARED"]).toBeUndefined();
  // Least privilege: only the still-missing declared key the personal
  // environment HOLDS was read — never the agent's (runtime_env carried
  // it), never a key the environment lacks (the optional one is skipped on
  // the stored-keys check, no secret read), never the whole environment.
  expect(reads).toEqual(["GITHUB_PAT"]);
  expect(data["GITHUB_ORG"]).toBeUndefined();
});

it("the built-in assistant: no agent, the session's servers are the declared set", async () => {
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
  const personal = await personalEnvironmentOver(
    ORG,
    "acc_assistant",
    { NOTES_TOKEN: "nt-saved" },
    reads,
  );
  const deps: ExecutionContextBuilderDeps = {
    store,
    logger: silentLogger,
    // The agent lane may not be reached: there is no agent.
    agentLoader: () => ({
      get: async () => {
        throw new Error("agent loader must not be reached");
      },
      getVersion: async () => {
        throw new Error("agent loader must not be reached");
      },
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: ORG },
          spec: {
            mcpServerUsages: [{ mcpServerRef: { slug: "notes", org: ORG } }],
          },
        }),
    }),
    environmentReader: () => personal,
    environmentResolution: {
      resolveByReference: async () => {
        throw new Error("no environment layer on this run");
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
    status: { audit: { specAudit: { createdBy: { id: "acc_assistant" } } } },
    spec: {
      target: { case: "sessionId", value: "ses_assistant" },
      message: "hi",
      runtimeEnv: { STRAY: { value: "stripped", isSecret: false } },
    },
  });

  await buildAndPersistExecutionContext(deps, execution);

  expect(createdEcs).toHaveLength(1);
  const data = createdEcs[0]?.spec?.data ?? {};
  expect(data["NOTES_TOKEN"]?.value).toBe("nt-saved");
  // The declared set is the session servers' alone, so the filter is
  // live: a stray runtime key is stripped, not passed through.
  expect(data["STRAY"]).toBeUndefined();
  expect(reads).toEqual(["NOTES_TOKEN"]);
});

/**
 * Builder deps for the personal-environment bridge: the session `session`
 * answers, the agent `agent` (the turn's stamp) at its head, the minting
 * PlatformClient `client` whose layer resolves from `layer` (a layer that
 * keeps the run's person, which a schedule's does not), and the person's
 * environment `personal`.
 */
function bridgeDeps(opts: {
  readonly session: ReturnType<typeof create<typeof SessionSchema>>;
  readonly agent: ReturnType<typeof create<typeof AgentSchema>> | undefined;
  readonly client?: PlatformClient;
  readonly layer: ReadonlyArray<ReturnType<typeof create<typeof EnvironmentSchema>>>;
  readonly personal: ReturnType<ExecutionContextBuilderDeps["environmentReader"]>;
  readonly createdEcs: ExecutionContext[];
}): ExecutionContextBuilderDeps {
  return {
    store,
    logger: silentLogger,
    agentLoader: () => ({
      get: async () => {
        if (opts.agent === undefined) {
          throw new Error("agent loader must not be reached");
        }
        return opts.agent;
      },
      getVersion: async () => {
        throw new Error("this turn records no agent version");
      },
    }),
    sessionLoader: () => ({ get: async () => opts.session }),
    environmentReader: () => opts.personal,
    environmentResolution: {
      resolveByReference: async (ref: ApiResourceReference) => {
        const found = opts.layer.find((env) => env.metadata?.slug === ref.slug);
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
    platformClients:
      opts.client === undefined
        ? unreadPlatformClients
        : { findById: async () => opts.client },
  };
}

it("an agent-declared key no layer carried reaches the run from the personal environment, after every layer", async () => {
  const ORG = "acme";
  const reads: string[] = [];
  const createdEcs: ExecutionContext[] = [];
  const personal = await personalEnvironmentOver(
    ORG,
    "acc_agent_keys",
    { AGENT_TOKEN: "personal-token", LAYER_KEY: "personal-shadow" },
    reads,
  );
  const deps = bridgeDeps({
    session: create(SessionSchema, {
      metadata: { id: "ses_agent_keys", org: ORG },
      spec: { agentRef: { org: ORG, slug: "keyed-agent" } },
      status: { agentId: "agt_keys" },
    }),
    agent: create(AgentSchema, {
      metadata: { id: "agt_keys", org: ORG, slug: "keyed-agent" },
      // The agent's own declarations: no session server is involved.
      spec: {
        env: {
          AGENT_TOKEN: { isSecret: true },
          LAYER_KEY: { isSecret: true },
        },
      },
    }),
    client: mintingClient(ORG, "agent-layer"),
    layer: [environmentOf("agent-layer", { LAYER_KEY: "from-the-layer" }, ORG)],
    personal,
    createdEcs,
  });
  const execution = create(AgentExecutionSchema, {
    metadata: { id: "aexec_agent_keys", org: ORG },
    spec: { target: { case: "sessionId", value: "ses_agent_keys" }, message: "hi" },
    status: {
      agentId: "agt_keys",
      audit: {
        specAudit: {
          createdBy: { id: "acc_agent_keys", platformClientId: "pcl_dashboard" },
        },
      },
    },
  });

  await buildAndPersistExecutionContext(deps, execution);

  const data = createdEcs[0]?.spec?.data ?? {};
  expect(data["AGENT_TOKEN"]?.value).toBe("personal-token");
  expect(data["AGENT_TOKEN"]?.isSecret).toBe(true);
  // A key a layer carried keeps the layer's value: the bridge runs after
  // every layer and reads only what is still missing.
  expect(data["LAYER_KEY"]?.value).toBe("from-the-layer");
  expect(reads).toEqual(["AGENT_TOKEN"]);
});

it("never reads a session server's OAuth target key from the personal environment", async () => {
  const ORG = "acme";
  await store.saveResource(
    ApiResourceKind.mcp_server,
    "mcps_calendar",
    McpServerSchema,
    create(McpServerSchema, {
      metadata: { id: "mcps_calendar", org: ORG, slug: "calendar" },
      spec: {
        auth: { targetEnvVar: "CALENDAR_TOKEN" },
        env: {
          CALENDAR_TOKEN: { isSecret: true },
          CALENDAR_REGION: { isSecret: false },
        },
      },
    }),
  );
  const reads: string[] = [];
  const createdEcs: ExecutionContext[] = [];
  const personal = await personalEnvironmentOver(
    ORG,
    "acc_oauth",
    { CALENDAR_TOKEN: "never-read", CALENDAR_REGION: "eu" },
    reads,
  );
  const deps = bridgeDeps({
    session: create(SessionSchema, {
      metadata: { id: "ses_oauth", org: ORG },
      spec: {
        mcpServerUsages: [{ mcpServerRef: { slug: "calendar", org: ORG } }],
      },
    }),
    agent: undefined,
    layer: [],
    personal,
    createdEcs,
  });
  const execution = create(AgentExecutionSchema, {
    metadata: { id: "aexec_oauth", org: ORG },
    spec: { target: { case: "sessionId", value: "ses_oauth" }, message: "hi" },
    status: { audit: { specAudit: { createdBy: { id: "acc_oauth" } } } },
  });

  await buildAndPersistExecutionContext(deps, execution);

  const data = createdEcs[0]?.spec?.data ?? {};
  // The OAuth target is the managed grant's to fill; with no grant it
  // stays unset rather than falling back to a personal value.
  expect(data["CALENDAR_TOKEN"]).toBeUndefined();
  expect(data["CALENDAR_REGION"]?.value).toBe("eu");
  expect(reads).toEqual(["CALENDAR_REGION"]);
});

it("declares no agent half for a turn with no stamp, whatever its session pins", async () => {
  const ORG = "acme";
  const createdEcs: ExecutionContext[] = [];
  const deps = bridgeDeps({
    session: create(SessionSchema, {
      metadata: { id: "ses_unstamped", org: ORG },
      spec: { agentRef: { org: ORG, slug: "pinned-agent" } },
      status: { agentId: "agt_pinned" },
    }),
    // Reaching the agent lane would fail the build.
    agent: undefined,
    layer: [],
    personal: {
      getSecretValue: async () => {
        throw new Error("no person on this run");
      },
    },
    createdEcs,
  });
  const execution = create(AgentExecutionSchema, {
    metadata: { id: "aexec_unstamped", org: ORG },
    spec: {
      target: { case: "sessionId", value: "ses_unstamped" },
      message: "hi",
      runtimeEnv: { ANY_KEY: { value: "passes" } },
    },
  });

  await buildAndPersistExecutionContext(deps, execution);

  // No agent and no session server declare anything, so nothing filters.
  expect(createdEcs[0]?.spec?.data["ANY_KEY"]?.value).toBe("passes");
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

/** The schedule whose layer every PlatformClient-layer execution also carries. */
const PC_SCHEDULE_ID = "sch_pc";

beforeAll(async () => {
  await scheduleLayer(PC_SCHEDULE_ID, PC_ORG, "schedule-secrets");
});

/**
 * An execution in PC_ORG created by an actor who came through
 * `platformClientId`, fired by the schedule whose one ref is
 * `schedule-secrets` (the layer above the client's).
 */
function executionCreatedThrough(
  id: string,
  platformClientId: string,
  runtimeEnv: Record<string, string> = {},
): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: {
      id,
      org: PC_ORG,
      labels: { [SCHEDULE_ID_LABEL_KEY]: PC_SCHEDULE_ID },
    },
    spec: {
      target: { case: "sessionId", value: `ses_${id}` },
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
 * Builder deps for a turn of the built-in assistant (no agent declares
 * anything, so every merged key passes the filter). Every resolved
 * reference and every client read is recorded.
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
      get: async () => {
        throw new Error("a turn of the built-in assistant loads no agent");
      },
      getVersion: async () => {
        throw new Error("a turn of the built-in assistant loads no agent");
      },
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, { metadata: { id: sessionId, org: PC_ORG } }),
    }),
    environmentReader: () => ({
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

const scheduleSecrets = environmentOf("schedule-secrets", {
  SCHEDULE_WINS: "schedule",
});
const clientSecrets = environmentOf("embed-secrets", {
  SHARED_API_SECRET: "client-secret",
  SCHEDULE_WINS: "client",
  RUNTIME_WINS: "client",
});

it("a minted user's execution receives its client's environments below the schedule layer and runtime_env", async () => {
  const resolved: ApiResourceReference[] = [];
  const clientReads: string[] = [];
  const createdEcs: ExecutionContext[] = [];
  const deps = platformClientLayerDeps({
    client: mintingClient(PC_ORG, "embed-secrets"),
    environments: [scheduleSecrets, clientSecrets],
    resolved,
    clientReads,
    createdEcs,
  });

  await buildAndPersistExecutionContext(
    deps,
    executionCreatedThrough("aexec_pc_layer", "pcl_dashboard", {
      RUNTIME_WINS: "runtime",
    })
  );

  const data = createdEcs[0]?.spec?.data ?? {};
  // The client's own key reaches the run.
  expect(data["SHARED_API_SECRET"]?.value).toBe("client-secret");
  // The precedence #1256 asks to pin: the layers above it, then
  // runtime_env, override the client on a key conflict.
  expect(data["SCHEDULE_WINS"]?.value).toBe("schedule");
  expect(data["RUNTIME_WINS"]?.value).toBe("runtime");
  expect(clientReads).toEqual(["pcl_dashboard"]);
  expect(resolved.map((ref) => `${ref.org}/${ref.slug}`)).toEqual([
    "acme/schedule-secrets",
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
        environments: [scheduleSecrets],
        resolved: [],
        clientReads: [],
        createdEcs: noClient,
      }),
      platformClients: unreadPlatformClients,
    },
    executionCreatedThrough("aexec_pc_none", ""),
  );
  expect(noClient[0]?.spec?.data["SCHEDULE_WINS"]?.value).toBe("schedule");

  // The client was deleted since: the run proceeds without its layer.
  const deleted: ExecutionContext[] = [];
  const deletedReads: string[] = [];
  await buildAndPersistExecutionContext(
    platformClientLayerDeps({
      client: undefined,
      environments: [scheduleSecrets, clientSecrets],
      resolved: [],
      clientReads: deletedReads,
      createdEcs: deleted,
    }),
    executionCreatedThrough("aexec_pc_deleted", "pcl_dashboard"),
  );
  expect(deletedReads).toEqual(["pcl_dashboard"]);
  expect(deleted[0]?.spec?.data["SHARED_API_SECRET"]).toBeUndefined();
  expect(deleted[0]?.spec?.data["SCHEDULE_WINS"]?.value).toBe("schedule");

  // A client of another organization: no environment value crosses an
  // organization, so its refs are never even resolved.
  const foreign: ExecutionContext[] = [];
  const foreignResolved: ApiResourceReference[] = [];
  await buildAndPersistExecutionContext(
    platformClientLayerDeps({
      client: mintingClient("globex", "embed-secrets"),
      environments: [scheduleSecrets, environmentOf("embed-secrets", { SHARED_API_SECRET: "x" }, "globex")],
      resolved: foreignResolved,
      clientReads: [],
      createdEcs: foreign,
    }),
    executionCreatedThrough("aexec_pc_foreign", "pcl_dashboard"),
  );
  expect(foreign[0]?.spec?.data["SHARED_API_SECRET"]).toBeUndefined();
  expect(foreignResolved.map((ref) => ref.org)).toEqual(["acme"]);
});

it("a client environment that no longer exists fails the create with the client named in the chain", async () => {
  try {
    await buildAndPersistExecutionContext(
      platformClientLayerDeps({
        client: mintingClient(PC_ORG, "gone-secrets"),
        environments: [scheduleSecrets],
        resolved: [],
        clientReads: [],
        createdEcs: [],
      }),
      executionCreatedThrough("aexec_pc_gone", "pcl_dashboard"),
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

  // Recover rebuilds from the persisted execution with no minted caller
  // (lifecycle.ts's recreate step).
  const createdEcs: ExecutionContext[] = [];
  await buildAndPersistExecutionContext(
    platformClientLayerDeps({
      client: mintingClient(PC_ORG, "embed-secrets"),
      environments: [scheduleSecrets, clientSecrets],
      resolved: [],
      clientReads: [],
      createdEcs,
    }),
    execution,
  );
  expect(createdEcs[0]?.spec?.data["SHARED_API_SECRET"]?.value).toBe(
    "client-secret",
  );
});

/**
 * The recorded-agent deps: a schedule layer whose environment holds both
 * the key the recorded version declares and the key the head declares
 * now, a head that must never be read, and the recorded version as
 * `version` answers it.
 */
function recordedAgentDeps(
  version: () => Promise<AgentVersionEntry>,
  createdEcs: ExecutionContext[],
): ExecutionContextBuilderDeps {
  const environment = create(EnvironmentSchema, {
    metadata: { id: "env_rec", org: "acme", slug: "rec-env" },
    spec: {
      data: {
        RECORDED_KEY: { value: "declared-by-the-recorded-version" },
        HEAD_KEY: { value: "declared-by-the-head-only" },
      },
    },
  });
  return {
    store,
    logger: silentLogger,
    agentLoader: () => ({
      get: async () => {
        throw new Error("the agent's head must not be read for a recorded version");
      },
      getVersion: version,
    }),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, {
          metadata: { id: sessionId, org: "acme" },
          spec: { agentRef: { org: "acme", slug: "rec-agent" } },
          status: { agentId: "agt_rec", agentVersionHash: "f".repeat(64) },
        }),
    }),
    environmentReader: () => ({
      getSecretValue: async () => {
        throw new Error("unreached");
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
    executionContextDeleter: () => ({
      delete: () => Promise.reject(new Error("unused here")),
    }),
    managedEnvService: {} as ManagedEnvironmentService,
    platformClients: unreadPlatformClients,
  };
}

/** The schedule whose layer every recorded-agent turn carries. */
const REC_LABELS = { [SCHEDULE_ID_LABEL_KEY]: "sch_rec" };

beforeAll(async () => {
  await scheduleLayer("sch_rec", "acme", "rec-env");
});

/**
 * A persisted turn that recorded agt_rec at RECORDED_HASH, as recover
 * reads it; its session pins another version since, which is never read.
 */
const RECORDED_HASH = "e".repeat(64);
function recordedTurn(id: string): AgentExecution {
  return create(AgentExecutionSchema, {
    metadata: { id, org: "acme", labels: REC_LABELS },
    spec: { target: { case: "sessionId", value: "ses_rec" }, message: "hi" },
    status: { agentId: "agt_rec", agentVersionHash: RECORDED_HASH },
  });
}

it("rebuilds the context from the version the turn recorded, after the head moved (the recover path)", async () => {
  const createdEcs: ExecutionContext[] = [];
  const asked: Array<[string, string]> = [];
  const deps = recordedAgentDeps(async () => {
    asked.push(["agt_rec", RECORDED_HASH]);
    return create(AgentVersionEntrySchema, {
      versionHash: RECORDED_HASH,
      specSnapshot: { env: { RECORDED_KEY: {} } },
    });
  }, createdEcs);

  await buildAndPersistExecutionContext(deps, recordedTurn("aex_recorded"));

  expect(asked).toEqual([["agt_rec", RECORDED_HASH]]);
  const data = createdEcs[0]?.spec?.data ?? {};
  expect(data["RECORDED_KEY"]?.value).toBe("declared-by-the-recorded-version");
  expect(data["HEAD_KEY"]).toBeUndefined();
});

it("refuses, naming the version, when the recorded version no longer resolves", async () => {
  const deps = recordedAgentDeps(async () => {
    throw new ConnectError("agent version not found", Code.NotFound);
  }, []);

  const failure = await buildAndPersistExecutionContext(
    deps,
    recordedTurn("aex_recorded_gone"),
  ).catch((e: unknown) => e);

  expect(failure).toBeInstanceOf(ConnectError);
  expect((failure as ConnectError).code).toBe(Code.NotFound);
  expect((failure as ConnectError).rawMessage).toContain(RECORDED_HASH);
});

it("keeps a recorded-version load failure that is not a status as its message, naming the version", async () => {
  const deps = recordedAgentDeps(async () => {
    throw new Error("socket hang up");
  }, []);

  const failure = await buildAndPersistExecutionContext(
    deps,
    recordedTurn("aex_recorded_fault"),
  ).catch((e: unknown) => e);

  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain(RECORDED_HASH);
  expect((failure as Error).message).toContain("socket hang up");
});

it("loads a turn that recorded its agent without a version as the agent is now, keeping a refusal's code", async () => {
  const deps: ExecutionContextBuilderDeps = {
    ...recordedAgentDeps(async () => {
      throw new Error("no version is recorded on this turn");
    }, []),
    agentLoader: () => ({
      get: async () => {
        throw new ConnectError("agent not found", Code.NotFound);
      },
      getVersion: async () => {
        throw new Error("no version is recorded on this turn");
      },
    }),
  };
  const turn = create(AgentExecutionSchema, {
    metadata: { id: "aex_unversioned", org: "acme", labels: REC_LABELS },
    spec: { target: { case: "sessionId", value: "ses_rec" }, message: "hi" },
    status: { agentId: "agt_rec" },
  });

  const failure = await buildAndPersistExecutionContext(deps, turn).catch(
    (e: unknown) => e,
  );

  expect(failure).toBeInstanceOf(ConnectError);
  expect((failure as ConnectError).code).toBe(Code.NotFound);
  expect((failure as ConnectError).rawMessage).toContain("load agent agt_rec");
});

it("keeps a head-load failure that is not a status as its message, for a turn that recorded no version", async () => {
  const deps: ExecutionContextBuilderDeps = {
    ...recordedAgentDeps(async () => {
      throw new Error("no version is recorded on this turn");
    }, []),
    agentLoader: () => ({
      get: async () => {
        throw new Error("socket hang up");
      },
      getVersion: async () => {
        throw new Error("no version is recorded on this turn");
      },
    }),
  };
  const turn = create(AgentExecutionSchema, {
    metadata: { id: "aex_unversioned_fault", org: "acme", labels: REC_LABELS },
    spec: { target: { case: "sessionId", value: "ses_rec" }, message: "hi" },
    status: { agentId: "agt_rec" },
  });

  const failure = await buildAndPersistExecutionContext(deps, turn).catch(
    (e: unknown) => e,
  );

  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(ConnectError);
  expect((failure as Error).message).toBe("load agent agt_rec: socket hang up");
});

it("declares for the recorded agent when the session has since moved to the built-in assistant", async () => {
  const createdEcs: ExecutionContext[] = [];
  const deps: ExecutionContextBuilderDeps = {
    ...recordedAgentDeps(
      async () =>
        create(AgentVersionEntrySchema, {
          versionHash: RECORDED_HASH,
          specSnapshot: { env: { RECORDED_KEY: {} } },
        }),
      createdEcs,
    ),
    sessionLoader: () => ({
      get: async (sessionId) =>
        create(SessionSchema, { metadata: { id: sessionId, org: "acme" } }),
    }),
  };

  const turn = create(AgentExecutionSchema, {
    metadata: { id: "aex_moved", org: "acme", labels: REC_LABELS },
    spec: {
      target: { case: "sessionId", value: "ses_rec" },
      message: "hi",
      runtimeEnv: {
        RECORDED_KEY: { value: "kept" },
        HEAD_KEY: { value: "dropped" },
      },
    },
    status: { agentId: "agt_rec", agentVersionHash: RECORDED_HASH },
  });

  await buildAndPersistExecutionContext(deps, turn);

  // The least-privilege filter keeps exactly what the recorded version
  // declares; with no agent the run would declare nothing and keep neither.
  const data = createdEcs[0]?.spec?.data ?? {};
  expect(data["RECORDED_KEY"]?.value).toBe("kept");
  expect(data["HEAD_KEY"]).toBeUndefined();
});
