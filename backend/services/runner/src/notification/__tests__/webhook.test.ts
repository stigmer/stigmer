import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebhookProvider } from "../webhook.js";
import type { NotificationRequest } from "../provider.js";

function makeRequest(overrides?: Partial<NotificationRequest>): NotificationRequest {
  return {
    channel: "webhook",
    recipients: ["https://hooks.example.com/notify"],
    subject: "Test Subject",
    body: "Test body message",
    metadata: { priority: "high" },
    ...overrides,
  };
}

describe("WebhookProvider", () => {
  const provider = new WebhookProvider();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns channel name 'webhook'", () => {
    expect(provider.channel()).toBe("webhook");
  });

  it("sends JSON POST to each recipient URL on success", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    globalThis.fetch = fetchSpy as any;

    const result = await provider.send(makeRequest({
      recipients: ["https://a.com/hook", "https://b.com/hook"],
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.delivered).toBe(true);
    expect(result.delivered_at).toBeDefined();
    expect(result.channel).toBe("webhook");
    expect(result.recipients).toEqual(["https://a.com/hook", "https://b.com/hook"]);

    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://a.com/hook");
    expect(call[1].method).toBe("POST");
    expect((call[1].headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(call[1].body as string);
    expect(body.subject).toBe("Test Subject");
    expect(body.body).toBe("Test body message");
    expect(body.metadata).toEqual({ priority: "high" });
  });

  it("returns delivered=false with error on HTTP 4xx", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 400 })),
    ) as any;

    const result = await provider.send(makeRequest());

    expect(result.delivered).toBe(false);
    expect(result.error).toContain("returned status 400");
  });

  it("returns delivered=false with error on HTTP 5xx", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 502 })),
    ) as any;

    const result = await provider.send(makeRequest());

    expect(result.delivered).toBe(false);
    expect(result.error).toContain("returned status 502");
  });

  it("returns delivered=false with error on network failure", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    ) as any;

    const result = await provider.send(makeRequest());

    expect(result.delivered).toBe(false);
    expect(result.error).toContain("Webhook delivery to");
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("stops on first failing recipient and reports the error", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    globalThis.fetch = fetchSpy as any;

    const result = await provider.send(makeRequest({
      recipients: ["https://ok.com", "https://fail.com"],
    }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.delivered).toBe(false);
    expect(result.error).toContain("fail.com");
  });

  it("sends correct JSON payload shape", async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = vi.fn((_, opts) => {
      capturedBody = (opts as any).body;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as any;

    await provider.send(makeRequest({
      subject: "Alert",
      body: "Server down",
      metadata: { env: "prod" },
    }));

    const parsed = JSON.parse(capturedBody!);
    expect(parsed).toEqual({
      subject: "Alert",
      body: "Server down",
      metadata: { env: "prod" },
    });
  });
});
