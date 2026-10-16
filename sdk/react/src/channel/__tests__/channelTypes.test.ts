// The channel type registry an agent's Channels tab lists and adds from.
// Pins the display order (a chat link, then the vendors in provider
// order), the stable cursor targets the docs demos find each add
// affordance by, the delete word per type, and that an unknown type case
// resolves to null rather than a half-known type.

import { describe, it, expect } from "vitest";
import { CHANNEL_TYPES, CHAT_LINK_TYPE, channelTypeOf } from "../channelTypes";
import { channelProviderOf } from "../providers";

describe("channel type registry", () => {
  it("lists a chat link first, then Slack and WhatsApp", () => {
    expect(CHANNEL_TYPES.map((t) => t.id)).toEqual(["web", "slack", "whatsapp"]);
    expect(CHANNEL_TYPES.map((t) => t.label)).toEqual(["Chat link", "Slack", "WhatsApp"]);
  });

  it("gives each type its add label and stable cursor target", () => {
    expect(CHANNEL_TYPES.map((t) => [t.addLabel, t.addCursorTarget])).toEqual([
      ["Create a chat link", "add-chat-link"],
      ["Connect to Slack", "connect-slack"],
      ["Connect to WhatsApp", "connect-whatsapp"],
    ]);
  });

  it("deletes a chat link and disconnects a vendor channel", () => {
    expect(CHANNEL_TYPES.map((t) => t.deleteLabel)).toEqual(["Delete", "Disconnect", "Disconnect"]);
  });

  it("points a vendor type at its provider, and a chat link at none", () => {
    expect(CHAT_LINK_TYPE.provider).toBeNull();
    expect(channelTypeOf("slack")?.provider).toBe(channelProviderOf("slack"));
    expect(channelTypeOf("whatsapp")?.provider).toBe(channelProviderOf("whatsapp"));
  });

  it("resolves a type by its oneof case and answers null for unknown cases", () => {
    expect(channelTypeOf("web")).toBe(CHAT_LINK_TYPE);
    expect(channelTypeOf("telegram")).toBeNull();
    expect(channelTypeOf(undefined)).toBeNull();
  });
});
