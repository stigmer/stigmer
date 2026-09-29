import { describe, it, expect } from "vitest";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  toProtoHarness,
  fromProtoHarness,
  isHarnessOption,
  DEFAULT_HARNESS,
  HARNESS_LABELS,
  HARNESS_META,
  HARNESS_OPTIONS,
  type HarnessOption,
} from "../harness";

// The option set is the proto enum's, nothing more (stigmer/stigmer#1143): an
// option the platform cannot run must not type-check, because the SDK would
// start a native session under its name.
// @ts-expect-error "codex" is not a harness the platform runs
const unsupported: HarnessOption = "codex";
void unsupported;

describe("the option set is the proto's harness set", () => {
  it("offers exactly the engines Harness names, in proto order", () => {
    expect(HARNESS_OPTIONS).toEqual(["native", "cursor"]);
  });

  it("maps every option to a distinct engine and back to itself", () => {
    const engines = HARNESS_OPTIONS.map(toProtoHarness);
    expect(new Set(engines).size).toBe(HARNESS_OPTIONS.length);
    expect(engines).not.toContain(Harness.UNSPECIFIED);
    for (const option of HARNESS_OPTIONS) {
      expect(fromProtoHarness(toProtoHarness(option))).toBe(option);
    }
  });

  it("gives every option display metadata and nothing else any", () => {
    expect(Object.keys(HARNESS_META).sort()).toEqual([...HARNESS_OPTIONS].sort());
  });

  it("recognises a stored string only when it names an option", () => {
    expect(isHarnessOption("native")).toBe(true);
    expect(isHarnessOption("cursor")).toBe(true);
    for (const stored of ["codex", "devin", "copilot", "claude_code", "", "NATIVE"]) {
      expect(isHarnessOption(stored)).toBe(false);
    }
  });
});

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
