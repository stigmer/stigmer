import { describe, expect, it } from "vitest";
import { UsageError } from "../errors/usage-error.js";
import { resolveFormat, supportedFormats } from "./format.js";

describe("resolveFormat — defaults per command class", () => {
  it("defaults reads to table", () => {
    expect(resolveFormat({}, "read")).toBe("table");
  });
  it("defaults mutations to human", () => {
    expect(resolveFormat({}, "mutating")).toBe("human");
  });
  it("defaults streaming to inline", () => {
    expect(resolveFormat({}, "streaming")).toBe("inline");
  });
});

describe("resolveFormat — --json alias resolves per class", () => {
  it("maps --json to json for reads", () => {
    expect(resolveFormat({ json: true }, "read")).toBe("json");
  });
  it("maps --json to json for mutations", () => {
    expect(resolveFormat({ json: true }, "mutating")).toBe("json");
  });
  it("maps --json to ndjson for streaming", () => {
    expect(resolveFormat({ json: true }, "streaming")).toBe("ndjson");
  });
});

describe("resolveFormat — --quiet alias", () => {
  it("maps --quiet to quiet for mutations", () => {
    expect(resolveFormat({ quiet: true }, "mutating")).toBe("quiet");
  });
  it("rejects --json together with --quiet", () => {
    expect(() => resolveFormat({ json: true, quiet: true }, "mutating")).toThrow(UsageError);
  });
});

describe("resolveFormat — explicit -o/--output", () => {
  it("maps universal table -> human for mutations", () => {
    expect(resolveFormat({ output: "table" }, "mutating")).toBe("human");
  });
  it("maps universal table -> inline for streaming", () => {
    expect(resolveFormat({ output: "table" }, "streaming")).toBe("inline");
  });
  it("accepts yaml for reads", () => {
    expect(resolveFormat({ output: "yaml" }, "read")).toBe("yaml");
  });
  it("is case-insensitive", () => {
    expect(resolveFormat({ output: "JSON" }, "read")).toBe("json");
  });
  it("rejects an unknown universal value", () => {
    expect(() => resolveFormat({ output: "xml" }, "read")).toThrow(/invalid --output value/);
  });
  it("rejects yaml for mutations (unsupported by the class)", () => {
    expect(() => resolveFormat({ output: "yaml" }, "mutating")).toThrow(/not supported/);
  });
});

describe("supportedFormats", () => {
  it("lists the universal values each class supports", () => {
    expect(supportedFormats("read")).toEqual(["table", "json", "yaml"]);
    expect(supportedFormats("mutating")).toEqual(["table", "json"]);
    expect(supportedFormats("streaming")).toEqual(["table", "json", "ndjson"]);
  });
});
