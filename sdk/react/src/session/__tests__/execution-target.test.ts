import { describe, it, expect } from "vitest";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  toProtoExecutionTarget,
  fromProtoExecutionTarget,
  type ExecutionTargetOption,
} from "../execution-target";

describe("toProtoExecutionTarget", () => {
  it("maps local to ExecutionTarget.LOCAL", () => {
    expect(toProtoExecutionTarget("local")).toBe(ExecutionTarget.LOCAL);
  });

  it("maps cloud to ExecutionTarget.CLOUD", () => {
    expect(toProtoExecutionTarget("cloud")).toBe(ExecutionTarget.CLOUD);
  });
});

describe("fromProtoExecutionTarget", () => {
  it("maps ExecutionTarget.LOCAL to local", () => {
    expect(fromProtoExecutionTarget(ExecutionTarget.LOCAL)).toBe("local");
  });

  it("maps ExecutionTarget.CLOUD to cloud", () => {
    expect(fromProtoExecutionTarget(ExecutionTarget.CLOUD)).toBe("cloud");
  });

  it("maps ExecutionTarget.UNSPECIFIED to undefined", () => {
    expect(fromProtoExecutionTarget(ExecutionTarget.UNSPECIFIED)).toBeUndefined();
  });

  it("maps unknown numeric values to undefined (safe default)", () => {
    expect(fromProtoExecutionTarget(999 as ExecutionTarget)).toBeUndefined();
  });
});

describe("round-trip conversion", () => {
  it("local survives toProto -> fromProto", () => {
    expect(fromProtoExecutionTarget(toProtoExecutionTarget("local"))).toBe("local");
  });

  it("cloud survives toProto -> fromProto", () => {
    expect(fromProtoExecutionTarget(toProtoExecutionTarget("cloud"))).toBe("cloud");
  });
});
