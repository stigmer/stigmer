/**
 * Unit tests for the rollover context bridge (cloud DD-013): the pinned
 * cross-repo metadata key, the read semantics, and the shared framing.
 */

import { describe, it, expect } from "vitest";
import {
  CONTEXT_BRIDGE_METADATA_KEY,
  formatContextBridgeText,
  readContextBridge,
} from "../context-bridge.js";

describe("CONTEXT_BRIDGE_METADATA_KEY", () => {
  it("is pinned verbatim to the cloud broker's constant (mirror guard)", () => {
    // Pinned to ChannelRuntimeConstants.CONTEXT_BRIDGE_METADATA_KEY in
    // stigmer-cloud. Changing either side alone silently disables the
    // bridge (a plain context reset); change BOTH together.
    expect(CONTEXT_BRIDGE_METADATA_KEY).toBe("stigmer.ai/context-bridge");
  });
});

describe("readContextBridge", () => {
  it("reads the digest from the session spec metadata map", () => {
    expect(
      readContextBridge({ [CONTEXT_BRIDGE_METADATA_KEY]: "User: hi\nAssistant: hello" }),
    ).toBe("User: hi\nAssistant: hello");
  });

  it("returns undefined for an absent map", () => {
    expect(readContextBridge(undefined)).toBeUndefined();
  });

  it("returns undefined when the key is absent", () => {
    expect(readContextBridge({ other: "value" })).toBeUndefined();
  });

  it("returns undefined for a blank value — a blank bridge is no bridge", () => {
    expect(readContextBridge({ [CONTEXT_BRIDGE_METADATA_KEY]: "   " })).toBeUndefined();
  });
});

describe("formatContextBridgeText", () => {
  it("frames the digest as already-known background", () => {
    const framed = formatContextBridgeText("Subject: Orders\nUser: hi\nAssistant: hello");

    expect(framed).toContain("previous conversation");
    expect(framed).toContain("Do not repeat it back");
    expect(framed).toContain("Subject: Orders");
    expect(framed.endsWith("Assistant: hello")).toBe(true);
  });
});
