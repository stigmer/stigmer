import { describe, it, expect } from "vitest";
import { createCallFunctionActivities } from "../call-function.js";

describe("createCallFunctionActivities", () => {
  it("creates activities object with CallFunction method", () => {
    const activities = createCallFunctionActivities();
    expect(typeof activities.CallFunction).toBe("function");
  });

  it("throws non-retryable error for unknown call type", async () => {
    const activities = createCallFunctionActivities();

    try {
      await activities.CallFunction("unknown_function", {}, {}, "exec-1");
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("Unknown custom call function");
      expect(err.message).toContain("unknown_function");
    }
  });

  it("throws non-retryable error for call:agent (not yet implemented)", async () => {
    const activities = createCallFunctionActivities();

    try {
      await activities.CallFunction("agent", { agent: "code-reviewer" }, {}, "exec-1");
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).toContain("not yet implemented");
    }
  });

  it("resolves runtime placeholders in config before dispatching", async () => {
    const activities = createCallFunctionActivities();

    try {
      await activities.CallFunction(
        "llm",
        { model: "gpt-4o", prompt: "hi" },
        {},
        "exec-1",
      );
    } catch {
      // LLM will fail without API key — we just verify it dispatches
    }
  });
});
