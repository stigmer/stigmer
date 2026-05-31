import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import type http2Type from "node:http2";
import { installHttp2Interceptor, uninstallHttp2Interceptor } from "../http2-interceptor.js";
import { getExecutionContext } from "../fetch-interceptor.js";

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
      installHttp2Interceptor({ proxyEndpoint: undefined, stigmerToken: STIGMER_TOKEN });
      expect(http2.connect).toBe(before);
    });

    it("is a no-op when proxyEndpoint is empty string", () => {
      const before = http2.connect;
      installHttp2Interceptor({ proxyEndpoint: "", stigmerToken: STIGMER_TOKEN });
      expect(http2.connect).toBe(before);
    });

    it("is a no-op when stigmerToken is undefined", () => {
      const before = http2.connect;
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, stigmerToken: undefined });
      expect(http2.connect).toBe(before);
    });

    it("replaces http2.connect when proxyEndpoint and stigmerToken are valid", () => {
      const before = http2.connect;
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, stigmerToken: STIGMER_TOKEN });
      expect(http2.connect).not.toBe(before);
    });
  });

  describe("uninstallHttp2Interceptor", () => {
    it("restores the connect function that was active at install time", () => {
      const { mockConnect } = createMockConnect();
      http2.connect = mockConnect;

      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, stigmerToken: STIGMER_TOKEN });
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
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, stigmerToken: STIGMER_TOKEN });
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

    it("does NOT inject headers when no execution context is active", () => {
      const session = http2.connect(PROXY_ENDPOINT);
      session.request({ ":method": "POST", ":path": "/agent.v1.AgentService/Run" });

      expect(mock.calls).toHaveLength(1);
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
      installHttp2Interceptor({ proxyEndpoint: PROXY_ENDPOINT, stigmerToken: STIGMER_TOKEN });
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

    it("request outside any context on a proxy session has no execution ID header", async () => {
      const executionContext = getExecutionContext();
      const session = http2.connect(PROXY_ENDPOINT);

      await executionContext.run({ executionId: "exec-scoped" }, async () => {
        session.request({ ":path": "/first" });
      });

      session.request({ ":path": "/second" });

      expect(mock.calls[0].headers).toHaveProperty("x-stigmer-execution-id", "exec-scoped");
      expect(mock.calls[1].headers).not.toHaveProperty("x-stigmer-execution-id");
    });
  });

  describe("proxy endpoint parsing", () => {
    it("matches https with explicit port", async () => {
      const mock = createMockConnect();
      http2.connect = mock.mockConnect;
      installHttp2Interceptor({ proxyEndpoint: "https://proxy.example.com:9443", stigmerToken: STIGMER_TOKEN });

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
      installHttp2Interceptor({ proxyEndpoint: "https://proxy.example.com", stigmerToken: STIGMER_TOKEN });

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
      installHttp2Interceptor({ proxyEndpoint: "http://localhost:9090", stigmerToken: STIGMER_TOKEN });

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
      installHttp2Interceptor({ proxyEndpoint: "https://proxy.example.com:8443", stigmerToken: STIGMER_TOKEN });

      const executionContext = getExecutionContext();
      await executionContext.run({ executionId: "exec-wrong-port" }, async () => {
        const session = http2.connect("https://proxy.example.com:9999");
        session.request({});
      });

      expect(mock.calls[0].headers).not.toHaveProperty("x-stigmer-execution-id");
    });
  });
});
