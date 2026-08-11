// In-process integration test for `connect mcp-server` orchestration.
//
// Stands up a Connect backend serving the McpServer query + command controllers,
// points an SDK node client at it, and drives connectMcpServer end to end: the
// push path (asserts ConnectInput fields + rendered capabilities), the OAuth
// guidance gate, and the dry-run path (local discovery, no Connect RPC).

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import {
  type ConnectInput,
  GetOAuthGrantStatusOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerAuthSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { Stigmer } from "@stigmer/sdk";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import { connectMcpServer } from "./connect.js";
import { renderConnectResult } from "./display.js";

const FIXTURE = fileURLToPath(new URL("./__fixtures__/stdio-server.mjs", import.meta.url));

let backend: Http2Server;
let client: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

let connectCalls: ConnectInput[] = [];
let grantConnected = false;
// Delay before the mock Connect RPC answers; lets the --timeout tests
// simulate a long-running server-side connect. The timer is unref'd so a
// still-pending delayed response can never hold the test process open.
let connectDelayMs = 0;
// The server returned by getByReference; mutated per test for auth scenarios.
let servedSpec: ReturnType<typeof create<typeof McpServerSchema>>;

beforeEach(() => {
  connectCalls = [];
  grantConnected = false;
  connectDelayMs = 0;
  servedSpec = create(McpServerSchema, {
    metadata: { id: "mcp_1", name: "github", slug: "github", org: "acme" },
    spec: {
      serverType: { case: "stdio", value: { command: process.execPath, args: [FIXTURE] } },
      env: { GITHUB_TOKEN: { isSecret: true } },
    },
  });
});

// The updated server the Connect RPC returns, carrying discovered capabilities.
const updatedServer = create(McpServerSchema, {
  metadata: { id: "mcp_1", name: "github", slug: "github", org: "acme" },
  spec: { serverType: { case: "stdio", value: { command: "github-mcp" } } },
  status: {
    discoveredCapabilities: {
      tools: [{ name: "search_issues", description: "search issues" }],
      resourceTemplates: [{ name: "issue", uriTemplate: "github:///issues/{id}" }],
    },
  },
});

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(McpServerQueryController, {
      getByReference: () => servedSpec,
      get: () => servedSpec,
      getOAuthGrantStatus: () => create(GetOAuthGrantStatusOutputSchema, { connected: grantConnected }),
    });
    router.service(McpServerCommandController, {
      // Mirror the backend's protovalidate rule (org min_len=1): reject an empty
      // org so a regression that drops org fails loudly here instead of silently
      // passing (the mock adapter does not run protovalidate on its own).
      connect: async (req) => {
        if (req.org === "") throw new ConnectError("org – value length must be at least 1 characters", Code.InvalidArgument);
        if (connectDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, connectDelayMs).unref());
        }
        connectCalls.push(req);
        return updatedServer;
      },
    });
  };

  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;
  client = createNodeClient({ baseUrl: normalizeEndpoint(`127.0.0.1:${port}`) });
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("connect push path", () => {
  it("sends ConnectInput with merged runtime env and returns discovered capabilities", async () => {
    const result = await connectMcpServer(client, {
      reference: "github",
      org: "acme",
      timeoutMs: 30_000,
      dryRun: false,
      envOverrides: ["GITHUB_TOKEN=ghp-override"],
      backendType: "cloud",
      interactive: false,
    });

    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].mcpServerId).toBe("mcp_1");
    // The org resolved by the command must ride along on ConnectInput — the
    // backend requires it (issue #140: the CLI used to drop it entirely).
    expect(connectCalls[0].org).toBe("acme");
    expect(connectCalls[0].runtimeEnv.GITHUB_TOKEN.value).toBe("ghp-override");
    expect(connectCalls[0].runtimeEnv.GITHUB_TOKEN.isSecret).toBe(true);

    expect(result.updated?.metadata?.id).toBe("mcp_1");
    expect(result.capabilities?.tools.map((t) => t.name)).toEqual(["search_issues"]);
  });
});

describe("--timeout bounds the server-side connect (issue #239)", () => {
  it("stops waiting with actionable guidance when pushTimeoutMs elapses", async () => {
    connectDelayMs = 5_000;
    await expect(
      connectMcpServer(client, {
        reference: "github",
        org: "acme",
        timeoutMs: 30_000,
        pushTimeoutMs: 150,
        dryRun: false,
        envOverrides: ["GITHUB_TOKEN=ghp-x"],
        backendType: "cloud",
        interactive: false,
      }),
    ).rejects.toThrow(/Stopped waiting for the connect of MCP server 'github' after 0\.15s/);
  });

  it("does not bound the wait when pushTimeoutMs is unset (default --timeout)", async () => {
    // The flag's 30s default is sized for --dry-run local discovery; a real
    // connect legitimately outlives it, so only an explicit --timeout bounds
    // the push. 200ms of server delay stands in for "longer than the bound
    // would have been".
    connectDelayMs = 200;
    const result = await connectMcpServer(client, {
      reference: "github",
      org: "acme",
      timeoutMs: 100,
      dryRun: false,
      envOverrides: ["GITHUB_TOKEN=ghp-x"],
      backendType: "cloud",
      interactive: false,
    });
    expect(result.updated?.metadata?.id).toBe("mcp_1");
  });
});

describe("OAuth guidance gate", () => {
  beforeEach(() => {
    servedSpec.spec!.auth = create(McpServerAuthSchema, { targetEnvVar: "GITHUB_TOKEN" });
  });

  it("stops with actionable guidance when auth is required off an interactive terminal", async () => {
    await expect(
      connectMcpServer(client, {
        reference: "github",
        org: "acme",
        timeoutMs: 30_000,
        dryRun: false,
        envOverrides: [],
        backendType: "cloud",
        interactive: false,
      }),
    ).rejects.toThrow(UsageError);
    expect(connectCalls).toHaveLength(0);
  });

  it("proceeds when an OAuth grant already exists", async () => {
    grantConnected = true;
    await connectMcpServer(client, {
      reference: "github",
      org: "acme",
      timeoutMs: 30_000,
      dryRun: false,
      envOverrides: [],
      backendType: "cloud",
      interactive: false,
    });
    expect(connectCalls).toHaveLength(1);
  });

  it("proceeds when --env credentials are supplied (bypassing OAuth)", async () => {
    await connectMcpServer(client, {
      reference: "github",
      org: "acme",
      timeoutMs: 30_000,
      dryRun: false,
      envOverrides: ["GITHUB_TOKEN=ghp-x"],
      backendType: "cloud",
      interactive: false,
    });
    expect(connectCalls).toHaveLength(1);
  });
});

describe("oauth_only servers reject the manual-token routes", () => {
  beforeEach(() => {
    servedSpec.spec!.auth = create(McpServerAuthSchema, {
      targetEnvVar: "GITHUB_TOKEN",
      oauthOnly: true,
    });
  });

  it("rejects --env (which cannot satisfy an OAuth-only endpoint) instead of pushing a doomed token", async () => {
    const err = await connectMcpServer(client, {
      reference: "github",
      org: "acme",
      timeoutMs: 30_000,
      dryRun: false,
      envOverrides: ["GITHUB_TOKEN=ghp-x"],
      backendType: "cloud",
      interactive: false,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).message).toMatch(/requires OAuth/i);
    // The guidance must NOT recommend the manual-token route for an oauth_only server.
    expect((err as UsageError).message).not.toContain("--env TOKEN=");
    expect(connectCalls).toHaveLength(0);
  });

  it("omits the --env suggestion from the non-interactive OAuth guidance", async () => {
    const err = await connectMcpServer(client, {
      reference: "github",
      org: "acme",
      timeoutMs: 30_000,
      dryRun: false,
      envOverrides: [],
      backendType: "cloud",
      interactive: false,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).message).not.toContain("--env TOKEN=");
    expect(connectCalls).toHaveLength(0);
  });

  it("refuses --dry-run local discovery (no locally-obtainable OAuth token) with a clear message", async () => {
    const err = await connectMcpServer(client, {
      reference: "github",
      org: "acme",
      timeoutMs: 10_000,
      dryRun: true,
      envOverrides: [],
      backendType: "cloud",
      interactive: false,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).message).toMatch(/requires OAuth/i);
    expect((err as UsageError).message).toContain("--dry-run");
    expect(connectCalls).toHaveLength(0);
  });
});

describe("dry-run path", () => {
  it("discovers locally and never calls the Connect RPC", async () => {
    const result = await connectMcpServer(client, {
      reference: "github",
      org: "acme",
      timeoutMs: 10_000,
      dryRun: true,
      envOverrides: [],
      backendType: "cloud",
      interactive: false,
    });

    expect(connectCalls).toHaveLength(0);
    expect(result.updated).toBeUndefined();
    expect(result.capabilities?.tools.map((t) => t.name)).toEqual(["echo", "noop"]);

    const lines: string[] = [];
    renderConnectResult(result, (l) => lines.push(l), false);
    const text = lines.join("\n");
    expect(text).toContain("MCP Server: acme/github");
    expect(text).toContain("Transport:  stdio");
    expect(text).toContain("Tools (2):");
    expect(text).toContain("Dry run — results not saved");
  }, 15_000);

  it("maps an unresolved ${VAR} arg to actionable guidance and never calls Connect", async () => {
    // Server references a declared env var in its args, but it is not set.
    delete process.env.NEEDED_DIR;
    servedSpec = create(McpServerSchema, {
      metadata: { id: "mcp_1", name: "filesystem", slug: "filesystem", org: "acme" },
      spec: {
        serverType: {
          case: "stdio",
          value: { command: process.execPath, args: [FIXTURE, "${NEEDED_DIR}"] },
        },
        env: { NEEDED_DIR: { isSecret: false, description: "Root directory the server may access" } },
      },
    });

    const err = await connectMcpServer(client, {
      reference: "filesystem",
      org: "acme",
      timeoutMs: 10_000,
      dryRun: true,
      envOverrides: [],
      backendType: "cloud",
      interactive: false,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UsageError);
    const message = (err as UsageError).message;
    expect(message).toContain("NEEDED_DIR");
    expect(message).toContain("--env");
    expect(connectCalls).toHaveLength(0);
  }, 15_000);
});
