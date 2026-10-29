import { describe, it, expect } from "vitest";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  toProtoHarness,
  fromProtoHarness,
  isHarnessOption,
  isNamedHarness,
  DEFAULT_HARNESS,
  HARNESS_LABELS,
  HARNESS_META,
  HARNESS_OPTIONS,
  type HarnessOption,
} from "../harness";
import { parseModelKey } from "../registry";

// The option set is the proto enum's, nothing more (stigmer/stigmer#1143): an
// option the platform cannot run must not type-check, because the SDK would
// start a Stigmer session under its name.
// @ts-expect-error "codex" is not a harness the platform runs
const unsupported: HarnessOption = "codex";
void unsupported;

describe("the option set is the proto's harness set", () => {
  it("offers every engine the platform runs, in proto order", () => {
    expect(HARNESS_OPTIONS).toEqual(["stigmer", "claude"]);
  });

  it("names every engine Harness names, offered or not", () => {
    expect(fromProtoHarness(Harness.CLAUDE)).toBe("claude");
    expect(toProtoHarness("claude")).toBe(Harness.CLAUDE);
    expect(HARNESS_META.claude.label).toBe("Claude Agent");
    expect(isNamedHarness("claude")).toBe(true);
  });

  it("maps every option to a distinct engine and back to itself", () => {
    const engines = HARNESS_OPTIONS.map(toProtoHarness);
    expect(new Set(engines).size).toBe(HARNESS_OPTIONS.length);
    expect(engines).not.toContain(Harness.UNSPECIFIED);
    for (const option of HARNESS_OPTIONS) {
      expect(fromProtoHarness(toProtoHarness(option))).toBe(option);
    }
  });

  it("gives every named engine display metadata and nothing else any", () => {
    expect(Object.keys(HARNESS_META).sort()).toEqual(["claude", "stigmer"]);
  });

  it("recognises a stored string only when it names an offered engine", () => {
    expect(isHarnessOption("stigmer")).toBe(true);
    expect(isHarnessOption("claude")).toBe(true);
    for (const stored of ["cursor", "codex", "devin", "copilot", "claude_code", "", "NATIVE"]) {
      expect(isHarnessOption(stored)).toBe(false);
    }
    for (const word of ["cursor", "codex", "devin", "copilot", "claude_code", "", "NATIVE"]) {
      expect(isNamedHarness(word)).toBe(false);
    }
  });
});

describe("parseModelKey", () => {
  it("reads a key on every named engine, offered or not", () => {
    expect(parseModelKey("stigmer/claude-sonnet-4-6")).toEqual({ harness: "stigmer", modelId: "claude-sonnet-4-6" });
    expect(parseModelKey("claude/claude-opus-5")).toEqual({ harness: "claude", modelId: "claude-opus-5" });
  });

  it("refuses a key on a word no engine owns, or with no engine", () => {
    expect(parseModelKey("codex/gpt-5")).toBeUndefined();
    expect(parseModelKey("/gpt-5")).toBeUndefined();
  });
});

describe("harness constants", () => {
  it("defaults to Stigmer harness", () => {
    expect(DEFAULT_HARNESS).toBe("stigmer");
  });

  it("provides user-facing labels for both options", () => {
    expect(HARNESS_LABELS.stigmer).toBe("Stigmer");
    expect(HARNESS_LABELS.claude).toBe("Claude Agent");
  });

  // docs/vocabulary.md "Harness": one label and one description per value, the same on every surface.
  it("names each harness with the vocabulary's label and description", () => {
    expect(HARNESS_META).toEqual({
      stigmer: { label: "Stigmer", description: "Stigmer's own harness: runs any catalog model, open source end to end" },
      claude: { label: "Claude Agent", description: "Anthropic's Claude Agent SDK: Claude models on your Anthropic key" },
    });
  });

  it("covers every HarnessOption in HARNESS_LABELS", () => {
    const options: HarnessOption[] = ["stigmer", "claude"];
    for (const opt of options) {
      expect(HARNESS_LABELS[opt]).toBeDefined();
      expect(typeof HARNESS_LABELS[opt]).toBe("string");
    }
  });
});

describe("toProtoHarness", () => {
  it("maps stigmer to Harness.STIGMER", () => {
    expect(toProtoHarness("stigmer")).toBe(Harness.STIGMER);
  });

  it("maps claude to Harness.CLAUDE", () => {
    expect(toProtoHarness("claude")).toBe(Harness.CLAUDE);
  });
});

describe("fromProtoHarness", () => {
  it("maps Harness.STIGMER to Stigmer", () => {
    expect(fromProtoHarness(Harness.STIGMER)).toBe("stigmer");
  });

  it("maps Harness.CLAUDE to claude", () => {
    expect(fromProtoHarness(Harness.CLAUDE)).toBe("claude");
  });

  it("maps Harness.UNSPECIFIED to Stigmer (safe default)", () => {
    expect(fromProtoHarness(Harness.UNSPECIFIED)).toBe("stigmer");
  });

  it("maps unknown numeric values to Stigmer (safe default)", () => {
    expect(fromProtoHarness(999 as Harness)).toBe("stigmer");
  });
});

describe("round-trip conversion", () => {
  it("stigmer survives toProto -> fromProto", () => {
    expect(fromProtoHarness(toProtoHarness("stigmer"))).toBe("stigmer");
  });

  it("claude survives toProto -> fromProto", () => {
    expect(fromProtoHarness(toProtoHarness("claude"))).toBe("claude");
  });
});
