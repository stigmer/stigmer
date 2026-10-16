// Pins the console's chat link (chat-link-url.ts): the configured public
// origin plus the channel's id, the one identity a hosted chat link carries.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  getAppBaseUrl: () => "https://app.example.com",
}));

import { chatLinkUrlFor } from "../chat-link-url";

describe("chatLinkUrlFor", () => {
  it("builds /chat/<channel id> on the console's public origin", () => {
    expect(chatLinkUrlFor("ash_01j9z3k8f2q4m6n7p8r9s0t1v2")).toBe(
      "https://app.example.com/chat/ash_01j9z3k8f2q4m6n7p8r9s0t1v2",
    );
  });
});
