import { describe, it, expect } from "vitest";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  toProtoHarness,
  fromProtoHarness,
  DEFAULT_HARNESS,
  HARNESS_LABELS,
  type HarnessOption,
} from "../harness";

describe("harness constants", () => {
  it("defaults to native harness", () => {
    expect(DEFAULT_HARNESS).toBe("native");
  });

  it("provides user-facing labels for both options", () => {
    expect(HARNESS_LABELS.native).toBe("Stigmer");
    expect(HARNESS_LABELS.cursor).toBe("Cursor");
  });

  it("covers every HarnessOption in HARNESS_LABELS", () => {
    const options: HarnessOption[] = ["native", "cursor"];
    for (const opt of options) {
      expect(HARNESS_LABELS[opt]).toBeDefined();
      expect(typeof HARNESS_LABELS[opt]).toBe("string");
    }
  });
});

describe("toProtoHarness", () => {
  it("maps native to Harness.NATIVE", () => {
    expect(toProtoHarness("native")).toBe(Harness.NATIVE);
  });

  it("maps cursor to Harness.CURSOR", () => {
    expect(toProtoHarness("cursor")).toBe(Harness.CURSOR);
  });
});

describe("fromProtoHarness", () => {
  it("maps Harness.NATIVE to native", () => {
    expect(fromProtoHarness(Harness.NATIVE)).toBe("native");
  });

  it("maps Harness.CURSOR to cursor", () => {
    expect(fromProtoHarness(Harness.CURSOR)).toBe("cursor");
  });

  it("maps Harness.UNSPECIFIED to native (safe default)", () => {
    expect(fromProtoHarness(Harness.UNSPECIFIED)).toBe("native");
  });

  it("maps unknown numeric values to native (safe default)", () => {
    expect(fromProtoHarness(999 as Harness)).toBe("native");
  });
});

describe("round-trip conversion", () => {
  it("native survives toProto -> fromProto", () => {
    expect(fromProtoHarness(toProtoHarness("native"))).toBe("native");
  });

  it("cursor survives toProto -> fromProto", () => {
    expect(fromProtoHarness(toProtoHarness("cursor"))).toBe("cursor");
  });
});
