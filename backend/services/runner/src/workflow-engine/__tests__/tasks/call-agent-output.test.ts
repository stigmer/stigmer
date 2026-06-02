import { describe, it, expect } from "vitest";
import { validateAgentCallOutput } from "../../tasks/call-agent-output.js";
import type { AgentCallResult } from "../../types.js";

describe("validateAgentCallOutput", () => {
  const objectSchema = {
    type: "object",
    required: ["severity", "category"],
    properties: {
      severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
      category: { type: "string" },
      rationale: { type: "string" },
    },
  };

  describe("valid results", () => {
    it("validates structured output against schema", () => {
      const result: AgentCallResult = {
        structured: { severity: "high", category: "security", rationale: "SQL injection" },
      };
      const validation = validateAgentCallOutput(result, objectSchema);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("returns invalid when only final_text is present (no fallback parsing)", () => {
      const result: AgentCallResult = {
        final_text: '{"severity": "low", "category": "style"}',
      };
      const validation = validateAgentCallOutput(result, objectSchema);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain("did not return structured output");
    });
  });

  describe("invalid results", () => {
    it("fails when required fields are missing", () => {
      const result: AgentCallResult = {
        structured: { severity: "high" },
      };
      const validation = validateAgentCallOutput(result, objectSchema);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Missing required field 'category'");
    });

    it("fails when enum value is invalid", () => {
      const result: AgentCallResult = {
        structured: { severity: "extreme", category: "perf" },
      };
      const validation = validateAgentCallOutput(result, objectSchema);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain("must be one of");
    });

    it("fails when type is wrong", () => {
      const result: AgentCallResult = {
        structured: { severity: 42, category: "bugs" },
      };
      const validation = validateAgentCallOutput(result, objectSchema);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain("expected type 'string'");
    });

    it("fails when structured is not an object", () => {
      const result: AgentCallResult = {
        structured: "just a string",
      };
      const validation = validateAgentCallOutput(result, objectSchema);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain("Expected object");
    });

    it("fails when no structured output and final_text is not JSON", () => {
      const result: AgentCallResult = {
        final_text: "This is plain text, not JSON",
      };
      const validation = validateAgentCallOutput(result, objectSchema);
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain("did not return structured output");
    });

    it("fails when both structured and final_text are absent", () => {
      const result: AgentCallResult = {};
      const validation = validateAgentCallOutput(result, objectSchema);
      expect(validation.valid).toBe(false);
    });
  });

  describe("type validation", () => {
    it("validates array type", () => {
      const schema = { type: "array" };
      const result: AgentCallResult = { structured: [1, 2, 3] };
      expect(validateAgentCallOutput(result, schema).valid).toBe(true);
    });

    it("rejects non-array for array schema", () => {
      const schema = { type: "array" };
      const result: AgentCallResult = { structured: "not array" };
      expect(validateAgentCallOutput(result, schema).valid).toBe(false);
    });

    it("validates string type", () => {
      const schema = { type: "string" };
      const result: AgentCallResult = { structured: "hello" };
      expect(validateAgentCallOutput(result, schema).valid).toBe(true);
    });

    it("validates boolean type", () => {
      const schema = { type: "boolean" };
      const result: AgentCallResult = { structured: true };
      expect(validateAgentCallOutput(result, schema).valid).toBe(true);
    });

    it("validates number type", () => {
      const schema = { type: "number" };
      const result: AgentCallResult = { structured: 42 };
      expect(validateAgentCallOutput(result, schema).valid).toBe(true);
    });
  });
});
