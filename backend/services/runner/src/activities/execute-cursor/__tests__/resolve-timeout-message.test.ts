/**
 * What a timed-out Cursor agent create or resume says
 * (`execute-cursor/turn-setup.ts` `resolveTimeoutMessage`).
 *
 * Pinned: the message names the runner's route to Cursor (the platform's
 * proxy, or Cursor directly), never the loopback lane the agent host's SDK
 * reaches, and says whether a retry follows.
 */

import { describe, expect, it } from "vitest";

import { resolveTimeoutMessage } from "../turn-setup.js";

describe("a Cursor resolve that timed out", () => {
  it("names the runner's route to Cursor, and whether a retry follows", () => {
    expect(resolveTimeoutMessage({ resuming: false, timeoutSeconds: 90, platformProxied: true })(false)).toBe(
      "Cursor agent create timed out after 90s (via the Stigmer platform's proxy). The transport connection is likely dead. Resetting the transport and retrying automatically.",
    );
    expect(resolveTimeoutMessage({ resuming: true, timeoutSeconds: 90, platformProxied: false })(true)).toBe(
      "Cursor agent resume timed out after 90s (direct Cursor API connection). The transport connection is likely dead. " +
        "An automatic retry on a fresh transport connection also timed out. Retry the message later; if this persists, check proxy and network health.",
    );
  });
});
