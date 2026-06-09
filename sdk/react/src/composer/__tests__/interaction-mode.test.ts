import { describe, it, expect } from "vitest";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  toProtoInteractionMode,
  fromProtoInteractionMode,
} from "../interaction-mode";

describe("interaction-mode converters", () => {
  describe("toProtoInteractionMode", () => {
    it("maps 'agent' to AGENT", () => {
      expect(toProtoInteractionMode("agent")).toBe(InteractionMode.AGENT);
    });

    it("maps 'plan' to PLAN", () => {
      expect(toProtoInteractionMode("plan")).toBe(InteractionMode.PLAN);
    });
  });

  describe("fromProtoInteractionMode", () => {
    it("maps AGENT to 'agent'", () => {
      expect(fromProtoInteractionMode(InteractionMode.AGENT)).toBe("agent");
    });

    it("maps PLAN to 'plan'", () => {
      expect(fromProtoInteractionMode(InteractionMode.PLAN)).toBe("plan");
    });

    it("maps UNSPECIFIED to undefined (caller picks the default)", () => {
      expect(fromProtoInteractionMode(InteractionMode.UNSPECIFIED)).toBeUndefined();
    });

    it("maps undefined to undefined", () => {
      expect(fromProtoInteractionMode(undefined)).toBeUndefined();
    });
  });

  describe("round-trip", () => {
    it("preserves 'agent' and 'plan' through proto and back", () => {
      for (const mode of ["agent", "plan"] as const) {
        expect(fromProtoInteractionMode(toProtoInteractionMode(mode))).toBe(mode);
      }
    });
  });
});
