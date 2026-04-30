import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The interceptor captures `originalFetch = globalThis.fetch` at module load.
// We must install our mock BEFORE importing the module so `originalFetch`
// points to the mock, not Node's real fetch.
const mockFetch = vi.fn<typeof fetch>();
const realFetch = globalThis.fetch;
globalThis.fetch = mockFetch as unknown as typeof fetch;

// Now import — the module captures our mockFetch as originalFetch.
const {
  installFetchInterceptor,
  uninstallFetchInterceptor,
} = await import("../fetch-interceptor.js");

describe("fetch interceptor", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response("ok"));
    uninstallFetchInterceptor();
  });

  afterEach(() => {
    uninstallFetchInterceptor();
  });

  describe("installFetchInterceptor", () => {
    it("is a no-op when proxyEndpoint is undefined", () => {
      const before = globalThis.fetch;
      installFetchInterceptor({
        proxyEndpoint: undefined,
        stigmerToken: undefined,
      });
      expect(globalThis.fetch).toBe(before);
    });

    it("throws when proxyEndpoint is set without stigmerToken", () => {
      expect(() =>
        installFetchInterceptor({
          proxyEndpoint: "https://proxy.stigmer.ai",
          stigmerToken: undefined,
        }),
      ).toThrow("STIGMER_TOKEN is required");
    });

    it("replaces globalThis.fetch when properly configured", () => {
      const before = globalThis.fetch;
      installFetchInterceptor({
        proxyEndpoint: "https://proxy.stigmer.ai",
        stigmerToken: "tok-123",
      });
      expect(globalThis.fetch).not.toBe(before);
    });
  });

  describe("uninstallFetchInterceptor", () => {
    it("restores fetch to the pre-interceptor value", () => {
      installFetchInterceptor({
        proxyEndpoint: "https://proxy.stigmer.ai",
        stigmerToken: "tok-123",
      });
      const intercepted = globalThis.fetch;
      uninstallFetchInterceptor();
      expect(globalThis.fetch).not.toBe(intercepted);
    });
  });

  describe("proxy behavior", () => {
    beforeEach(() => {
      installFetchInterceptor({
        proxyEndpoint: "https://proxy.stigmer.ai",
        stigmerToken: "tok-proxy",
      });
    });

    it("rewrites Cursor domain URLs to proxy format", async () => {
      await globalThis.fetch(
        "https://api2.cursor.sh/aiserver.v1.AgentService/CreateAgent",
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://proxy.stigmer.ai/v1/proxy/cursor/api2.cursor.sh/aiserver.v1.AgentService/CreateAgent",
      );
    });

    it("rewrites api.cursor.com domain", async () => {
      await globalThis.fetch("https://api.cursor.com/v1/models");
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://proxy.stigmer.ai/v1/proxy/cursor/api.cursor.com/v1/models",
      );
    });

    it("rewrites api.cursor.sh domain", async () => {
      await globalThis.fetch("https://api.cursor.sh/health");
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(
        "https://proxy.stigmer.ai/v1/proxy/cursor/api.cursor.sh/health",
      );
    });

    it("replaces the authorization header with stigmerToken", async () => {
      await globalThis.fetch("https://api2.cursor.sh/v1/test", {
        headers: { authorization: "Bearer cursor-key-123" },
      });

      const [, init] = mockFetch.mock.calls[0];
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get("authorization")).toBe("Bearer tok-proxy");
    });

    it("passes non-Cursor URLs through unchanged", async () => {
      await globalThis.fetch("https://api.openai.com/v1/chat", {
        headers: { authorization: "Bearer openai-key" },
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/chat");
    });

    it("handles Cursor subdomain matching", async () => {
      await globalThis.fetch("https://sub.api2.cursor.sh/test");
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("proxy.stigmer.ai/v1/proxy/cursor/");
    });

    it("preserves query parameters in rewritten URLs", async () => {
      await globalThis.fetch(
        "https://api2.cursor.sh/v1/agents?limit=10&offset=0",
      );
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("?limit=10&offset=0");
    });

    it("handles URL object input", async () => {
      await globalThis.fetch(
        new URL("https://api2.cursor.sh/v1/test"),
      );
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("proxy.stigmer.ai/v1/proxy/cursor/");
    });

    it("handles Request object input", async () => {
      await globalThis.fetch(
        new Request("https://api2.cursor.sh/v1/test"),
      );
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("proxy.stigmer.ai/v1/proxy/cursor/");
    });
  });
});
