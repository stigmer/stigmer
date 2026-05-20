import { describe, it, expect, beforeEach } from "vitest";
import {
  registerProvider,
  getProvider,
  resetProviders,
  type NotificationProvider,
  type NotificationRequest,
  type NotificationResult,
} from "../provider.js";

class StubProvider implements NotificationProvider {
  channel(): string { return "stub"; }
  async send(req: NotificationRequest): Promise<NotificationResult> {
    return {
      channel: "stub",
      recipients: [...req.recipients],
      delivered: true,
      delivered_at: new Date().toISOString(),
    };
  }
}

describe("NotificationProviderRegistry", () => {
  beforeEach(() => {
    resetProviders();
  });

  it("registers and retrieves a provider by channel name", () => {
    registerProvider(new StubProvider());
    const provider = getProvider("stub");
    expect(provider.channel()).toBe("stub");
  });

  it("throws when requesting an unregistered channel", () => {
    expect(() => getProvider("slack")).toThrow(
      "Notification channel 'slack' is not implemented",
    );
  });

  it("lists available channels in the error message", () => {
    registerProvider(new StubProvider());
    expect(() => getProvider("email")).toThrow("available channels: stub");
  });

  it("shows (none) when no providers are registered", () => {
    expect(() => getProvider("webhook")).toThrow("available channels: (none)");
  });

  it("overwrites a provider for the same channel on re-registration", async () => {
    let callCount = 0;
    const v1: NotificationProvider = {
      channel: () => "stub",
      send: async (req) => {
        callCount = 1;
        return { channel: "stub", recipients: [...req.recipients], delivered: true };
      },
    };
    const v2: NotificationProvider = {
      channel: () => "stub",
      send: async (req) => {
        callCount = 2;
        return { channel: "stub", recipients: [...req.recipients], delivered: true };
      },
    };

    registerProvider(v1);
    registerProvider(v2);

    await getProvider("stub").send({
      channel: "stub",
      recipients: ["http://example.com"],
      subject: "",
      body: "test",
      metadata: {},
    });

    expect(callCount).toBe(2);
  });

  it("resetProviders clears all registrations", () => {
    registerProvider(new StubProvider());
    resetProviders();
    expect(() => getProvider("stub")).toThrow("is not implemented");
  });
});
