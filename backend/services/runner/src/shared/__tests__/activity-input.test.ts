import { describe, it, expect } from "vitest";
import {
  normalizeActivityInput,
  type ExecuteActivityInput,
} from "../activity-input.js";

describe("normalizeActivityInput — dual-shape activity boundary", () => {
  it("reads the new typed object (snake_case wire keys from Go/Java)", () => {
    const wire: ExecuteActivityInput = {
      execution_id: "exec-1",
      thread_id: "thread-1",
      invoker_identity_account_id: "acct-1",
    };
    expect(normalizeActivityInput(wire)).toEqual({
      executionId: "exec-1",
      threadId: "thread-1",
    });
  });

  it("reads the legacy positional args (old Go control plane: 2 args)", () => {
    expect(normalizeActivityInput("exec-2", "thread-2")).toEqual({
      executionId: "exec-2",
      threadId: "thread-2",
    });
  });

  it("ignores a legacy 3rd positional arg (old Java sent invokerId as arg2)", () => {
    // The runner only declares (arg0, arg1); a 3rd positional arg is dropped by
    // JS, so the old Java (executionId, threadId, invokerId) call still works.
    expect(normalizeActivityInput("exec-3", "thread-3")).toEqual({
      executionId: "exec-3",
      threadId: "thread-3",
    });
  });

  it("treats an empty thread_id (first run / new harness state) as empty", () => {
    expect(
      normalizeActivityInput({
        execution_id: "exec-4",
        thread_id: "",
        invoker_identity_account_id: "acct-4",
      }),
    ).toEqual({ executionId: "exec-4", threadId: "" });

    expect(normalizeActivityInput("exec-5")).toEqual({
      executionId: "exec-5",
      threadId: "",
    });
  });

  it("deserializes the exact JSON shape the control planes emit", () => {
    // Mirrors the bytes the Go struct / Java record serialize to (snake_case).
    const fromWire = JSON.parse(
      '{"execution_id":"exec-6","thread_id":"thread-6","invoker_identity_account_id":"acct-6"}',
    ) as ExecuteActivityInput;
    expect(normalizeActivityInput(fromWire)).toEqual({
      executionId: "exec-6",
      threadId: "thread-6",
    });
  });
});
