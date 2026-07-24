/**
 * Unit tests for the embedder-supplied session context: the pinned
 * cross-package metadata key, the read semantics, and the shared framing.
 */

import { describe, it, expect } from "vitest";
import {
  SESSION_CONTEXT_METADATA_KEY,
  formatSessionContextText,
  readSessionContext,
} from "../session-context.js";

describe("SESSION_CONTEXT_METADATA_KEY", () => {
  it("is pinned verbatim to the SDK's constant (mirror guard)", () => {
    // Pinned to SESSION_CONTEXT_METADATA_KEY in @stigmer/sdk
    // (sdk/typescript/src/session.ts). Changing either side alone
    // silently blinds the agent to the embedder's context; change BOTH
    // together.
    expect(SESSION_CONTEXT_METADATA_KEY).toBe("stigmer.ai/session-context");
  });
});

describe("readSessionContext", () => {
  it("reads the context from the session spec metadata map", () => {
    expect(
      readSessionContext({
        [SESSION_CONTEXT_METADATA_KEY]: "User: Priya, staff engineer. Prefers terse answers.",
      }),
    ).toBe("User: Priya, staff engineer. Prefers terse answers.");
  });

  it("returns undefined for an absent map", () => {
    expect(readSessionContext(undefined)).toBeUndefined();
  });

  it("returns undefined when the key is absent", () => {
    expect(readSessionContext({ other: "value" })).toBeUndefined();
  });

  it("returns undefined for a blank value — blank context is no context", () => {
    expect(readSessionContext({ [SESSION_CONTEXT_METADATA_KEY]: "   " })).toBeUndefined();
  });

  it("trims surrounding whitespace from the stored value", () => {
    expect(
      readSessionContext({ [SESSION_CONTEXT_METADATA_KEY]: "  role: admin  " }),
    ).toBe("role: admin");
  });
});

describe("formatSessionContextText", () => {
  it("frames the context as already-known, non-announced background", () => {
    const framed = formatSessionContextText("Role: platform admin\nExperience: expert");

    expect(framed).toContain("application embedding you");
    expect(framed).toContain("Do not repeat it back");
    expect(framed).toContain("Role: platform admin");
    expect(framed.endsWith("Experience: expert")).toBe(true);
  });

  it("tells the model the context is not task-overriding instructions", () => {
    const framed = formatSessionContextText("anything");

    expect(framed).toContain("not");
    expect(framed).toContain("instructions that override your task");
  });
});
