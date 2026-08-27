/**
 * Pins the connect lanes against Go's connect_test.go +
 * start_connect_test.go, at the handler layer with a REAL sqlite store
 * and a fake engine (the seam the temporal side implements): the budget
 * guards, the failure→gRPC mapping table (#239/#243/#478), the
 * connect_status bookkeeping (attach skips CONNECTING; results and the
 * terminal phase ride ONE atomic write; failure_code in CamelCase),
 * tool-approval preserve-on-empty, the ephemeral EC lifecycle, and
 * startConnect's two-layer idempotency + dead-runner warning.
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
import { newExecutionScopedRunnerCredentialProvider } from "../../../runnerauth/runner-credential-provider.js";
import { RunnerAuthService } from "../../../runnerauth/runnerauth.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import {
  ASYNC_CONNECT_TIMEOUT,
  CONNECT_TIMEOUT,
  buildConnectFailureMessage,
  connect,
  startBestEffortConnect,
} from "../connect.js";
import type { McpServerConnectDeps } from "../connect.js";
import { ManagedEnvironmentService } from "../oauth/managed-env.js";
import { RUNNER_QUEUE_WARNING, startConnect } from "../start-connect.js";
import type {
  ConnectRunOutcome,
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
  ],
  resource_templates: [
    { uri_template: "file://{path}", name: "files", description: "", mime_type: "" },
  ],
  tool_approvals: [
    { tool_name: "search", requires_approval: true, message: "gated", from_destructive_hint: false },
  ],
};

interface FakeEngineOptions {
  outcome?: ConnectRunOutcome;
  attached?: boolean;
  running?: boolean;
  pollers?: boolean | undefined;
}

interface FakeEngine extends McpServerConnectEngine {
  readonly startedInputs: ConnectWorkflowInput[];
  readonly startedTimeouts: number[];
}

function fakeEngine(options: FakeEngineOptions = {}): FakeEngine {
  const startedInputs: ConnectWorkflowInput[] = [];
  const startedTimeouts: number[] = [];
  return {
    startedInputs,
    startedTimeouts,
    async startOrAttachConnect(mcpServerId, input, runTimeoutMs) {
      startedInputs.push(input);
      startedTimeouts.push(runTimeoutMs);
      return {
        workflowId: `stigmer/mcp-server/connect/${mcpServerId}`,
        attached: options.attached ?? false,
        result: async () => options.outcome ?? { ok: true, output: OK_OUTPUT },
      };
    },
    async isConnectRunRunning() {
      return options.running ?? false;
    },
    async hasRunnerQueuePollers() {
      return options.pollers;
    },
  };
}

interface Harness {
  deps: McpServerConnectDeps;
  engine: FakeEngine;
  ecCreates: number;
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

function makeHarness(options: FakeEngineOptions = {}): Harness {
  const engine = fakeEngine(options);
  const harness: Harness = {
    engine,
    ecCreates: 0,
    ecDeletes: [],
    deps: {
      store,
      logger: silentLogger,
      engineState: () => ({ connected: true, engine }),
      environmentReader: {
        list: async () => {
          throw new Error("no personal environment in this harness");
        },
        getSecretValue: async () => {
          throw new Error("no secrets in this harness");
        },
      },
      executionContext: {
        create: async () => {
          harness.ecCreates += 1;
          return create(ExecutionContextSchema, {
            metadata: { id: `ectx_${harness.ecCreates}` },
          });
        },
        delete: async (input) => {
          harness.ecDeletes.push(String(input.resourceId ?? ""));
          return create(ExecutionContextSchema);
        },
      },
      runnerAuth: newExecutionScopedRunnerCredentialProvider(
        RunnerAuthService.fromEnv(),
      ),
      // The REAL service over a client backed by nothing: the refresh
      // pre-flight arms that need it are exercised in the handshake
      // composed test; here every read throws, which the pre-flight
      // treats as its silent-skip arm (oss#863).
      managedEnv: new ManagedEnvironmentService(
        {
          getSecretValue: async () => {
            throw new Error("no managed env in this harness");
          },
          updateVariables: async () => {
            throw new Error("no managed env in this harness");
          },
          create: async () => {
            throw new Error("no managed env in this harness");
          },
          delete: async () => {
            throw new Error("no managed env in this harness");
          },
        },
        silentLogger,
      ),
      oauthGrants: store.oauthGrants,
      pendingOAuthStates: store.pendingOAuthStates,
      secretService: SecretService.create(undefined),
      oauthRedirectUri: "http://127.0.0.1:8234/auth/oauth/callback",
    },
  };
  return harness;
}

let counter = 0;
async function seedServer(overrides?: {
  stdio?: boolean;
  env?: boolean;
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
        overrides?.stdio === false
          ? { case: "http", value: { url: "https://mcp.example.com/mcp" } }
          : { case: "stdio", value: { command: "npx", args: ["-y", "@x/mcp"] } },
      ...(overrides?.env === true
        ? { env: { API_KEY: { isSecret: true, optional: false } } }
        : {}),
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
  it("the sync budget covers stdio cold-start + the classification floor (#243)", () => {
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

  it("persists capabilities + gates + SUCCEEDED in one record and returns the updated resource", async () => {
    const harness = makeHarness();
    const server = await seedServer();
    const result = await connect(harness.deps, connectInput(server.metadata!.id));

    expect(result.status?.discoveredCapabilities?.tools).toHaveLength(1);
    expect(result.status?.discoveredCapabilities?.tools[0]?.name).toBe("search");
    expect(result.status?.discoveredCapabilities?.tools[0]?.inputSchema).toEqual({
      type: "object",
    });
    expect(result.status?.toolApprovals).toHaveLength(1);
    expect(result.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);
    expect(result.status?.connectStatus?.failureCode).toBe("");
    // The sync lane passes the 420s budget to the engine.
    expect(harness.engine.startedTimeouts[0]).toBe(CONNECT_TIMEOUT.ms);
  });

  it("preserves existing tool approvals when a reconnect returns none (a degraded runner cannot disarm gates)", async () => {
    const harness = makeHarness();
    const server = await seedServer();
    await connect(harness.deps, connectInput(server.metadata!.id));

    const emptyHarness = makeHarness({
      outcome: { ok: true, output: { tools: [{ name: "other" }] } },
    });
    const second = await connect(
      emptyHarness.deps,
      connectInput(server.metadata!.id),
    );
    // Capabilities: overwritten. Gates: preserved.
    expect(second.status?.discoveredCapabilities?.tools[0]?.name).toBe("other");
    expect(second.status?.toolApprovals).toHaveLength(1);
    expect(second.status?.toolApprovals[0]?.toolName).toBe("search");
  });

  it("creates the ephemeral EC from runtime_env, mints the decrypt token, and deletes the EC after settle", async () => {
    const harness = makeHarness();
    const server = await seedServer();
    await connect(
      harness.deps,
      connectInput(server.metadata!.id, {
        API_KEY: { value: "k", isSecret: true },
      }),
    );
    expect(harness.ecCreates).toBe(1);
    expect(harness.ecDeletes).toEqual(["ectx_1"]);
    const input = harness.engine.startedInputs[0];
    expect(input?.execution_context_id).toMatch(/^connect-mcps_test_/);
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

  it("refuses with the [key] list when required credentials have no personal environment", async () => {
    const harness = makeHarness();
    harness.deps = {
      ...harness.deps,
      environmentReader: {
        list: async () => ({ totalCount: 0, items: [] }) as never,
        getSecretValue: async () => {
          throw new Error("unreachable");
        },
      },
    };
    const server = await seedServer({ env: true });
    await expectConnectError(
      connect(harness.deps, connectInput(server.metadata!.id)),
      Code.FailedPrecondition,
      "personal environment not found for org 'acme'; save required credentials first: [API_KEY]",
    );
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
      expect(after.status?.discoveredCapabilities?.tools).toHaveLength(1);
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
    const server = await seedServer();
    const harness = makeHarness({ attached: true });
    const result = await startConnect(
      harness.deps,
      connectInput(server.metadata!.id, { K: { value: "v", isSecret: false } }),
    );
    expect(result.metadata?.id).toBe(server.metadata!.id);
    expect(harness.ecCreates).toBe(1);
    await vi.waitFor(() => expect(harness.ecDeletes).toEqual(["ectx_1"]));
  });
});

describe("startBestEffortConnect (apply tail)", () => {
  it("returns silently while the engine is disconnected (Go's nil-client no-op)", async () => {
    const harness = makeHarness();
    const engine = harness.engine;
    harness.deps = { ...harness.deps, engineState: () => MCP_SERVER_ENGINE_DISCONNECTED };
    const server = await seedServer();
    await startBestEffortConnect(harness.deps, server);
    expect(engine.startedInputs).toHaveLength(0);
  });

  it("skips servers with env declarations (no caller identity in the background)", async () => {
    const harness = makeHarness();
    const server = await seedServer({ env: true });
    await startBestEffortConnect(harness.deps, server);
    expect(harness.engine.startedInputs).toHaveLength(0);
  });

  it("connects an env-less server and persists the result", async () => {
    const harness = makeHarness();
    const server = await seedServer();
    await startBestEffortConnect(harness.deps, server);
    const after = await store.getResource(
      ApiResourceKind.mcp_server,
      server.metadata!.id,
      McpServerSchema,
    );
    expect(after.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);
    expect(after.status?.discoveredCapabilities?.tools).toHaveLength(1);
  });

  it("never throws when the server was deleted mid-connect", async () => {
    const harness = makeHarness();
    const server = await seedServer();
    await store.deleteResource(ApiResourceKind.mcp_server, server.metadata!.id);
    await expect(
      startBestEffortConnect(harness.deps, server),
    ).resolves.toBeUndefined();
  });
});
