/**
 * A failed MCP connect's network error is logged (`../mcp-network-errors.ts`):
 * each request's error is tied to the connect that made it by undici's
 * request object, never by origin or time, so two connects to one server at
 * once each log their own; an error that already has a cause, or names no
 * HTTP server, logs nothing; a request outside a connect is never recorded.
 * The error itself is rethrown untouched, so what the runtime words for the
 * user still names the server. Hermetic: the servers are local sockets that
 * reset every connection.
 */
import { channel } from "node:diagnostics_channel";
import { createServer as createNetServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { connectBridge } from "../../activities/execute-claude/mcp-bridge.js";
import { runWithExecutionContext } from "../execution-context.js";
import { connectMcpServers } from "../mcp-manager.js";
import { withNetworkErrorCapture } from "../mcp-network-errors.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";
import { describeExecutionError } from "../model-error.js";

const servers: Server[] = [];
let consoleError: MockInstance<typeof console.error>;

/** A local server that resets every connection it accepts; its base URL. */
async function resettingServer(): Promise<string> {
  const server = createNetServer((socket) => socket.resetAndDestroy());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the resetting server has no port");
  return `http://127.0.0.1:${address.port}`;
}

/** The adapter's connect error: its name, its server, no cause. */
function adapterError(serverName: string): Error {
  return Object.assign(new Error(`Failed to connect to streamable HTTP server "${serverName}": TypeError: fetch failed`), {
    name: "MCPClientError",
    serverName,
  });
}

/** A connect that fetches `url` as the MCP transport does, then fails as the adapter does. */
async function failingConnect(serverName: string, url: string): Promise<never> {
  await fetch(url, { method: "POST", body: "{}" }).catch(() => undefined);
  throw adapterError(serverName);
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected the connect to fail");
    },
    (err: unknown) => {
      if (!(err instanceof Error)) throw new Error(`expected an Error, got ${String(err)}`);
      return err;
    },
  );
}

/** The lines this module logged. */
function networkLines(): string[] {
  return consoleError.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith("[MCP] Server "));
}

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  consoleError.mockRestore();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("withNetworkErrorCapture", () => {
  it("logs the network error of the server's request, naming the server and the execution", async () => {
    const url = `${await resettingServer()}/mcp`;
    const err = await rejectionOf(
      runWithExecutionContext("aex-1", () => withNetworkErrorCapture(new Map([["docs", url]]), () => failingConnect("docs", url))),
    );
    expect(networkLines()).toEqual([expect.stringMatching(/^\[MCP\] Server 'docs' did not connect: execution=aex-1, network=Error ECONNRESET: /)]);
    expect(err.name).toBe("MCPClientError");
    expect(err.cause).toBeUndefined();
  });

  it("leaves the execution out of the line outside a turn", async () => {
    const url = `${await resettingServer()}/mcp`;
    await rejectionOf(withNetworkErrorCapture(new Map([["docs", url]]), () => failingConnect("docs", url)));
    expect(networkLines()).toEqual([expect.stringMatching(/^\[MCP\] Server 'docs' did not connect: network=Error ECONNRESET: /)]);
  });

  it("logs, for two connects to one server at once, each its own request's error", async () => {
    const url = `${await resettingServer()}/mcp`;
    await Promise.all([
      rejectionOf(runWithExecutionContext("aex-a", () => withNetworkErrorCapture(new Map([["docs", url]]), () => failingConnect("docs", url)))),
      rejectionOf(runWithExecutionContext("aex-b", () => withNetworkErrorCapture(new Map([["docs", url]]), () => failingConnect("docs", url)))),
    ]);
    const lines = networkLines();
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.includes("execution=aex-a, network=Error ECONNRESET"))).toBe(true);
    expect(lines.some((line) => line.includes("execution=aex-b, network=Error ECONNRESET"))).toBe(true);
  });

  it("never takes the error of another connect's request to the same server", async () => {
    const url = `${await resettingServer()}/mcp`;
    let otherFetched!: () => void;
    const fetched = new Promise<void>((resolve) => (otherFetched = resolve));
    await Promise.all([
      rejectionOf(
        runWithExecutionContext("aex-quiet", () =>
          withNetworkErrorCapture(new Map([["docs", url]]), async () => {
            await fetched;
            throw adapterError("docs");
          }),
        ),
      ),
      rejectionOf(
        runWithExecutionContext("aex-fetching", () =>
          withNetworkErrorCapture(new Map([["docs", url]]), async () => {
            await fetch(url).catch(() => undefined);
            otherFetched();
            throw adapterError("docs");
          }),
        ),
      ),
    ]);
    expect(networkLines()).toEqual([expect.stringContaining("execution=aex-fetching, ")]);
  });

  it("logs nothing for an error that already has a cause, and leaves it alone", async () => {
    const url = `${await resettingServer()}/mcp`;
    const own = new Error("its own cause");
    const err = await rejectionOf(
      withNetworkErrorCapture(new Map([["docs", url]]), async () => {
        await fetch(url).catch(() => undefined);
        throw Object.assign(new Error("failed", { cause: own }), { serverName: "docs" });
      }),
    );
    expect(err.cause).toBe(own);
    expect(networkLines()).toEqual([]);
  });

  it("logs nothing for an error that names no HTTP server", async () => {
    const url = `${await resettingServer()}/mcp`;
    await rejectionOf(withNetworkErrorCapture(new Map([["docs", url]]), () => failingConnect("stdio-server", url)));
    expect(networkLines()).toEqual([]);
  });

  it("never records a request made outside a connect", async () => {
    const url = `${await resettingServer()}/mcp`;
    await fetch(url).catch(() => undefined);
    await rejectionOf(
      withNetworkErrorCapture(new Map([["docs", url]]), async () => {
        throw adapterError("docs");
      }),
    );
    expect(networkLines()).toEqual([]);
  });

  it("logs nothing for a server whose configured URL does not parse", async () => {
    const url = `${await resettingServer()}/mcp`;
    await rejectionOf(withNetworkErrorCapture(new Map([["docs", "not a url"]]), () => failingConnect("docs", url)));
    expect(networkLines()).toEqual([]);
  });

  describe("reads undici's channel messages by shape", () => {
    const SERVER_URL = "http://mcp.example.test/mcp";

    /** One request's create and error, as undici publishes them. */
    function publishRequest(request: object, error: unknown): void {
      channel("undici:request:create").publish({ request });
      channel("undici:request:error").publish({ request, error });
    }

    it("records nothing of a message whose request or error has the wrong shape", async () => {
      await rejectionOf(
        withNetworkErrorCapture(new Map([["docs", SERVER_URL]]), async () => {
          channel("undici:request:create").publish({ request: "not an object" });
          channel("undici:request:error").publish({ request: null, error: new Error("no request") });
          publishRequest({ origin: 7, path: "/mcp" }, new Error("origin is no string"));
          publishRequest({ origin: "http://mcp.example.test", path: "/mcp" }, "not an error");
          publishRequest({ origin: "not a url", path: "/mcp" }, new Error("no URL"));
          throw adapterError("docs");
        }),
      );
      expect(networkLines()).toEqual([]);
    });

    it("records at most a bounded number of errors per connect", async () => {
      await rejectionOf(
        withNetworkErrorCapture(new Map([["docs", SERVER_URL]]), async () => {
          for (let other = 0; other < 32; other++) publishRequest({ origin: "http://other.example.test", path: `/${other}` }, new Error("other"));
          publishRequest({ origin: "http://mcp.example.test", path: "/mcp" }, new Error("past the bound"));
          throw adapterError("docs");
        }),
      );
      expect(networkLines()).toEqual([]);
    });

    it("finds the server's request among others by its URL", async () => {
      await rejectionOf(
        withNetworkErrorCapture(new Map([["docs", SERVER_URL]]), async () => {
          publishRequest({ origin: "http://other.example.test", path: "/mcp" }, new Error("another server"));
          publishRequest({ origin: "http://mcp.example.test", path: "/mcp" }, Object.assign(new Error("getaddrinfo ENOTFOUND mcp.example.test"), { code: "ENOTFOUND" }));
          throw adapterError("docs");
        }),
      );
      expect(networkLines()).toEqual(["[MCP] Server 'docs' did not connect: network=Error ENOTFOUND: getaddrinfo ENOTFOUND mcp.example.test"]);
    });
  });

  it("returns what a connect that succeeds returns, and logs nothing", async () => {
    await expect(withNetworkErrorCapture(new Map(), async () => "connected")).resolves.toBe("connected");
    expect(networkLines()).toEqual([]);
  });
});

describe("a failed MCP connect, through the real adapter", () => {
  function httpServer(url: string): ResolvedMcpServer {
    return { slug: "docs", connectionType: "http", url, home: { kind: "platform" } };
  }

  /** What the engines word for the user (`classifyThrown`): the adapter's error, naming the server, never the bare network error. */
  function expectWordedAsTheAdapters(err: Error, url: string): void {
    const described = describeExecutionError(err, { proxyMode: false });
    expect(described.errorType).toBe("MCPClientError");
    expect(described.errorMessage).toContain(url);
  }

  it("on the Stigmer harness's path logs the network error and words the adapter's error for the user", async () => {
    const url = `${await resettingServer()}/mcp`;
    const err = await rejectionOf(runWithExecutionContext("aex-stigmer", () => connectMcpServers([httpServer(url)])));
    expect(networkLines()).toEqual([expect.stringMatching(/^\[MCP\] Server 'docs' did not connect: execution=aex-stigmer, network=Error ECONNRESET: /)]);
    expectWordedAsTheAdapters(err, url);
  });

  it("on the Claude bridge logs the network error and words the adapter's error for the user", async () => {
    const url = `${await resettingServer()}/mcp`;
    const err = await rejectionOf(runWithExecutionContext("aex-claude", () => connectBridge([httpServer(url)], () => true, new Set())));
    expect(networkLines()).toEqual([expect.stringMatching(/^\[MCP\] Server 'docs' did not connect: execution=aex-claude, network=Error ECONNRESET: /)]);
    expectWordedAsTheAdapters(err, url);
  });
});
