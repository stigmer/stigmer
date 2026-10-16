// Pins the console's share link (share-url.ts): the configured public
// origin plus the share's id, the one identity a hosted chat link carries.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({
  getAppBaseUrl: () => "https://app.example.com",
}));

import { shareUrlFor } from "../share-url";

describe("shareUrlFor", () => {
  it("builds /chat/<share id> on the console's public origin", () => {
    expect(shareUrlFor("ash_01j9z3k8f2q4m6n7p8r9s0t1v2")).toBe(
      "https://app.example.com/chat/ash_01j9z3k8f2q4m6n7p8r9s0t1v2",
    );
  });
});
