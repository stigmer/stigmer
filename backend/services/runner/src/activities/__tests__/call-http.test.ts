import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callHttpAction, createCallHttpActivities } from "../call-http.js";

const originalFetch = globalThis.fetch;

describe("callHttpAction", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
    const headersObj = new Headers({ "content-type": "application/json", ...headers });
    return new Response(JSON.stringify(body), { status, headers: headersObj });
  }

  function textResponse(body: string, status = 200) {
    return new Response(body, { status, headers: { "content-type": "text/plain" } });
  }

  describe("successful requests", () => {
    it("performs a GET and returns parsed JSON content", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: 1, title: "Hello" }));

      const result = await callHttpAction(
        { method: "GET", endpoint: { uri: "https://api.example.com/posts/1" } },
        {},
      );

      expect(result).toEqual({ id: 1, title: "Hello" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/posts/1",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("performs a POST with JSON body", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: 101 }, 201));

      const result = await callHttpAction(
        {
          method: "POST",
          endpoint: "https://api.example.com/posts",
          body: { title: "New Post", userId: 1 },
        },
        {},
      );

      expect(result).toEqual({ id: 101 });
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].method).toBe("POST");
      expect(callArgs[1].body).toBe(JSON.stringify({ title: "New Post", userId: 1 }));
      expect(callArgs[1].headers["Content-Type"]).toBe("application/json");
    });

    it("returns plain text when response is not JSON", async () => {
      mockFetch.mockResolvedValue(textResponse("OK"));

      const result = await callHttpAction(
        { method: "GET", endpoint: "https://example.com/health" },
        {},
      );

      expect(result).toBe("OK");
    });

    it("appends query parameters to the URI", async () => {
      mockFetch.mockResolvedValue(jsonResponse([]));

      await callHttpAction(
        {
          method: "GET",
          endpoint: "https://api.example.com/search",
          query: { q: "test", page: "1" },
        },
        {},
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/search?q=test&page=1",
        expect.anything(),
      );
    });

    it("passes custom headers", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}));

      await callHttpAction(
        {
          method: "GET",
          endpoint: "https://api.example.com/data",
          headers: { Authorization: "Bearer tok123" },
        },
        {},
      );

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe("Bearer tok123");
    });

    it("uppercases the HTTP method", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}));

      await callHttpAction(
        { method: "post", endpoint: "https://example.com" },
        {},
      );

      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    });
  });

  describe("output modes", () => {
    it("returns full response object with output=response", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: "yes" }, 200, { "x-custom": "val" }));

      const result = await callHttpAction(
        {
          method: "GET",
          endpoint: "https://example.com",
          output: "response",
        },
        {},
      ) as Record<string, unknown>;

      expect(result).toHaveProperty("statusCode", 200);
      expect(result).toHaveProperty("content", { data: "yes" });
      expect(result).toHaveProperty("request");
      expect(result).toHaveProperty("headers");
    });

    it("returns base64 content with output=raw", async () => {
      const body = "Hello, World!";
      mockFetch.mockResolvedValue(new Response(body, { status: 200 }));

      const result = await callHttpAction(
        {
          method: "GET",
          endpoint: "https://example.com/file",
          output: "raw",
        },
        {},
      );

      expect(result).toBe(Buffer.from(body).toString("base64"));
    });
  });

  describe("error classification", () => {
    it("throws non-retryable ApplicationFailure for 4xx", async () => {
      mockFetch.mockResolvedValue(new Response("Not Found", { status: 404 }));

      await expect(
        callHttpAction(
          { method: "GET", endpoint: "https://example.com/missing" },
          {},
        ),
      ).rejects.toThrow("404");
    });

    it("throws non-retryable ApplicationFailure for 400", async () => {
      mockFetch.mockResolvedValue(new Response("Bad Request", { status: 400 }));

      try {
        await callHttpAction(
          { method: "POST", endpoint: "https://example.com/bad" },
          {},
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("400");
        expect(err.type).toBe("HTTP_CLIENT_ERROR");
      }
    });

    it("throws retryable error for 5xx", async () => {
      mockFetch.mockResolvedValue(new Response("Internal Error", { status: 500 }));

      await expect(
        callHttpAction(
          { method: "GET", endpoint: "https://example.com/error" },
          {},
        ),
      ).rejects.toThrow("500");
    });

    it("throws non-retryable for 3xx redirects", async () => {
      mockFetch.mockResolvedValue(new Response("", { status: 301, headers: { Location: "/new" } }));

      try {
        await callHttpAction(
          { method: "GET", endpoint: "https://example.com/old" },
          {},
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("redirect");
        expect(err.message).toContain("301");
      }
    });

    it("throws retryable error for network failures", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(
        callHttpAction(
          { method: "GET", endpoint: "https://example.com" },
          {},
        ),
      ).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("task timeout (#686)", () => {
    it("times out with non-retryable HTTP_CALL_TIMEOUT when timeout_seconds is breached", async () => {
      mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
        // Hang until the AbortSignal.timeout fires, like a stalled server.
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })),
          );
        });
      });

      await expect(
        callHttpAction(
          { method: "GET", endpoint: { uri: "https://api.example.com/slow" }, timeout_seconds: 1 },
          {},
        ),
      ).rejects.toMatchObject({ type: "HTTP_CALL_TIMEOUT", nonRetryable: true });
    }, 15_000);

    it("passes a timeout signal to fetch only when timeout_seconds is set", async () => {
      mockFetch.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));

      await callHttpAction(
        { method: "GET", endpoint: { uri: "https://api.example.com/a" } },
        {},
      );
      expect(mockFetch.mock.calls[0][1].signal).toBeUndefined();

      await callHttpAction(
        { method: "GET", endpoint: { uri: "https://api.example.com/b" }, timeout_seconds: 30 },
        {},
      );
      expect(mockFetch.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("runtime placeholder resolution", () => {
    it("resolves ${.secrets.KEY} in headers", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));

      await callHttpAction(
        {
          method: "GET",
          endpoint: "https://example.com",
          headers: { Authorization: "Bearer ${.secrets.API_TOKEN}" },
        },
        { API_TOKEN: "my-secret-token" },
      );

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers.Authorization).toBe("Bearer my-secret-token");
    });

    it("resolves ${.secrets.KEY} in endpoint URI", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}));

      await callHttpAction(
        {
          method: "GET",
          endpoint: { uri: "https://${.secrets.HOST}/api" },
        },
        { HOST: "secure.example.com" },
      );

      expect(mockFetch.mock.calls[0][0]).toBe("https://secure.example.com/api");
    });
  });

  describe("edge cases", () => {
    it("handles string endpoint shorthand", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}));

      await callHttpAction(
        { method: "GET", endpoint: "https://example.com/simple" },
        {},
      );

      expect(mockFetch.mock.calls[0][0]).toBe("https://example.com/simple");
    });

    it("sends string body without JSON content-type", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}));

      await callHttpAction(
        {
          method: "POST",
          endpoint: "https://example.com",
          body: "plain text body" as any,
        },
        {},
      );

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].body).toBe("plain text body");
      expect(callArgs[1].headers["Content-Type"]).toBeUndefined();
    });
  });

  describe("factory", () => {
    it("creates activities object with CallHttp method", () => {
      const activities = createCallHttpActivities();
      expect(typeof activities.CallHttp).toBe("function");
    });
  });
});
