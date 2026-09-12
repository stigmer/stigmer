import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import type http2Type from "node:http2";
import { installHttp2Interceptor, uninstallHttp2Interceptor, assertHttp2ConnectPatched } from "../http2-interceptor.js";
import { getExecutionContext } from "../../../shared/execution-context.js";

const require = createRequire(import.meta.url);
const http2: typeof http2Type = require("node:http2");

const PROXY_ENDPOINT = "https://proxy.example.com:8443";
const STIGMER_TOKEN = "test-stigmer-jwt-token";
const NON_PROXY_AUTHORITY = "https://temporal.internal:7233";

interface RequestCall {
  authority: string | URL;
  headers?: http2Type.OutgoingHttpHeaders;
}

/**
 * Creates a mock http2.connect that records request() calls.
 * Must be installed BEFORE installHttp2Interceptor() so the interceptor
 * chains through it (it captures http2.connect at install time).
 */
function createMockConnect() {
  const calls: RequestCall[] = [];
  const mockStream = {} as http2Type.ClientHttp2Stream;

  const mockConnect = ((authority: string | URL) => {
    const session = {
      request(headers?: http2Type.OutgoingHttpHeaders) {
        calls.push({ authority, headers });
        return mockStream;
      },
      close() {},
      destroy() {},
      once() { return session; },
      on() { return session; },
    } as unknown as http2Type.ClientHttp2Session;
    return session;
  }) as typeof http2.connect;

  return { calls, mockStream, mockConnect };
}

describe("http2-interceptor", () => {
  const trueOriginalConnect = http2.connect;

  afterEach(() => {
    uninstallHttp2Interceptor();
    http2.connect = trueOriginalConnect;
  });

  describe("installHttp2Interceptor", () => {
    it("is a no-op when proxyEndpoint is undefined", () => {
      const before = http2.connect;
      installHttp2Interceptor({ proxyEndpoint: undefined, proxyTokenRef: { current: STIGMER_TOKEN } });
      expect(http2.connect).toBe(before);
    });

    it("is a no-op when proxyEndpoint is empty string", () => {
      const before = http2.connect;
      installHttp2Interceptor({ proxyEndpoint: "", proxyTokenRef: { current: STIGMER_TOKEN } });
      expect(http2.connect).toBe(before);
    });

    it("is a no-op when no token ref is bound", () => {
      const before = http2.connect;
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, proxyTokenRef: undefined });
      expect(http2.connect).toBe(before);
    });

    it("is a no-op when the bound ref is empty at install", () => {
      const before = http2.connect;
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, proxyTokenRef: { current: null } });
      expect(http2.connect).toBe(before);
    });

    it("replaces http2.connect when proxyEndpoint and a bound ref are valid", () => {
      const before = http2.connect;
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, proxyTokenRef: { current: STIGMER_TOKEN } });
      expect(http2.connect).not.toBe(before);
    });

    it("is idempotent: a second install rebinds the ref and does not wrap a proxy session twice", async () => {
      const mock = createMockConnect();
      http2.connect = mock.mockConnect;
      const first = { current: "first-token" };
      const second = { current: "second-token" };
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, proxyTokenRef: first });
      const patched = http2.connect;

      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, proxyTokenRef: second });
      // The one patch stays; a re-capture here would have made the patched
      // connect the "original" and wrapped every proxy session twice.
      expect(http2.connect).toBe(patched);

      const session = http2.connect(PROXY_ENDPOINT);
      session.request({ ":path": "/agent.v1.AgentService/Run" });
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].headers).toHaveProperty("x-stigmer-auth", "Bearer second-token");

      // Uninstall restores the connect that was live at the FIRST install.
      uninstallHttp2Interceptor();
      expect(http2.connect).toBe(mock.mockConnect);
    });
  });

  describe("uninstallHttp2Interceptor", () => {
    it("restores the connect function that was active at install time", () => {
      const { mockConnect } = createMockConnect();
      http2.connect = mockConnect;

      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, proxyTokenRef: { current: STIGMER_TOKEN } });
      expect(http2.connect).not.toBe(mockConnect);

      uninstallHttp2Interceptor();
      expect(http2.connect).toBe(mockConnect);
    });
  });

  describe("header injection", () => {
    let mock: ReturnType<typeof createMockConnect>;

    beforeEach(() => {
      mock = createMockConnect();
      http2.connect = mock.mockConnect;
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, proxyTokenRef: { current: STIGMER_TOKEN } });
    });

    it("injects x-stigmer-execution-id and x-stigmer-auth when context is active and target is proxy", async () => {
      const executionContext = getExecutionContext();
      await executionContext.run({ executionId: "exec-abc-123" }, async () => {
        const session = http2.connect(PROXY_ENDPOINT);
        session.request({ ":method": "POST", ":path": "/agent.v1.AgentService/Run" });
      });

      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].headers).toMatchObject({
        ":method": "POST",
        ":path": "/agent.v1.AgentService/Run",
        "x-stigmer-auth": `Bearer ${STIGMER_TOKEN}`,
        "x-stigmer-execution-id": "exec-abc-123",
      });
    });

    it("injects x-stigmer-auth but NOT x-stigmer-execution-id when no execution context is active", () => {
      const session = http2.connect(PROXY_ENDPOINT);
      session.request({ ":method": "POST", ":path": "/agent.v1.AgentService/Run" });

      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].headers).toHaveProperty("x-stigmer-auth", `Bearer ${STIGMER_TOKEN}`);
      expect(mock.calls[0].headers).not.toHaveProperty("x-stigmer-execution-id");
    });

    it("does NOT inject header when target is not the proxy endpoint", async () => {
      const executionContext = getExecutionContext();
      await executionContext.run({ executionId: "exec-xyz-789" }, async () => {
        const session = http2.connect(NON_PROXY_AUTHORITY);
        session.request({ ":method": "POST", ":path": "/temporal.api.v1/StartWorkflow" });
      });

      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].headers).not.toHaveProperty("x-stigmer-execution-id");
    });

    it("injects x-stigmer-auth without modifying existing authorization header", async () => {
      const executionContext = getExecutionContext();
      await executionContext.run({ executionId: "exec-preserve" }, async () => {
        const session = http2.connect(PROXY_ENDPOINT);
        session.request({
          ":method": "POST",
          ":path": "/agent.v1.AgentService/Run",
          "authorization": "Bearer original-cursor-token",
          "content-type": "application/connect+proto",
        });
      });

      expect(mock.calls[0].headers).toMatchObject({
        ":method": "POST",
        ":path": "/agent.v1.AgentService/Run",
        "authorization": "Bearer original-cursor-token",
        "x-stigmer-auth": `Bearer ${STIGMER_TOKEN}`,
        "content-type": "application/connect+proto",
        "x-stigmer-execution-id": "exec-preserve",
      });
    });

    it("handles request() with no headers argument", async () => {
      const executionContext = getExecutionContext();
      await executionContext.run({ executionId: "exec-no-headers" }, async () => {
        const session = http2.connect(PROXY_ENDPOINT);
        session.request();
      });

      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].headers).toMatchObject({
        "x-stigmer-execution-id": "exec-no-headers",
      });
    });

    it("returns the stream from the underlying session.request()", async () => {
      const executionContext = getExecutionContext();
      let returnedStream: http2Type.ClientHttp2Stream | undefined;

      await executionContext.run({ executionId: "exec-return" }, async () => {
        const session = http2.connect(PROXY_ENDPOINT);
        returnedStream = session.request({});
      });

      expect(returnedStream).toBe(mock.mockStream);
    });
  });

  describe("connection reuse with different execution contexts", () => {
    let mock: ReturnType<typeof createMockConnect>;

    beforeEach(() => {
      mock = createMockConnect();
      http2.connect = mock.mockConnect;
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, proxyTokenRef: { current: STIGMER_TOKEN } });
    });

    it("different requests on same session get execution IDs from their respective ALS contexts", async () => {
      const executionContext = getExecutionContext();
      const session = http2.connect(PROXY_ENDPOINT);

      await executionContext.run({ executionId: "exec-first" }, async () => {
        session.request({ ":path": "/agent.v1.AgentService/Run" });
      });

      await executionContext.run({ executionId: "exec-second" }, async () => {
        session.request({ ":path": "/agent.v1.AgentService/Run" });
      });

      expect(mock.calls).toHaveLength(2);
      expect(mock.calls[0].headers).toMatchObject({ "x-stigmer-execution-id": "exec-first" });
      expect(mock.calls[1].headers).toMatchObject({ "x-stigmer-execution-id": "exec-second" });
    });

    it("request outside any context on a proxy session has auth but no execution ID", async () => {
      const executionContext = getExecutionContext();
      const session = http2.connect(PROXY_ENDPOINT);

      await executionContext.run({ executionId: "exec-scoped" }, async () => {
        session.request({ ":path": "/first" });
      });

      session.request({ ":path": "/second" });

      expect(mock.calls[0].headers).toHaveProperty("x-stigmer-execution-id", "exec-scoped");
      expect(mock.calls[0].headers).toHaveProperty("x-stigmer-auth", `Bearer ${STIGMER_TOKEN}`);
      expect(mock.calls[1].headers).not.toHaveProperty("x-stigmer-execution-id");
      expect(mock.calls[1].headers).toHaveProperty("x-stigmer-auth", `Bearer ${STIGMER_TOKEN}`);
    });
  });

  describe("proxy endpoint parsing", () => {
    it("matches https with explicit port", async () => {
      const mock = createMockConnect();
      http2.connect = mock.mockConnect;
      installHttp2Interceptor({ proxyEndpoint: "https://proxy.example.com:9443", proxyTokenRef: { current: STIGMER_TOKEN } });

      const executionContext = getExecutionContext();
      await executionContext.run({ executionId: "exec-port" }, async () => {
        const session = http2.connect("https://proxy.example.com:9443");
        session.request({});
      });

      expect(mock.calls[0].headers).toHaveProperty("x-stigmer-execution-id", "exec-port");
    });

    it("matches https with default port (443)", async () => {
      const mock = createMockConnect();
      http2.connect = mock.mockConnect;
      installHttp2Interceptor({ proxyEndpoint: "https://proxy.example.com", proxyTokenRef: { current: STIGMER_TOKEN } });

      const executionContext = getExecutionContext();
      await executionContext.run({ executionId: "exec-default-port" }, async () => {
        const session = http2.connect("https://proxy.example.com");
        session.request({});
      });

      expect(mock.calls[0].headers).toHaveProperty("x-stigmer-execution-id", "exec-default-port");
    });

    it("matches http with explicit port", async () => {
      const mock = createMockConnect();
      http2.connect = mock.mockConnect;
      installHttp2Interceptor({ proxyEndpoint: "http://localhost:9090", proxyTokenRef: { current: STIGMER_TOKEN } });

      const executionContext = getExecutionContext();
      await executionContext.run({ executionId: "exec-http" }, async () => {
        const session = http2.connect("http://localhost:9090");
        session.request({});
      });

      expect(mock.calls[0].headers).toHaveProperty("x-stigmer-execution-id", "exec-http");
    });

    it("does not match when port differs", async () => {
      const mock = createMockConnect();
      http2.connect = mock.mockConnect;
      installHttp2Interceptor({ proxyEndpoint: "https://proxy.example.com:8443", proxyTokenRef: { current: STIGMER_TOKEN } });

      const executionContext = getExecutionContext();
      await executionContext.run({ executionId: "exec-wrong-port" }, async () => {
        const session = http2.connect("https://proxy.example.com:9999");
        session.request({});
      });

      expect(mock.calls[0].headers).not.toHaveProperty("x-stigmer-execution-id");
    });
  });

  describe("the token ref is read per request (the root rotates it in place; Q-S2-7)", () => {
    let mock: ReturnType<typeof createMockConnect>;
    let proxyTokenRef: { current: string | null };

    beforeEach(() => {
      mock = createMockConnect();
      http2.connect = mock.mockConnect;
      proxyTokenRef = { current: STIGMER_TOKEN };
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, proxyTokenRef });
    });

    it("a session opened BEFORE a rotation carries the new token on its next request", () => {
      const session = http2.connect(PROXY_ENDPOINT);
      session.request({ ":path": "/agent.v1.AgentService/Run" });
      expect(mock.calls[0].headers).toHaveProperty("x-stigmer-auth", `Bearer ${STIGMER_TOKEN}`);

      proxyTokenRef.current = "refreshed-stigmer-jwt-token";
      session.request({ ":path": "/agent.v1.AgentService/Run" });

      expect(mock.calls[1].headers).toHaveProperty("x-stigmer-auth", "Bearer refreshed-stigmer-jwt-token");
    });

    it("a session opened AFTER a rotation carries the new token", () => {
      proxyTokenRef.current = "new-token-value";

      const session = http2.connect(PROXY_ENDPOINT);
      session.request({ ":path": "/aiserver.v1.AnalyticsService/BootstrapStatsig" });

      expect(mock.calls[0].headers).toHaveProperty("x-stigmer-auth", "Bearer new-token-value");
    });

    it("an emptied ref omits x-stigmer-auth and keeps the execution id (the proxy's 401 is the diagnostic)", async () => {
      proxyTokenRef.current = null;
      const executionContext = getExecutionContext();
      await executionContext.run({ executionId: "exec-empty-ref" }, async () => {
        const session = http2.connect(PROXY_ENDPOINT);
        session.request({ ":path": "/agent.v1.AgentService/Run" });
      });

      expect(mock.calls[0].headers).not.toHaveProperty("x-stigmer-auth");
      expect(mock.calls[0].headers).toHaveProperty("x-stigmer-execution-id", "exec-empty-ref");
    });
  });

  describe("assertHttp2ConnectPatched", () => {
    // The node:http2 ESM namespace is a one-time, process-global snapshot taken
    // at the module's FIRST `import` (see header comment in http2-interceptor.ts
    // and CASE A/B in the probe). That makes the positive "configured + in-sync"
    // path impossible to assert deterministically inside a shared test process
    // — it is guaranteed by load order (interceptor installed before connect-node
    // imports node:http2), exercised by the boot guard inside the Cursor
    // adapter's boot, and proven in a FRESH process by
    // src/__tests__/harness-boot-order.test.ts. Here we cover the two deterministic contracts: it is a no-op
    // when unconfigured (no import, so it never freezes the facade), and it
    // throws when the frozen facade is out of sync with the patched connect.
    //
    // This guard does double duty as a BUNDLER regression detector. The
    // load-order contract is also defeatable at build time: an ESM esbuild
    // bundle hoists every external `import` (including the node:http2 pulled in
    // by connect-node) to the top of the output, freezing the facade before any
    // install() runs. That is exactly stigmer/stigmer#170's second failure — the
    // slim bundle is therefore emitted as CJS (scripts/bundle-slim.mjs) and
    // verified on the authenticated boot path (scripts/verify-slim-artifact.mjs).
    // The "out of sync" case below is the unit-level analog of that bundle bug.

    it("resolves without throwing (and without importing node:http2) when unconfigured", async () => {
      uninstallHttp2Interceptor();
      await expect(assertHttp2ConnectPatched()).resolves.toBeUndefined();
    });

    it("throws when the ESM facade is out of sync with the patched connect (load-order regression)", async () => {
      // Freeze the ESM facade to the pre-patch connect, simulating connect-node
      // importing node:http2 before installHttp2Interceptor() ran.
      await import("node:http2");

      const mock = createMockConnect();
      http2.connect = mock.mockConnect;
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, proxyTokenRef: { current: STIGMER_TOKEN } });

      await expect(assertHttp2ConnectPatched()).rejects.toThrow(
        /node:http2 ESM facade is unpatched/,
      );
    });
  });
});
