import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWebFetchTool } from "../web-fetch-tool.js";

// Hostnames are literal public IPs throughout so the URL guard classifies
// them without a DNS lookup — tests stay hermetic even though fetch itself
// is mocked.
const PUBLIC_URL = "http://8.8.8.8/page";

const fetchMock = vi.fn();

function textResponse(
  body: string,
  init: { status?: number; contentType?: string; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "text/plain; charset=utf-8", ...init.headers },
  });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const invoke = (
  input: { url: string; max_length?: number; start_index?: number },
  posture: "strict" | "relaxed" = "strict",
) => createWebFetchTool({ posture }).invoke(input) as Promise<string>;

describe("web_fetch — identity", () => {
  it("is named web_fetch with a url-first schema", () => {
    const t = createWebFetchTool({ posture: "strict" });
    expect(t.name).toBe("web_fetch");
    expect(t.description).toContain("Fetch the contents of a URL");
  });
});

describe("web_fetch — content handling", () => {
  it("converts HTML to Markdown and strips chrome", async () => {
    fetchMock.mockResolvedValueOnce(textResponse(
      `<html><head><title>T</title><script>evil()</script><style>.x{}</style></head>
       <body><nav><a href="/home">Home</a></nav>
       <h1>Docs</h1><p>Hello <a href="https://stigmer.ai">Stigmer</a>.</p>
       <footer>© 2026</footer></body></html>`,
      { contentType: "text/html" },
    ));

    const result = await invoke({ url: PUBLIC_URL });
    expect(result).toContain("# Docs");
    expect(result).toContain("[Stigmer](https://stigmer.ai)");
    expect(result).not.toContain("evil()");
    expect(result).not.toContain(".x{}");
    expect(result).not.toContain("Home");
    expect(result).not.toContain("© 2026");
  });

  it("returns non-HTML text verbatim", async () => {
    const markdown = "# Already markdown\n\nplain content";
    fetchMock.mockResolvedValueOnce(textResponse(markdown, { contentType: "text/markdown" }));
    await expect(invoke({ url: PUBLIC_URL })).resolves.toBe(markdown);
  });

  it("treats a missing content-type as text", async () => {
    const response = new Response("raw", { status: 200 });
    response.headers.delete("content-type");
    fetchMock.mockResolvedValueOnce(response);
    await expect(invoke({ url: PUBLIC_URL })).resolves.toBe("raw");
  });

  it("refuses binary content", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("\x89PNG", { contentType: "image/png" }));
    const result = await invoke({ url: PUBLIC_URL });
    expect(result).toMatch(/^Error: .*non-text content \(image\/png\)/);
  });

  it("reports HTTP error statuses", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("gone", { status: 404 }));
    const result = await invoke({ url: PUBLIC_URL });
    expect(result).toContain("Error:");
    expect(result).toContain("404");
  });

  it("describes an empty body instead of returning nothing", async () => {
    fetchMock.mockResolvedValueOnce(textResponse(""));
    const result = await invoke({ url: PUBLIC_URL });
    expect(result).toContain("empty body");
  });
});

describe("web_fetch — pagination", () => {
  const body = "abcdefghij".repeat(10); // 100 chars

  it("windows content by max_length with a continuation notice", async () => {
    fetchMock.mockResolvedValueOnce(textResponse(body));
    const result = await invoke({ url: PUBLIC_URL, max_length: 40 });
    expect(result.startsWith(body.slice(0, 40))).toBe(true);
    expect(result).toContain("truncated at 40 of 100");
    expect(result).toContain("start_index=40");
  });

  it("continues from start_index without a notice at the end", async () => {
    fetchMock.mockResolvedValueOnce(textResponse(body));
    const result = await invoke({ url: PUBLIC_URL, max_length: 60, start_index: 40 });
    expect(result).toBe(body.slice(40));
  });

  it("rejects a start_index past the end", async () => {
    fetchMock.mockResolvedValueOnce(textResponse(body));
    const result = await invoke({ url: PUBLIC_URL, start_index: 500 });
    expect(result).toContain("Error: start_index 500 is beyond the end");
  });

  it("caps unbounded responses at the byte limit and says so", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("a".repeat(2 * 1024 * 1024 + 100)));
    const result = await invoke({ url: PUBLIC_URL, max_length: 50 });
    expect(result).toContain("exceeded the 2 MB fetch limit");
  });
});

describe("web_fetch — redirects", () => {
  it("follows redirects and resolves relative Location headers", async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse("/moved"))
      .mockResolvedValueOnce(textResponse("landed"));

    const result = await invoke({ url: PUBLIC_URL });
    expect(result).toBe("landed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe("http://8.8.8.8/moved");
  });

  it("re-guards every hop — a redirect into a private address is refused", async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse("http://10.0.0.1/internal"));
    const result = await invoke({ url: PUBLIC_URL });
    expect(result).toMatch(/^Error: .*private/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after too many redirects", async () => {
    fetchMock.mockResolvedValue(redirectResponse("/again"));
    const result = await invoke({ url: PUBLIC_URL });
    expect(result).toContain("too many redirects");
  });

  it("fails on a redirect without a Location header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    const result = await invoke({ url: PUBLIC_URL });
    expect(result).toContain("without a Location header");
  });
});

describe("web_fetch — guard and failure surface", () => {
  it("refuses blocked addresses under the strict posture", async () => {
    const result = await invoke({ url: "http://127.0.0.1:8080/x" });
    expect(result).toMatch(/^Error: .*loopback/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows loopback under the relaxed posture", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("local dev server"));
    const result = await invoke({ url: "http://127.0.0.1:3000/" }, "relaxed");
    expect(result).toBe("local dev server");
  });

  it("refuses non-http schemes", async () => {
    const result = await invoke({ url: "file:///etc/passwd" });
    expect(result).toMatch(/^Error: .*only http and https/);
  });

  it("reports timeouts as a readable error", async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("operation timed out"), { name: "TimeoutError" }),
    );
    const result = await invoke({ url: PUBLIC_URL });
    expect(result).toContain("timed out after 15s");
  });

  it("reports network failures without throwing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    const result = await invoke({ url: PUBLIC_URL });
    expect(result).toContain("Error: Failed to fetch");
    expect(result).toContain("socket hang up");
  });
});
