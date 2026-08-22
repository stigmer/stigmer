import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const PROXY_ENDPOINT = "https://proxy.example.com:9093";
const STIGMER_TOKEN = "test-stigmer-jwt-token";

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

/**
 * The fetch interceptor captures globalThis.fetch at module load time as
 * `originalFetch`. To test it properly, we must install a mock fetch
 * BEFORE the module loads, then dynamically import it. This ensures the
 * interceptor delegates to our mock instead of the real network fetch.
 */
describe("fetch-interceptor", () => {
  const realFetch = globalThis.fetch;
  let calls: CapturedCall[];
  let installFetchInterceptor: typeof import("../fetch-interceptor.js").installFetchInterceptor;
  let uninstallFetchInterceptor: typeof import("../fetch-interceptor.js").uninstallFetchInterceptor;
  let getExecutionContext: typeof import("../fetch-interceptor.js").getExecutionContext;

  beforeEach(async () => {
    calls = [];
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
      calls.push({ url, init });
      return mockResponse.clone();
    }) as typeof fetch;

    // Bust the module cache so originalFetch captures our mock
    vi.resetModules();
    const mod = await import("../fetch-interceptor.js");
    installFetchInterceptor = mod.installFetchInterceptor;
    uninstallFetchInterceptor = mod.uninstallFetchInterceptor;
    getExecutionContext = mod.getExecutionContext;
  });

  afterEach(() => {
    uninstallFetchInterceptor();
    globalThis.fetch = realFetch;
  });

  describe("Connect-RPC paths via fetch (BiDi proxy auth injection)", () => {
    beforeEach(() => {
      installFetchInterceptor({ proxyEndpoint: PROXY_ENDPOINT, stigmerToken: STIGMER_TOKEN });
    });

    it("injects x-stigmer-auth on /aiserver.v1 path targeting proxy endpoint", async () => {
      await globalThis.fetch(
        `${PROXY_ENDPOINT}/aiserver.v1.AnalyticsService/BootstrapStatsig`,
        {
          method: "POST",
          headers: {
            "authorization": "Bearer cursor-access-token",
            "content-type": "application/json",
          },
        },
      );

      expect(calls).toHaveLength(1);
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("x-stigmer-auth")).toBe(`Bearer ${STIGMER_TOKEN}`);
    });

    it("preserves the original authorization header (Cursor access token)", async () => {
      await globalThis.fetch(
        `${PROXY_ENDPOINT}/aiserver.v1.AnalyticsService/BootstrapStatsig`,
        {
          method: "POST",
          headers: { "authorization": "Bearer cursor-access-token" },
        },
      );

      expect(calls).toHaveLength(1);
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("authorization")).toBe("Bearer cursor-access-token");
      expect(headers.get("x-stigmer-auth")).toBe(`Bearer ${STIGMER_TOKEN}`);
    });

    it("does NOT rewrite the URL for Connect-RPC paths", async () => {
      const originalUrl = `${PROXY_ENDPOINT}/aiserver.v1.AnalyticsService/BootstrapStatsig`;

      await globalThis.fetch(originalUrl, { method: "POST" });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(originalUrl);
    });

    it("injects x-stigmer-auth on /agent.v1 path targeting proxy endpoint", async () => {
      await globalThis.fetch(
        `${PROXY_ENDPOINT}/agent.v1.AgentService/Run`,
        {
          method: "POST",
          headers: { "authorization": "Bearer cursor-token" },
        },
      );

      expect(calls).toHaveLength(1);
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("x-stigmer-auth")).toBe(`Bearer ${STIGMER_TOKEN}`);
      expect(headers.get("authorization")).toBe("Bearer cursor-token");
    });

    it("injects x-stigmer-execution-id when execution context is active", async () => {
      const executionContext = getExecutionContext();
      await executionContext.run({ executionId: "exec-test-123" }, async () => {
        await globalThis.fetch(
          `${PROXY_ENDPOINT}/aiserver.v1.AnalyticsService/LogStatsigEvent`,
          { method: "POST" },
        );
      });

      expect(calls).toHaveLength(1);
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("x-stigmer-execution-id")).toBe("exec-test-123");
      expect(headers.get("x-stigmer-auth")).toBe(`Bearer ${STIGMER_TOKEN}`);
    });

    it("does NOT inject x-stigmer-execution-id when no execution context", async () => {
      await globalThis.fetch(
        `${PROXY_ENDPOINT}/aiserver.v1.AnalyticsService/BootstrapStatsig`,
        { method: "POST" },
      );

      expect(calls).toHaveLength(1);
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("x-stigmer-execution-id")).toBeNull();
      expect(headers.get("x-stigmer-auth")).toBe(`Bearer ${STIGMER_TOKEN}`);
    });
  });

  describe("REST path URL rewriting (existing behavior)", () => {
    beforeEach(() => {
      installFetchInterceptor({ proxyEndpoint: PROXY_ENDPOINT, stigmerToken: STIGMER_TOKEN });
    });

    it("rewrites Cursor-domain REST URLs and replaces auth", async () => {
      await globalThis.fetch(
        "https://api2.cursor.sh/auth/exchange_user_api_key",
        {
          method: "POST",
          headers: { "authorization": "Bearer original-key" },
        },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        `${PROXY_ENDPOINT}/v1/proxy/cursor/api2.cursor.sh/auth/exchange_user_api_key`,
      );
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${STIGMER_TOKEN}`);
      expect(headers.get("x-stigmer-auth")).toBeNull();
    });

    it("rewrites proxy-endpoint REST paths (non-Connect-RPC)", async () => {
      await globalThis.fetch(
        `${PROXY_ENDPOINT}/auth/exchange_user_api_key`,
        { method: "POST" },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain("/v1/proxy/cursor/api2.cursor.sh/auth/");
    });
  });

  describe("timed REST path timing", () => {
    beforeEach(() => {
      installFetchInterceptor({ proxyEndpoint: PROXY_ENDPOINT, stigmerToken: STIGMER_TOKEN });
    });

    /**
     * Collect emitted timing lines for one timeline event from a
     * console.log spy, ignoring every other log line (install banner,
     * warnings, other timelines).
     */
    function timingLines(
      spy: ReturnType<typeof vi.spyOn>,
      event: string,
    ): Array<Record<string, unknown>> {
      const lines: Array<Record<string, unknown>> = [];
      for (const call of spy.mock.calls) {
        if (typeof call[0] !== "string") continue;
        try {
          const parsed = JSON.parse(call[0]) as Record<string, unknown>;
          if (parsed.stigmer_timing === event) lines.push(parsed);
        } catch {
          // Not a JSON log line — ignore.
        }
      }
      return lines;
    }

    it("emits one cursor_models_fetch line for a Cursor-domain /v1/models call, carrying execution_id", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const executionContext = getExecutionContext();

      await executionContext.run({ executionId: "exec-models-1" }, async () => {
        await globalThis.fetch("https://api.cursor.com/v1/models", { method: "GET" });
      });

      const lines = timingLines(spy, "cursor_models_fetch");
      expect(lines).toHaveLength(1);
      expect(lines[0]!.execution_id).toBe("exec-models-1");
      expect(lines[0]!.http_status).toBe(200);
      expect(lines[0]!.total_ms).toBeTypeOf("number");
      const segments = lines[0]!.segments as Array<{ name: string }>;
      expect(segments.map((s) => s.name)).toEqual(["models_fetch"]);
    });

    it("emits one cursor_token_exchange line for the SDK's token exchange, carrying execution_id (cloud#484)", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const executionContext = getExecutionContext();

      await executionContext.run({ executionId: "exec-exchange-1" }, async () => {
        await globalThis.fetch(
          "https://api2.cursor.sh/auth/exchange_user_api_key",
          { method: "POST" },
        );
      });

      const lines = timingLines(spy, "cursor_token_exchange");
      expect(lines).toHaveLength(1);
      expect(lines[0]!.execution_id).toBe("exec-exchange-1");
      expect(lines[0]!.http_status).toBe(200);
      expect(lines[0]!.total_ms).toBeTypeOf("number");
      const segments = lines[0]!.segments as Array<{ name: string }>;
      expect(segments.map((s) => s.name)).toEqual(["token_exchange"]);
      // The exchange emits ONLY its own timeline, never the models one.
      expect(timingLines(spy, "cursor_models_fetch")).toHaveLength(0);
    });

    it("emits for the proxy-endpoint-targeted forms too", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await globalThis.fetch(`${PROXY_ENDPOINT}/v1/models`, { method: "GET" });
      await globalThis.fetch(
        `${PROXY_ENDPOINT}/auth/exchange_user_api_key`,
        { method: "POST" },
      );

      // Both fetches were rewritten through the proxy path AND timed.
      expect(calls[0]!.url).toBe(
        `${PROXY_ENDPOINT}/v1/proxy/cursor/api.cursor.com/v1/models`,
      );
      expect(calls[1]!.url).toBe(
        `${PROXY_ENDPOINT}/v1/proxy/cursor/api2.cursor.sh/auth/exchange_user_api_key`,
      );
      expect(timingLines(spy, "cursor_models_fetch")).toHaveLength(1);
      expect(timingLines(spy, "cursor_token_exchange")).toHaveLength(1);
    });

    it("omits execution_id (rather than fabricating one) outside an execution context", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await globalThis.fetch("https://api.cursor.com/v1/models", { method: "GET" });

      const lines = timingLines(spy, "cursor_models_fetch");
      expect(lines).toHaveLength(1);
      // undefined context values are dropped by JSON.stringify.
      expect("execution_id" in lines[0]!).toBe(false);
    });

    it("does NOT emit for rewritten REST paths outside the timed set", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});

      await globalThis.fetch(
        "https://api.cursor.com/v1/agents",
        { method: "POST" },
      );

      expect(calls).toHaveLength(1);
      expect(timingLines(spy, "cursor_models_fetch")).toHaveLength(0);
      expect(timingLines(spy, "cursor_token_exchange")).toHaveLength(0);
    });
  });

  describe("passthrough (no interception)", () => {
    beforeEach(() => {
      installFetchInterceptor({ proxyEndpoint: PROXY_ENDPOINT, stigmerToken: STIGMER_TOKEN });
    });

    it("does NOT intercept Connect-RPC paths on non-proxy hosts", async () => {
      const url = "https://other-host.example.com/aiserver.v1.AnalyticsService/BootstrapStatsig";

      await globalThis.fetch(url, {
        method: "POST",
        headers: { "authorization": "Bearer some-token" },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(url);
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("x-stigmer-auth")).toBeNull();
    });

    it("does NOT intercept already-rewritten /v1/proxy/ paths", async () => {
      const url = `${PROXY_ENDPOINT}/v1/proxy/cursor/api.cursor.com/v1/models`;

      await globalThis.fetch(url, { method: "GET" });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(url);
    });

    it("does NOT intercept non-Cursor, non-proxy requests", async () => {
      const url = "https://api.openai.com/v1/chat/completions";

      await globalThis.fetch(url, { method: "POST" });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(url);
    });
  });
});
