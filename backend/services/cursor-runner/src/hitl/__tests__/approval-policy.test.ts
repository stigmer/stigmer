import { describe, it, expect } from "vitest";
import { requiresApproval } from "../approval-policy.js";

describe("requiresApproval", () => {
  describe("destructive tools require approval", () => {
    it.each(["Shell", "Delete"])("requires approval for %s", (tool) => {
      expect(requiresApproval(tool)).toBe(true);
    });
  });

  describe("read-only tools are auto-approved", () => {
    it.each([
      "Read",
      "Grep",
      "Glob",
      "SemanticSearch",
      "WebSearch",
      "WebFetch",
    ])("auto-approves %s", (tool) => {
      expect(requiresApproval(tool)).toBe(false);
    });
  });

  describe("configurable tools default to allow", () => {
    it.each([
      "Write",
      "StrReplace",
      "EditNotebook",
      "Task",
      "SwitchMode",
      "AskQuestion",
      "GenerateImage",
      "ReadLints",
    ])("auto-approves %s", (tool) => {
      expect(requiresApproval(tool)).toBe(false);
    });
  });

  describe("MCP tools require approval (fail-closed)", () => {
    it("requires approval for MCP tool calls", () => {
      expect(requiresApproval("MCP: my-server/my-tool")).toBe(true);
    });

    it("requires approval for any MCP-prefixed tool", () => {
      expect(requiresApproval("MCP: database/query")).toBe(true);
    });
  });

  describe("unknown tools require approval (fail-closed)", () => {
    it("requires approval for completely unknown tools", () => {
      expect(requiresApproval("SomeNewTool")).toBe(true);
    });

    it("requires approval for empty string", () => {
      expect(requiresApproval("")).toBe(true);
    });
  });

  describe("autoApproveAll override", () => {
    it("overrides destructive tools when enabled", () => {
      expect(
        requiresApproval("Shell", { autoApproveAll: true }),
      ).toBe(false);
    });

    it("overrides MCP tools when enabled", () => {
      expect(
        requiresApproval("MCP: server/tool", { autoApproveAll: true }),
      ).toBe(false);
    });

    it("overrides unknown tools when enabled", () => {
      expect(
        requiresApproval("UnknownTool", { autoApproveAll: true }),
      ).toBe(false);
    });

    it("does not change behavior when set to false", () => {
      expect(
        requiresApproval("Shell", { autoApproveAll: false }),
      ).toBe(true);
      expect(
        requiresApproval("Read", { autoApproveAll: false }),
      ).toBe(false);
    });
  });
});
