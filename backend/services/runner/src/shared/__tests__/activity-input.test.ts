/**
 * Pins the turn activities' input boundary (../activity-input.ts): the
 * typed object's snake_case keys read into the runtime's camelCase input,
 * an empty or absent thread and turn read as a first turn's.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeActivityInput,
  type ExecuteActivityInput,
} from "../activity-input.js";

describe("normalizeActivityInput", () => {
  it("reads the typed object's snake_case wire keys", () => {
    const wire: ExecuteActivityInput = {
      execution_id: "exec-1",
      thread_id: "thread-1",
      invoker_identity_account_id: "acct-1",
      turn_seq: 2,
    };
    expect(normalizeActivityInput(wire)).toEqual({
      executionId: "exec-1",
      threadId: "thread-1",
      turnSeq: 2,
    });
  });

  it("treats an empty thread_id (first run / new harness state) as empty", () => {
    expect(
      normalizeActivityInput({
        execution_id: "exec-4",
        thread_id: "",
        invoker_identity_account_id: "acct-4",
      }),
    ).toEqual({ executionId: "exec-4", threadId: "", turnSeq: 0 });
  });

  it("defaults turn_seq to 0 when the object omits it (first turn)", () => {
    expect(
      normalizeActivityInput({
        execution_id: "exec-7",
        thread_id: "thread-7",
        invoker_identity_account_id: "acct-7",
      }),
    ).toEqual({ executionId: "exec-7", threadId: "thread-7", turnSeq: 0 });
  });

  it("deserializes the exact JSON shape the server emits", () => {
    const fromWire = JSON.parse(
      '{"execution_id":"exec-6","thread_id":"thread-6","invoker_identity_account_id":"acct-6","turn_seq":3}',
    ) as ExecuteActivityInput;
    expect(normalizeActivityInput(fromWire)).toEqual({
      executionId: "exec-6",
      threadId: "thread-6",
      turnSeq: 3,
    });
  });
});
