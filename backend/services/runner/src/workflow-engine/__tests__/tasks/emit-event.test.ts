import { describe, it, expect } from "vitest";
import { emitEventAction, type EmitEventConfig } from "../../../activities/emit-event.js";

describe("emitEventAction", () => {
  it("constructs a CloudEvents 1.0 envelope with required fields", () => {
    const config: EmitEventConfig = {
      event: { type: "workflow.step.completed" },
    };

    const result = emitEventAction(config, "exec-123");

    expect(result.specversion).toBe("1.0");
    expect(result.type).toBe("workflow.step.completed");
    expect(result.source).toBe("/workflows/executions/exec-123");
    expect(result.datacontenttype).toBe("application/json");
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");
    expect(result.time).toBeDefined();
  });

  it("uses custom source when provided", () => {
    const config: EmitEventConfig = {
      event: { type: "user.created", source: "/services/auth" },
    };

    const result = emitEventAction(config, "exec-456");

    expect(result.source).toBe("/services/auth");
  });

  it("includes subject when provided", () => {
    const config: EmitEventConfig = {
      event: { type: "order.shipped", subject: "order-789" },
    };

    const result = emitEventAction(config, "exec-1");

    expect(result.subject).toBe("order-789");
  });

  it("includes data when provided and non-empty", () => {
    const config: EmitEventConfig = {
      event: {
        type: "build.completed",
        data: { build_id: "b-123", status: "success", duration_ms: 4500 },
      },
    };

    const result = emitEventAction(config, "exec-1");

    expect(result.data).toEqual({ build_id: "b-123", status: "success", duration_ms: 4500 });
  });

  it("omits data when empty object", () => {
    const config: EmitEventConfig = {
      event: { type: "ping", data: {} },
    };

    const result = emitEventAction(config, "exec-1");

    expect(result.data).toBeUndefined();
  });

  it("omits subject when not provided", () => {
    const config: EmitEventConfig = {
      event: { type: "test" },
    };

    const result = emitEventAction(config, "exec-1");

    expect("subject" in result).toBe(false);
  });

  it("throws when event field is missing", () => {
    const config = {} as EmitEventConfig;
    expect(() => emitEventAction(config, "exec-1")).toThrow("'event' field is required");
  });

  it("throws when event.type is missing", () => {
    const config = { event: {} } as unknown as EmitEventConfig;
    expect(() => emitEventAction(config, "exec-1")).toThrow("'event.type' field is required");
  });

  it("generates unique IDs for each invocation", () => {
    const config: EmitEventConfig = { event: { type: "test" } };
    const r1 = emitEventAction(config, "e1");
    const r2 = emitEventAction(config, "e1");
    expect(r1.id).not.toBe(r2.id);
  });

  it("time field is a valid ISO 8601 string", () => {
    const config: EmitEventConfig = { event: { type: "test" } };
    const result = emitEventAction(config, "e1");
    const parsed = new Date(result.time as string);
    expect(parsed.toISOString()).toBe(result.time);
  });
});
