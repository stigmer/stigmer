/**
 * Pins the connect lanes against Go's connect_test.go +
 * start_connect_test.go, at the handler layer with a REAL sqlite store
 * and a fake engine (the seam the temporal side implements): the budget
 * guards, the failure→gRPC mapping table (#239/#243/#478), the
 * connect_status bookkeeping (attach skips CONNECTING; results and the
 * terminal phase ride ONE atomic write; failure_code in CamelCase),
 * each tool's destructive_hint persisted as the runner read it and
 * overwritten on reconnect, the ephemeral EC lifecycle and its values
 * from the vault resolver (the caller's own My vault, never a teammate's;
 * a runtime_env key the server does not declare never delivered; a
 * required key nowhere refuses the connect, naming it), and
 * startConnect's two-layer idempotency + dead-runner warning, and the
 * connect route (connect-sandbox.ts, stigmer/stigmer#1474): the shared
 * runner queue without a sandbox lane, and with one a connect sandbox
 * per connect, acting as the person through an always-created
 * ExecutionContext row and released exactly once on every exit; the
 * apply tail skipping every server that needs a value, a login key with no
 * env declaration included.
 *
 * The wire-level halves are pinned by
 * mcpserver-connect.conformance.test.ts on local-execution.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ConnectPhase } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import { SecretService } from "../../../encryption/encryption.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import type {
  RunnerCredentialProvider,
  SandboxCredentialRequest,
} from "../../../runnerauth/runner-credential-provider.js";
import {
  RunnerAuthService,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "../../../runnerauth/runnerauth.js";
import type { SandboxLane } from "../../../sandbox/lane.js";
import type {
  SandboxEnvironment,
  SandboxProvisioner,
} from "../../../sandbox/provisioner.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { newVaultResolver } from "../../vault/resolve.js";
import { newVaultService } from "../../vault/service.js";
import type { VaultService } from "../../vault/service.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import {
  ASYNC_CONNECT_TIMEOUT,
  CONNECT_TIMEOUT,
  buildConnectFailureMessage,
  connect as connectRpc,
  startBestEffortConnect,
} from "../connect.js";
import type { McpServerConnectDeps } from "../connect.js";
import { isConnectExecutionId } from "../connect-execution-id.js";
import { newSignInFreshener } from "../oauth/refresh.js";
import {
  RUNNER_QUEUE_WARNING,
  startConnect as startConnectRpc,
} from "../start-connect.js";
import { CONNECT_SANDBOX_PROVISIONING_FAILED } from "../connect-sandbox.js";
import type {
  ConnectRunOutcome,
  ConnectTaskQueue,
  ConnectWorkflowInput,
  ConnectWorkflowOutput,
  McpServerConnectEngine,
} from "../engine.js";
import { MCP_SERVER_ENGINE_DISCONNECTED } from "../engine.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

// Deterministic key so runner-token minting is enabled (the mint arm).
vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", Buffer.alloc(32, 8).toString("base64"));

const OK_OUTPUT: ConnectWorkflowOutput = {
  tools: [
    { name: "search", description: "find things", input_schema: { type: "object" } },
    { name: "drop_table", description: "drops a table", destructiveHint: true },
  ],
  resource_templates: [
    { uri_template: "file://{path}", name: "files", description: "", mime_type: "" },
  ],
};

interface FakeEngineOptions {
  outcome?: ConnectRunOutcome;
  attached?: boolean;
  running?: boolean;
  pollers?: boolean | undefined;
  /** The start itself fails (Temporal refused the start). */
  startError?: Error;
  /** Runs when a lane begins awaiting the run — the moment an attached lane must already hold nothing. */
  onAwait?: () => void;
}

interface FakeEngine extends McpServerConnectEngine {
  readonly startedInputs: ConnectWorkflowInput[];
  readonly startedTimeouts: number[];
  readonly startedQueues: ConnectTaskQueue[];
  pollerProbes: number;
}

function fakeEngine(options: FakeEngineOptions = {}): FakeEngine {
  const startedInputs: ConnectWorkflowInput[] = [];
  const startedTimeouts: number[] = [];
  const startedQueues: ConnectTaskQueue[] = [];
  const engine: FakeEngine = {
    startedInputs,
    startedTimeouts,
    startedQueues,
    pollerProbes: 0,
    async startOrAttachConnect(mcpServerId, input, runTimeoutMs, taskQueue) {
      if (options.startError !== undefined) {
        throw options.startError;
      }
      startedInputs.push(input);
      startedTimeouts.push(runTimeoutMs);
      startedQueues.push(taskQueue);
      return {
        workflowId: `stigmer/mcp-server/connect/${mcpServerId}`,
        attached: options.attached ?? false,
        result: async () => {
          options.onAwait?.();
          return options.outcome ?? { ok: true, output: OK_OUTPUT };
        },
      };
    },
    async isConnectRunRunning() {
      return options.running ?? false;
    },
    async hasRunnerQueuePollers() {
      engine.pollerProbes += 1;
      return options.pollers;
    },
  };
  return engine;
}

/** A connect-scope provisioner that records every call; the other scopes are unreachable here. */
interface FakeConnectProvisioner extends SandboxProvisioner {
  readonly created: Array<{ id: string; env: SandboxEnvironment }>;
  readonly deprovisioned: string[];
}

function fakeConnectProvisioner(options: { createError?: Error } = {}): FakeConnectProvisioner {
  const created: Array<{ id: string; env: SandboxEnvironment }> = [];
  const deprovisioned: string[] = [];
  const unreachable = async (): Promise<never> => {
    throw new Error("only the connect scope is reachable from the connect lanes");
  };
  return {
    created,
    deprovisioned,
    ensureSessionSandbox: unreachable,
    deprovisionSessionSandbox: unreachable,
    async createConnectSandbox(id, env) {
      if (options.createError !== undefined) {
        throw options.createError;
      }
      created.push({ id, env });
      return `sbx-${id}`;
    },
    async deprovisionConnectSandbox(sandboxId) {
      deprovisioned.push(sandboxId);
    },
    probe: unreachable,
  };
}

interface HarnessOptions extends FakeEngineOptions {
  /** Compose a sandbox lane over this provisioner (absent: the external-runner posture). */
  provisioner?: SandboxProvisioner;
  /** The lane's credential provider (default: the harness's execution-scoped runnerAuth). */
  credentials?: RunnerCredentialProvider;
}

interface Harness {
  deps: McpServerConnectDeps;
  /** The real vault service over the harness's store. */
  vaults: VaultService;
  engine: FakeEngine;
  ecCreates: number;
  /** The caller each EC create was handed — the connect's person, never the server (the mcp-connect binding's stamp). */
  ecCreators: CallerIdentity[];
  ecDeletes: string[];
}

let dir: string;
let store: SqliteStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mcpserver-connect-test-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

// The connect lanes evaluate their can_connect/can_view annotations;
// these direct-call tests exercise them under the OSS
// permissive authorizer with one fixed caller — authorize.test.ts owns
// the deny/not-found arms.
const testCaller = testCallerIdentity();
const connect = (
  deps: McpServerConnectDeps,
  input: Parameters<typeof connectRpc>[1],
) => connectRpc(deps, input, testCaller);
const startConnect = (
  deps: McpServerConnectDeps,
  input: Parameters<typeof startConnectRpc>[1],
) => startConnectRpc(deps, input, testCaller);

function makeHarness(options: HarnessOptions = {}): Harness {
  const engine = fakeEngine(options);
  const runnerAuth = newExecutionScopedRunnerCredentialProvider(
    RunnerAuthService.fromEnv(),
  );
  const sandboxLane: SandboxLane =
    options.provisioner === undefined
      ? { enabled: false }
      : {
          enabled: true,
          provisioner: options.provisioner,
          credentials: options.credentials ?? runnerAuth,
        };
  const secretService = SecretService.create(undefined);
  const vaults = newVaultService({
    store,
    logger: silentLogger,
    secretService,
    authorizationLifecycle: undefined,
  });
  const authorizer = newPermissiveSingleTeamAuthorizer();
  const resolver = newVaultResolver({
    store,
    logger: silentLogger,
    authorizer,
    secretService,
    vaults,
    platformClients: { findById: async () => undefined },
    freshener: newSignInFreshener({ vaults, store, secretService, logger: silentLogger }),
  });
  const harness: Harness = {
    engine,
    vaults,
    ecCreates: 0,
    ecCreators: [],
    ecDeletes: [],
    deps: {
      store,
      logger: silentLogger,
      authorizer,
      engineState: () => ({ connected: true, engine }),
      executionContext: {
        create: async (_ec, caller) => {
          harness.ecCreates += 1;
          harness.ecCreators.push(caller);
          return create(ExecutionContextSchema, {
            metadata: { id: `ectx_${harness.ecCreates}` },
          });
        },
        delete: async (input) => {
          harness.ecDeletes.push(String(input.resourceId ?? ""));
          return create(ExecutionContextSchema);
        },
      },
      runnerAuth,
      vaults,
      vaultResolver: resolver,
      pendingOAuthStates: store.pendingOAuthStates,
      secretService,
      oauthRedirectUri: "http://127.0.0.1:8234/auth/oauth/callback",
      sandboxLane,
      // No arm in this harness dials out; a call is a test bug, not a network.
      outboundFetch: async () => {
        throw new Error("no outbound fetch in this harness");
      },
    },
  };
  return harness;
}

let counter = 0;
async function seedServer(overrides?: {
  stdio?: boolean;
  env?: boolean;
  /** A login key with no env declaration: auth.target_env_var, or a Bearer header's variable. */
  login?: "target" | "bearer";
}): Promise<McpServer> {
  counter += 1;
  const id = `mcps_test_${counter}`;
  const server = create(McpServerSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "McpServer",
    metadata: {
      id,
      name: `Test Server ${counter}`,
      slug: `test-server-${counter}`,
      org: "acme",
    },
    spec: {
      description: "seeded",
      serverType:
        overrides?.stdio === false || overrides?.login === "bearer"
          ? {
              case: "http",
              value: {
                url: "https://mcp.example.com/mcp",
                headers:
                  overrides?.login === "bearer" ? { Authorization: "Bearer ${API_TOKEN}" } : {},
              },
            }
          : { case: "stdio", value: { command: "npx", args: ["-y", "@x/mcp"] } },
      ...(overrides?.env === true
        ? { env: { API_KEY: { isSecret: true, optional: false } } }
        : {}),
      ...(overrides?.login === "target" ? { auth: { targetEnvVar: "API_TOKEN" } } : {}),
    },
  });
  await store.saveResource(ApiResourceKind.mcp_server, id, McpServerSchema, server);
  return server;
}

function connectInput(mcpServerId: string, runtimeEnv?: Record<string, { value: string; isSecret: boolean }>) {
  return create(ConnectInputSchema, {
    mcpServerId,
    org: "acme",
    ...(runtimeEnv !== undefined ? { runtimeEnv } : {}),
  });
}

async function expectConnectError(
  promise: Promise<unknown>,
  code: Code,
  messageFragment: string | RegExp,
): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    const connectError = error as ConnectError;
    expect(connectError.code).toBe(code);
    if (typeof messageFragment === "string") {
      expect(connectError.rawMessage).toContain(messageFragment);
    } else {
      expect(connectError.rawMessage).toMatch(messageFragment);
    }
    return connectError;
  }
  throw new Error("expected the promise to reject");
}

describe("budget guards (Go connect_test.go:339, start_connect_test.go:202)", () => {
  it("the sync budget covers the stdio cold-start allowance with margin (#243)", () => {
    expect(CONNECT_TIMEOUT.ms).toBeGreaterThanOrEqual(270_000 + 120_000);
  });

  it("the async backstop exceeds the sync budget", () => {
    expect(ASYNC_CONNECT_TIMEOUT.ms).toBeGreaterThan(CONNECT_TIMEOUT.ms);
  });

  it("the Go duration labels match the budgets (the DEADLINE_EXCEEDED copy)", () => {
    expect(CONNECT_TIMEOUT.goLabel).toBe("7m0s");
    expect(ASYNC_CONNECT_TIMEOUT.goLabel).toBe("1h0m0s");
  });
});

describe("connect (blocking lane)", () => {
  it("refuses with Go's byte-pinned copy while the engine is disconnected", async () => {
    const harness = makeHarness();
    harness.deps = { ...harness.deps, engineState: () => MCP_SERVER_ENGINE_DISCONNECTED };
    const server = await seedServer();
    await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.FailedPrecondition,
      "connect is not available: Temporal not configured",
    );
  });

  const guards: Array<[string, { id: string; org: string }, string]> = [
    ["empty mcp_server_id", { id: "", org: "acme" }, "mcp_server_id is required"],
    ["empty org", { id: "mcps_x", org: "" }, "org is required for connect"],
  ];
  it.each(guards)("rejects %s", async (_label, args, message) => {
    const harness = makeHarness();
    await expectConnectError(
      connect(
        harness.deps,
        create(ConnectInputSchema, { mcpServerId: args.id, org: args.org }),
      ),
      Code.InvalidArgument,
      message,
    );
  });

  it("answers NotFound for an unknown server", async () => {
    const harness = makeHarness();
    await expectConnectError(
      connect(harness.deps, connectInput("mcps_missing")),
      Code.NotFound,
      "mcp_server not found: mcps_missing",
    );
  });

  it("persists capabilities + destructive hints + SUCCEEDED in one record and returns the updated resource", async () => {
    const harness = makeHarness();
    const server = await seedServer();
    const result = await connect(harness.deps, connectInput(server.metadata!.id));

    const tools = result.status?.discoveredCapabilities?.tools ?? [];
    expect(tools.map((tool) => [tool.name, tool.destructiveHint])).toEqual([
      ["search", false],
      ["drop_table", true],
    ]);
    expect(tools[0]?.inputSchema).toEqual({ type: "object" });
    expect(result.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);
    expect(result.status?.connectStatus?.failureCode).toBe("");
    // The sync lane passes the 420s budget to the engine.
    expect(harness.engine.startedTimeouts[0]).toBe(CONNECT_TIMEOUT.ms);
    // No sandbox lane: the shared runner queue, as always.
    expect(harness.engine.startedQueues).toEqual([{ kind: "runner" }]);
  });

  it("a reconnect replaces the hints with the server's current annotations", async () => {
    const harness = makeHarness();
    const server = await seedServer();
    await connect(harness.deps, connectInput(server.metadata!.id));

    // The author dropped the annotation, so the tool stops asking.
    const reannotated = makeHarness({
      outcome: { ok: true, output: { tools: [{ name: "drop_table" }] } },
    });
    const second = await connect(
      reannotated.deps,
      connectInput(server.metadata!.id),
    );
    const tools = second.status?.discoveredCapabilities?.tools ?? [];
    expect(tools.map((tool) => [tool.name, tool.destructiveHint])).toEqual([
      ["drop_table", false],
    ]);
  });

  it("creates the ephemeral EC from runtime_env AS THE CALLER, mints the decrypt token, and deletes the EC after settle", async () => {
    const harness = makeHarness();
    const server = await seedServer({ env: true });
    await connect(
      harness.deps,
      connectInput(server.metadata!.id, {
        API_KEY: { value: "k", isSecret: true },
      }),
    );
    expect(harness.ecCreates).toBe(1);
    // The row's creator stamp is the connect token's person under the
    // built-in posture (runnerauth/bound-execution.ts), so the connect
    // hands the client the caller, never the server's own identity.
    expect(harness.ecCreators).toEqual([testCaller]);
    expect(harness.ecDeletes).toEqual(["ectx_1"]);
    const input = harness.engine.startedInputs[0];
    expect(input?.execution_context_id).toMatch(/^connect-mcps_test_/);
    // The id is the one shape the runner-credential lane recognizes as a
    // connect binding — builder and predicate share one module.
    expect(isConnectExecutionId(input?.execution_context_id ?? "")).toBe(true);
    // oss#535: the decrypt-lane token rides the payload.
    expect(input?.execution_context_token).toBeTruthy();
  });

  it("skips EC creation entirely for an env-less server", async () => {
    const harness = makeHarness();
    const server = await seedServer();
    await connect(harness.deps, connectInput(server.metadata!.id));
    expect(harness.ecCreates).toBe(0);
    expect(harness.engine.startedInputs[0]?.execution_context_id).toBeUndefined();
  });

  it("refuses with FailedPrecondition naming the key when the caller's vaults hold no required credential", async () => {
    const harness = makeHarness();
    const server = await seedServer({ env: true });
    const error = await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.FailedPrecondition,
      "API_KEY",
    );
    expect(harness.ecCreates).toBe(0);
    expect(error.code).toBe(Code.FailedPrecondition);
  });

  it("delivers only the runtime_env keys the server declares; a required key missing refuses, naming it", async () => {
    const harness = makeHarness();
    const created: Array<Parameters<McpServerConnectDeps["executionContext"]["create"]>[0]> = [];
    const recordCreate = harness.deps.executionContext.create;
    harness.deps = {
      ...harness.deps,
      executionContext: {
        ...harness.deps.executionContext,
        create: async (ec, caller) => {
          created.push(ec);
          return recordCreate(ec, caller);
        },
      },
    };
    const server = await seedServer({ env: true });
    await connect(
      harness.deps,
      connectInput(server.metadata!.id, {
        API_KEY: { value: "declared", isSecret: true },
        UNDECLARED: { value: "stays-home", isSecret: true },
      }),
    );
    expect(Object.keys(created[0]?.spec?.data ?? {})).toEqual(["API_KEY"]);
    expect(created[0]?.spec?.data?.["API_KEY"]?.value).toBe("declared");

    created.length = 0;
    const refused = await expectConnectError(
      connect(
        harness.deps,
        connectInput(server.metadata!.id, { UNDECLARED: { value: "stays-home", isSecret: true } }),
      ),
      Code.FailedPrecondition,
      "needs API_KEY",
    );
    expect(refused.rawMessage).not.toContain("UNDECLARED");
    expect(created).toEqual([]);
  });

  it("reads the connecting person's own My vault, never a teammate's", async () => {
    const harness = makeHarness();
    const teammate = testCallerIdentity({ identityId: "acc_teammate" });
    const mine = await harness.vaults.ensureMine("acme", testCaller);
    const theirs = await harness.vaults.ensureMine("acme", teammate);
    await harness.vaults.setSecrets(
      mine.metadata!.id,
      { API_KEY: { value: "caller-key", description: "" } },
      testCaller,
    );
    await harness.vaults.setSecrets(
      theirs.metadata!.id,
      { API_KEY: { value: "teammate-key", description: "" } },
      teammate,
    );
    const created: Array<Parameters<McpServerConnectDeps["executionContext"]["create"]>[0]> = [];
    const recordCreate = harness.deps.executionContext.create;
    harness.deps = {
      ...harness.deps,
      executionContext: {
        ...harness.deps.executionContext,
        create: async (ec, caller) => {
          created.push(ec);
          return recordCreate(ec, caller);
        },
      },
    };
    const server = await seedServer({ env: true });
    await connect(harness.deps, connectInput(server.metadata!.id));
    expect(created[0]?.spec?.data?.["API_KEY"]?.value).toBe("caller-key");

    // The teammate's own connect reads the teammate's vault.
    created.length = 0;
    await connectRpc(harness.deps, connectInput(server.metadata!.id), teammate);
    expect(created[0]?.spec?.data?.["API_KEY"]?.value).toBe("teammate-key");
  });

  it("skips the CONNECTING write when attached to an in-flight run", async () => {
    const server = await seedServer();
    // Seed a CONNECTING record with a sentinel started_at second.
    const before = await startConnectSeedConnecting(server.metadata!.id);
    const harness = makeHarness({ attached: true });
    await connect(harness.deps, connectInput(server.metadata!.id));
    const after = await store.getResource(
      ApiResourceKind.mcp_server,
      server.metadata!.id,
      McpServerSchema,
    );
    // The settle (same-write) fired, but the starting lane's started_at
    // survived — the attach skipped persistConnectStarting.
    expect(after.status?.connectStatus?.startedAt?.seconds).toBe(before);
  });
});

/** Seeds a CONNECTING record and returns its started_at seconds. */
async function startConnectSeedConnecting(mcpServerId: string): Promise<bigint> {
  const { persistConnectStarting } = await import("../connect-status.js");
  const persisted = await persistConnectStarting(
    store,
    mcpServerId,
    `stigmer/mcp-server/connect/${mcpServerId}`,
    "",
  );
  return persisted.status!.connectStatus!.startedAt!.seconds;
}

describe("connect failure mapping (Go awaitConnectWorkflow, #239/#243/#478)", () => {
  it("application failure → FailedPrecondition with the stdio variant naming --dry-run", async () => {
    const harness = makeHarness({
      outcome: { ok: false, failure: { kind: "application", message: "spawn npx ENOENT" } },
    });
    const server = await seedServer();
    const error = await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.FailedPrecondition,
      `connect failed for MCP server '${server.metadata!.name}': spawn npx ENOENT. This is a stdio server launched ` +
        "by your local runner — verify the command is installed and its arguments " +
        "and environment variables are correct. Preview discovery locally with: " +
        `stigmer connect mcp-server ${server.metadata!.slug} --dry-run`,
    );
    // The failure also settles connect_status with the CamelCase code name.
    const after = await store.getResource(
      ApiResourceKind.mcp_server,
      server.metadata!.id,
      McpServerSchema,
    );
    expect(after.status?.connectStatus?.phase).toBe(ConnectPhase.failed);
    expect(after.status?.connectStatus?.failureCode).toBe("FailedPrecondition");
    expect(after.status?.connectStatus?.failureMessage).toBe(error.rawMessage);
    expect(after.status?.connectStatus?.warning).toBe("");
  });

  it("application failure → the HTTP variant for non-stdio servers", async () => {
    const harness = makeHarness({
      outcome: { ok: false, failure: { kind: "application", message: "401" } },
    });
    const server = await seedServer({ stdio: false });
    await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.FailedPrecondition,
      "Check that the server URL is reachable and your credentials are valid.",
    );
  });

  it("passes a 'requires OAuth' message through verbatim (the stable marker)", async () => {
    const oauthMessage =
      "MCP server 'X' requires OAuth sign-in. Connect it from the server page.";
    const harness = makeHarness({
      outcome: { ok: false, failure: { kind: "application", message: oauthMessage } },
    });
    const server = await seedServer();
    const error = await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.FailedPrecondition,
      oauthMessage,
    );
    expect(error.rawMessage).toBe(oauthMessage);
  });

  it("timeout → DeadlineExceeded naming the 7m0s budget (#243)", async () => {
    const harness = makeHarness({
      outcome: { ok: false, failure: { kind: "timeout" } },
    });
    const server = await seedServer();
    await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.DeadlineExceeded,
      `connect did not complete within the 7m0s budget for MCP server '${server.metadata!.id}' — ` +
        "if this repeats, check that your runner is running and healthy",
    );
  });

  it("service-not-found → Unavailable", async () => {
    const harness = makeHarness({
      outcome: { ok: false, failure: { kind: "service-not-found" } },
    });
    const server = await seedServer();
    await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.Unavailable,
      `connect service temporarily unavailable for MCP server '${server.metadata!.id}'`,
    );
  });

  it("other → Internal WITH the classified cause on the wire (the #478 exception)", async () => {
    const harness = makeHarness({
      outcome: { ok: false, failure: { kind: "other", message: "history lost" } },
    });
    const server = await seedServer();
    const error = await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.Internal,
      "history lost",
    );
    expect(error.rawMessage).toContain(
      `connect failed for MCP server '${server.metadata!.name}'`,
    );
  });
});

describe("buildConnectFailureMessage", () => {
  it("names the server and slug for the stdio variant", async () => {
    const server = await seedServer();
    expect(buildConnectFailureMessage(server, "boom")).toContain(
      `stigmer connect mcp-server ${server.metadata!.slug} --dry-run`,
    );
  });
});

describe("startConnect (async lane)", () => {
  it("fast path: a live CONNECTING run returns immediately, before any EC exists", async () => {
    const server = await seedServer({ env: true });
    await startConnectSeedConnecting(server.metadata!.id);
    const harness = makeHarness({ running: true });
    const result = await startConnect(harness.deps, connectInput(server.metadata!.id));
    expect(result.metadata?.id).toBe(server.metadata!.id);
    expect(harness.ecCreates).toBe(0);
    expect(harness.engine.startedInputs).toHaveLength(0);
  });

  it("records CONNECTING with the dead-runner warning when no pollers answer", async () => {
    const harness = makeHarness({ pollers: false });
    const server = await seedServer();
    const result = await startConnect(harness.deps, connectInput(server.metadata!.id));
    expect(result.status?.connectStatus?.phase).toBe(ConnectPhase.connecting);
    expect(result.status?.connectStatus?.warning).toBe(RUNNER_QUEUE_WARNING);
    // The async lane passes the 60-minute backstop budget.
    expect(harness.engine.startedTimeouts[0]).toBe(ASYNC_CONNECT_TIMEOUT.ms);
    // The detached settle lands SUCCEEDED and clears the warning.
    await vi.waitFor(async () => {
      const after = await store.getResource(
        ApiResourceKind.mcp_server,
        server.metadata!.id,
        McpServerSchema,
      );
      expect(after.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);
      expect(after.status?.connectStatus?.warning).toBe("");
      expect(after.status?.discoveredCapabilities?.tools).toHaveLength(2);
    });
  });

  const noWarning: Array<[string, boolean | undefined]> = [
    ["a live poller", true],
    ["an unanswerable probe (fail-open)", undefined],
  ];
  it.each(noWarning)("records no warning for %s", async (_label, pollers) => {
    const harness = makeHarness({ pollers });
    const server = await seedServer();
    const result = await startConnect(harness.deps, connectInput(server.metadata!.id));
    expect(result.status?.connectStatus?.warning).toBe("");
  });

  it("attach path: deletes the just-created EC and returns the re-read resource", async () => {
    const server = await seedServer({ env: true });
    const harness = makeHarness({ attached: true });
    const result = await startConnect(
      harness.deps,
      connectInput(server.metadata!.id, { API_KEY: { value: "v", isSecret: true } }),
    );
    expect(result.metadata?.id).toBe(server.metadata!.id);
    expect(harness.ecCreates).toBe(1);
    // The async lane creates the EC as the caller too — one prepareConnect.
    expect(harness.ecCreators).toEqual([testCaller]);
    await vi.waitFor(() => expect(harness.ecDeletes).toEqual(["ectx_1"]));
  });
});

describe("startBestEffortConnect (apply tail)", () => {
  it("returns silently while the engine is disconnected (Go's nil-client no-op)", async () => {
    const harness = makeHarness();
    const engine = harness.engine;
    harness.deps = { ...harness.deps, engineState: () => MCP_SERVER_ENGINE_DISCONNECTED };
    const server = await seedServer();
    await startBestEffortConnect(harness.deps, server, testCaller);
    expect(engine.startedInputs).toHaveLength(0);
  });

  it("skips servers with env declarations (their credentials are the connecting person's, not the applier's)", async () => {
    const harness = makeHarness();
    const server = await seedServer({ env: true });
    await startBestEffortConnect(harness.deps, server, testCaller);
    expect(harness.engine.startedInputs).toHaveLength(0);
  });

  it("skips servers whose login key reads a person's sign-in, with no env declaration: auth.target_env_var or a Bearer header", async () => {
    for (const login of ["target", "bearer"] as const) {
      const provisioner = fakeConnectProvisioner();
      const harness = makeHarness({ provisioner });
      // The applier holds the login, so only the skip keeps an apply from
      // reading it (and, for a sign-in, renewing it).
      const mine = await harness.vaults.ensureMine("acme", testCaller);
      await harness.vaults.setSecrets(
        mine.metadata!.id,
        { API_TOKEN: { value: "applier-login", description: "" } },
        testCaller,
      );
      const server = await seedServer({ login });
      await startBestEffortConnect(harness.deps, server, testCaller);
      expect(harness.engine.startedInputs, login).toHaveLength(0);
      expect(harness.ecCreates, login).toBe(0);
      expect(provisioner.created, login).toHaveLength(0);
    }
  });

  it("connects an env-less server and persists the result", async () => {
    const harness = makeHarness();
    const server = await seedServer();
    await startBestEffortConnect(harness.deps, server, testCaller);
    const after = await store.getResource(
      ApiResourceKind.mcp_server,
      server.metadata!.id,
      McpServerSchema,
    );
    expect(after.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);
    expect(after.status?.discoveredCapabilities?.tools).toHaveLength(2);
  });

  it("never throws when the server was deleted mid-connect", async () => {
    const harness = makeHarness();
    const server = await seedServer();
    await store.deleteResource(ApiResourceKind.mcp_server, server.metadata!.id);
    await expect(
      startBestEffortConnect(harness.deps, server, testCaller),
    ).resolves.toBeUndefined();
  });

  it("records a failed run through the same mapping as the blocking lane, so the page says what the runner found", async () => {
    const harness = makeHarness({
      outcome: {
        ok: false,
        failure: {
          kind: "application",
          message: "MCP server 'test' requires OAuth: its endpoint returned an authentication challenge (HTTP 401).",
        },
      },
    });
    const server = await seedServer({ stdio: false });
    await startBestEffortConnect(harness.deps, server, testCaller);
    const after = await store.getResource(
      ApiResourceKind.mcp_server,
      server.metadata!.id,
      McpServerSchema,
    );
    expect(after.status?.connectStatus?.phase).toBe(ConnectPhase.failed);
    expect(after.status?.connectStatus?.failureCode).toBe("FailedPrecondition");
    // The runner's "requires OAuth" sentence rides through verbatim
    // (buildConnectFailureMessage's pass-through), never a generic
    // "best-effort connect did not complete".
    expect(after.status?.connectStatus?.failureMessage).toBe(
      "MCP server 'test' requires OAuth: its endpoint returned an authentication challenge (HTTP 401).",
    );
  });
});

describe("the connect route with a sandbox lane composed (stigmer/stigmer#1474)", () => {
  /** The connect id every lane derives the sandbox, its queue and its credential from. */
  function connectIdOf(harness: Harness): string {
    const created = harness.engine.startedQueues[0];
    expect(created?.kind).toBe("sandbox");
    const name = created?.kind === "sandbox" ? created.name : "";
    expect(name).toMatch(/^mcpconnect:connect-mcps_test_/);
    return name.slice("mcpconnect:".length);
  }

  it("blocking connect of an env-less server: a binding-only row as the person, a sandbox on the connect's own queue, released once", async () => {
    const provisioner = fakeConnectProvisioner();
    const harness = makeHarness({ provisioner });
    const server = await seedServer();

    const result = await connect(harness.deps, connectInput(server.metadata!.id));
    expect(result.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);

    const connectId = connectIdOf(harness);
    expect(isConnectExecutionId(connectId)).toBe(true);
    // The row the sandbox credential binds through exists, created AS the
    // person, even though the server declares no env.
    expect(harness.ecCreators).toEqual([testCaller]);
    // It is binding-only: the runner is handed no context to read and no
    // payload token, the same no-env discovery path as without a lane.
    expect(harness.engine.startedInputs[0]).toEqual({
      mcp_server_id: server.metadata!.id,
    });

    expect(provisioner.created).toHaveLength(1);
    const sandbox = provisioner.created[0]!;
    expect(sandbox.id).toBe(connectId);
    expect(sandbox.env.taskQueue).toBe(`mcpconnect:${connectId}`);
    expect(sandbox.env.callerClass).toBe(testCaller.callerClass);
    // The OSS execution-scoped mint, bound to this one connect.
    expect(
      harness.deps.runnerAuth.verify(
        TOKEN_TYPE_EXECUTION_SCOPED,
        sandbox.env.stigmerToken,
      ),
    ).toBe(connectId);

    expect(provisioner.deprovisioned).toEqual([`sbx-${connectId}`]);
    expect(harness.ecDeletes).toEqual(["ectx_1"]);
  });

  it("blocking connect with runtime_env: the row carries the values and the payload names it, and the sandbox is released once", async () => {
    const provisioner = fakeConnectProvisioner();
    const harness = makeHarness({ provisioner });
    const server = await seedServer({ env: true });
    await connect(
      harness.deps,
      connectInput(server.metadata!.id, { API_KEY: { value: "k", isSecret: true } }),
    );
    const connectId = connectIdOf(harness);
    const input = harness.engine.startedInputs[0];
    expect(input?.execution_context_id).toBe(connectId);
    expect(input?.execution_context_token).toBeTruthy();
    expect(provisioner.deprovisioned).toEqual([`sbx-${connectId}`]);
    expect(harness.ecDeletes).toEqual(["ectx_1"]);
  });

  it("hands a composed mintSandboxCredential the connect scope, the person and the org", async () => {
    const provisioner = fakeConnectProvisioner();
    const base = newExecutionScopedRunnerCredentialProvider(RunnerAuthService.fromEnv());
    const requests: SandboxCredentialRequest[] = [];
    const credentials: RunnerCredentialProvider = {
      ...base,
      isEnabled: (lane) => base.isEnabled(lane),
      mint: (lane, binding, ttl) => base.mint(lane, binding, ttl),
      verify: (lane, token) => base.verify(lane, token),
      mintSandboxCredential(request) {
        requests.push(request);
        return "edition-connect-token";
      },
    };
    const harness = makeHarness({ provisioner, credentials });
    const server = await seedServer();
    await connect(harness.deps, connectInput(server.metadata!.id));
    const connectId = connectIdOf(harness);
    expect(requests).toEqual([
      {
        scope: "connect",
        sessionId: "",
        executionId: connectId,
        org: "acme",
        callerIdentityId: testCaller.identityId,
      },
    ]);
    expect(provisioner.created[0]?.env.stigmerToken).toBe("edition-connect-token");
  });

  it("releases the sandbox once when the run fails", async () => {
    const provisioner = fakeConnectProvisioner();
    const harness = makeHarness({
      provisioner,
      outcome: { ok: false, failure: { kind: "application", message: "401" } },
    });
    const server = await seedServer({ stdio: false });
    await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.FailedPrecondition,
      "401",
    );
    expect(provisioner.deprovisioned).toHaveLength(1);
    expect(harness.ecDeletes).toEqual(["ectx_1"]);
  });

  it("gives its own sandbox back before awaiting another lane's run it attached to", async () => {
    const provisioner = fakeConnectProvisioner();
    const heldWhileAwaiting: number[] = [];
    const harness = makeHarness({
      provisioner,
      attached: true,
      onAwait: () =>
        heldWhileAwaiting.push(provisioner.created.length - provisioner.deprovisioned.length),
    });
    const server = await seedServer();
    await connect(harness.deps, connectInput(server.metadata!.id));
    // Nothing idles for the other lane's whole run...
    expect(heldWhileAwaiting).toEqual([0]);
    // ...and the release stays exactly once.
    expect(provisioner.deprovisioned).toHaveLength(1);
  });

  it("releases the sandbox once when the start itself fails", async () => {
    const provisioner = fakeConnectProvisioner();
    const harness = makeHarness({ provisioner, startError: new Error("frontend down") });
    const server = await seedServer();
    await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.Internal,
      "failed to start connect workflow",
    );
    expect(provisioner.deprovisioned).toHaveLength(1);
    expect(harness.ecDeletes).toEqual(["ectx_1"]);
  });

  it("fails fast with Unavailable, recorded on connect_status, when the sandbox cannot be provisioned", async () => {
    const provisioner = fakeConnectProvisioner({ createError: new Error("quota exceeded") });
    const harness = makeHarness({ provisioner });
    const server = await seedServer();
    await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.Unavailable,
      CONNECT_SANDBOX_PROVISIONING_FAILED,
    );
    // No run was started, so nothing waits on a queue nobody serves.
    expect(harness.engine.startedInputs).toHaveLength(0);
    expect(provisioner.deprovisioned).toHaveLength(0);
    expect(harness.ecDeletes).toEqual(["ectx_1"]);
    const after = await store.getResource(
      ApiResourceKind.mcp_server,
      server.metadata!.id,
      McpServerSchema,
    );
    expect(after.status?.connectStatus?.phase).toBe(ConnectPhase.failed);
    expect(after.status?.connectStatus?.failureCode).toBe("Unavailable");
    expect(after.status?.connectStatus?.failureMessage).toBe(
      CONNECT_SANDBOX_PROVISIONING_FAILED,
    );
  });

  it("startConnect: never probes the sandbox's fresh queue, and the settle releases the sandbox once", async () => {
    const provisioner = fakeConnectProvisioner();
    const harness = makeHarness({ provisioner, pollers: false });
    const server = await seedServer();
    const result = await startConnect(harness.deps, connectInput(server.metadata!.id));
    expect(result.status?.connectStatus?.phase).toBe(ConnectPhase.connecting);
    // The advisory describes the shared queue only; a sandbox created a
    // moment ago has no poller by construction.
    expect(result.status?.connectStatus?.warning).toBe("");
    expect(harness.engine.pollerProbes).toBe(0);
    const connectId = connectIdOf(harness);
    await vi.waitFor(() =>
      expect(provisioner.deprovisioned).toEqual([`sbx-${connectId}`]),
    );
    await vi.waitFor(() => expect(harness.ecDeletes).toEqual(["ectx_1"]));
  });

  it("startConnect: an attach releases the unused sandbox at once", async () => {
    const provisioner = fakeConnectProvisioner();
    const harness = makeHarness({ provisioner, attached: true });
    const server = await seedServer();
    await startConnect(harness.deps, connectInput(server.metadata!.id));
    expect(provisioner.deprovisioned).toHaveLength(1);
    expect(harness.ecDeletes).toEqual(["ectx_1"]);
  });

  it("startConnect: a sandbox that cannot be provisioned fails the RPC fast and deletes the row", async () => {
    const provisioner = fakeConnectProvisioner({ createError: new Error("quota exceeded") });
    const harness = makeHarness({ provisioner });
    const server = await seedServer();
    await expectConnectError(
      startConnect(harness.deps, connectInput(server.metadata!.id)),
      Code.Unavailable,
      CONNECT_SANDBOX_PROVISIONING_FAILED,
    );
    expect(harness.engine.startedInputs).toHaveLength(0);
    expect(harness.ecDeletes).toEqual(["ectx_1"]);
  });

  it("best-effort connect acts as the applier: its binding row, its sandbox, released once", async () => {
    const provisioner = fakeConnectProvisioner();
    const harness = makeHarness({ provisioner });
    const server = await seedServer();
    const applier = testCallerIdentity({ identityId: "the-applier" });
    await startBestEffortConnect(harness.deps, server, applier);

    expect(harness.ecCreators).toEqual([applier]);
    const connectId = connectIdOf(harness);
    expect(
      harness.deps.runnerAuth.verify(
        TOKEN_TYPE_EXECUTION_SCOPED,
        provisioner.created[0]!.env.stigmerToken,
      ),
    ).toBe(connectId);
    expect(provisioner.deprovisioned).toEqual([`sbx-${connectId}`]);
    expect(harness.ecDeletes).toEqual(["ectx_1"]);
    const after = await store.getResource(
      ApiResourceKind.mcp_server,
      server.metadata!.id,
      McpServerSchema,
    );
    expect(after.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);
  });

  it("best-effort connect gives its sandbox back before awaiting a run it attached to", async () => {
    const provisioner = fakeConnectProvisioner();
    const heldWhileAwaiting: number[] = [];
    const harness = makeHarness({
      provisioner,
      attached: true,
      onAwait: () =>
        heldWhileAwaiting.push(provisioner.created.length - provisioner.deprovisioned.length),
    });
    const server = await seedServer();
    await startBestEffortConnect(harness.deps, server, testCaller);
    expect(heldWhileAwaiting).toEqual([0]);
    expect(provisioner.deprovisioned).toHaveLength(1);
    expect(harness.ecDeletes).toEqual(["ectx_1"]);
  });

  it("best-effort connect without a lane creates no row and runs on the shared queue, as before", async () => {
    const harness = makeHarness();
    const server = await seedServer();
    await startBestEffortConnect(harness.deps, server, testCaller);
    expect(harness.ecCreates).toBe(0);
    expect(harness.engine.startedInputs).toEqual([
      { mcp_server_id: server.metadata!.id },
    ]);
    expect(harness.engine.startedQueues).toEqual([{ kind: "runner" }]);
  });
});
