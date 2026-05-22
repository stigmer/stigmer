import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notificationAction } from "../notification.js";
import { registerProvider, resetProviders, type NotificationProvider, type NotificationRequest, type NotificationResult } from "../../notification/provider.js";

class MockProvider implements NotificationProvider {
  lastRequest: NotificationRequest | undefined;
  result: NotificationResult;

  constructor(channel: string, delivered = true) {
    this.result = {
      channel,
      recipients: [],
      delivered,
      delivered_at: delivered ? "2026-05-20T12:00:00Z" : undefined,
      error: delivered ? undefined : "mock error",
    };
  }

  channel(): string { return this.result.channel; }

  async send(req: NotificationRequest): Promise<NotificationResult> {
    this.lastRequest = req;
    return { ...this.result, recipients: [...req.recipients] };
  }
}

describe("notificationAction", () => {
  beforeEach(() => {
    resetProviders();
  });

  it("throws when channel is missing", async () => {
    await expect(
      notificationAction({ channel: "", body: "hi", recipients: ["a"] } as any, {}),
    ).rejects.toThrow("'channel' field is required");
  });

  it("throws when body is missing", async () => {
    await expect(
      notificationAction({ channel: "webhook", body: "", recipients: ["a"] } as any, {}),
    ).rejects.toThrow("'body' field is required");
  });

  it("throws when recipients are empty", async () => {
    await expect(
      notificationAction({ channel: "webhook", body: "hi", recipients: [] }, {}),
    ).rejects.toThrow("at least one recipient is required");
  });

  it("throws when channel provider is not registered", async () => {
    await expect(
      notificationAction({ channel: "slack", body: "hi", recipients: ["a"] }, {}),
    ).rejects.toThrow("Notification channel 'slack' is not implemented");
  });

  it("dispatches to the correct provider and returns result", async () => {
    const mock = new MockProvider("test-channel");
    registerProvider(mock);

    const result = await notificationAction({
      channel: "test-channel",
      body: "Hello world",
      subject: "Alert",
      recipients: ["user@example.com"],
      metadata: { priority: "high" },
    }, {});

    expect(result.delivered).toBe(true);
    expect(result.channel).toBe("test-channel");
    expect(mock.lastRequest!.body).toBe("Hello world");
    expect(mock.lastRequest!.subject).toBe("Alert");
    expect(mock.lastRequest!.recipients).toEqual(["user@example.com"]);
    expect(mock.lastRequest!.metadata).toEqual({ priority: "high" });
  });

  it("resolves ${.secrets.*} placeholders in body and subject", async () => {
    const mock = new MockProvider("test");
    registerProvider(mock);

    await notificationAction({
      channel: "test",
      body: "Token: ${.secrets.TOKEN}",
      subject: "From ${.secrets.SENDER}",
      recipients: ["admin"],
      metadata: {},
    }, {
      TOKEN: "abc123",
      SENDER: "system",
    });

    expect(mock.lastRequest!.body).toBe("Token: abc123");
    expect(mock.lastRequest!.subject).toBe("From system");
  });

  it("resolves placeholders in recipients", async () => {
    const mock = new MockProvider("test");
    registerProvider(mock);

    await notificationAction({
      channel: "test",
      body: "hi",
      recipients: ["${.secrets.WEBHOOK_URL}"],
    }, {
      WEBHOOK_URL: "https://hooks.example.com/notify",
    });

    expect(mock.lastRequest!.recipients).toEqual(["https://hooks.example.com/notify"]);
  });

  it("resolves placeholders in metadata values", async () => {
    const mock = new MockProvider("test");
    registerProvider(mock);

    await notificationAction({
      channel: "test",
      body: "hi",
      recipients: ["url"],
      metadata: { thread: "${.secrets.THREAD_ID}" },
    }, {
      THREAD_ID: "ts-12345",
    });

    expect(mock.lastRequest!.metadata).toEqual({ thread: "ts-12345" });
  });

  it("handles missing subject gracefully", async () => {
    const mock = new MockProvider("test");
    registerProvider(mock);

    await notificationAction({
      channel: "test",
      body: "hello",
      recipients: ["x"],
    }, {});

    expect(mock.lastRequest!.subject).toBe("");
  });

  it("handles missing metadata gracefully", async () => {
    const mock = new MockProvider("test");
    registerProvider(mock);

    await notificationAction({
      channel: "test",
      body: "hello",
      recipients: ["x"],
    }, {});

    expect(mock.lastRequest!.metadata).toEqual({});
  });
});
