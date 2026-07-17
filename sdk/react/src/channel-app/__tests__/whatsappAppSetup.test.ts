import { describe, it, expect } from "vitest";
import {
  generateWhatsAppVerifyToken,
  whatsappChannelAppWebhookUrl,
  WHATSAPP_CHANNEL_APP_WEBHOOK_FIELDS,
} from "../whatsappAppSetup";

describe("whatsappChannelAppWebhookUrl", () => {
  it("builds the per-app webhook path — the receiver's attribution key", () => {
    expect(
      whatsappChannelAppWebhookUrl("https://api.stigmer.ai", "chapp_123"),
    ).toBe("https://api.stigmer.ai/webhook/whatsapp/chapp_123");
  });

  it("tolerates trailing slashes on the API origin", () => {
    expect(
      whatsappChannelAppWebhookUrl("https://api.stigmer.ai///", "chapp_123"),
    ).toBe("https://api.stigmer.ai/webhook/whatsapp/chapp_123");
  });
});

describe("generateWhatsAppVerifyToken", () => {
  it("produces 32 bytes of entropy as paste-safe lowercase hex", () => {
    const token = generateWhatsAppVerifyToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats", () => {
    expect(generateWhatsAppVerifyToken()).not.toBe(
      generateWhatsAppVerifyToken(),
    );
  });
});

describe("WHATSAPP_CHANNEL_APP_WEBHOOK_FIELDS", () => {
  it("subscribes to inbound messages only — deliberate field minimalism", () => {
    expect(WHATSAPP_CHANNEL_APP_WEBHOOK_FIELDS).toEqual(["messages"]);
  });
});
