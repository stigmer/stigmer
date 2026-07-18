/**
 * Unit tests for the channel sender identity: the pinned cross-repo
 * metadata keys, the read semantics, and the shared framing.
 */

import { describe, it, expect } from "vitest";
import {
  SENDER_IDENTITY_METADATA_KEY,
  SENDER_KIND_METADATA_KEY,
  formatSenderIdentityText,
  readSenderIdentity,
} from "../sender-identity.js";

describe("sender identity metadata keys", () => {
  it("are pinned verbatim to the cloud broker's constants (mirror guard)", () => {
    // Pinned to ChannelRuntimeConstants.SENDER_IDENTITY_METADATA_KEY /
    // SENDER_KIND_METADATA_KEY in stigmer-cloud. Changing either side alone
    // silently blinds the agent to the sender; change BOTH together.
    expect(SENDER_IDENTITY_METADATA_KEY).toBe("stigmer.ai/channel-sender-identity");
    expect(SENDER_KIND_METADATA_KEY).toBe("stigmer.ai/channel-sender-kind");
  });
});

describe("readSenderIdentity", () => {
  it("reads value + kind from the session spec metadata map", () => {
    expect(
      readSenderIdentity({
        [SENDER_IDENTITY_METADATA_KEY]: "15550001111",
        [SENDER_KIND_METADATA_KEY]: "whatsapp_phone",
      }),
    ).toEqual({ value: "15550001111", kind: "whatsapp_phone" });
  });

  it("returns undefined for an absent map", () => {
    expect(readSenderIdentity(undefined)).toBeUndefined();
  });

  it("returns undefined when either key is absent — identity is value AND kind", () => {
    expect(
      readSenderIdentity({ [SENDER_IDENTITY_METADATA_KEY]: "15550001111" }),
    ).toBeUndefined();
    expect(
      readSenderIdentity({ [SENDER_KIND_METADATA_KEY]: "whatsapp_phone" }),
    ).toBeUndefined();
  });

  it("returns undefined for blank values", () => {
    expect(
      readSenderIdentity({
        [SENDER_IDENTITY_METADATA_KEY]: "   ",
        [SENDER_KIND_METADATA_KEY]: "whatsapp_phone",
      }),
    ).toBeUndefined();
  });
});

describe("formatSenderIdentityText", () => {
  it("phrases a WhatsApp sender by their phone number", () => {
    const framed = formatSenderIdentityText({
      value: "15550001111",
      kind: "whatsapp_phone",
    });

    expect(framed).toContain("WhatsApp phone number");
    expect(framed).toContain("15550001111");
    expect(framed).toContain("verified");
  });

  it("phrases a Slack sender by their user id", () => {
    const framed = formatSenderIdentityText({ value: "U0USER", kind: "slack_user_id" });

    expect(framed).toContain("Slack user id");
    expect(framed).toContain("U0USER");
  });

  it("falls back to a generic phrase for an unknown kind (newer cloud than runner)", () => {
    const framed = formatSenderIdentityText({ value: "someone@example.com", kind: "email" });

    expect(framed).toContain("email identifier");
    expect(framed).toContain("someone@example.com");
  });

  it("tells the model attribution beats in-message identity claims", () => {
    const framed = formatSenderIdentityText({
      value: "15550001111",
      kind: "whatsapp_phone",
    });

    expect(framed).toContain("do not ask the user");
    expect(framed).toContain("claims a different");
  });
});
