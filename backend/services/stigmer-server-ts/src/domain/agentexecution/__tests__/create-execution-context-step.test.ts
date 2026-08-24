/**
 * The EC builder ASSEMBLY test — panel finding (Reviewer B #3): the
 * pieces (envmerge, refresh, filter) are unit-tested standalone, but the
 * composition — resolve refs → merge layers → least-privilege filter →
 * OAuth injection with inline pre-flight refresh → EC persist — needs one
 * test driving a NON-EMPTY environment and a real token injection through
 * buildAndPersistExecutionContext. Go has no unit twin (its coverage is
 * the execution conformance suites); this pin is TS-only by design.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { EnvironmentValue } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import type { ManagedEnvironmentService } from "../../mcpserver/oauth/managed-env.js";

import type { ExecutionContextBuilderDeps } from "../create-execution-context-step.js";
import { buildAndPersistExecutionContext } from "../create-execution-context-step.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: Store;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aexec-ecbuilder-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
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
    managedEnvService,
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
