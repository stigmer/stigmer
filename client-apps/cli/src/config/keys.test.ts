import { describe, expect, it } from "vitest";
import { UsageError } from "../errors/usage-error.js";
import { getDefault } from "./config.js";
import { configKeyNames, getConfigValue, setConfigValue } from "./keys.js";

describe("config keys", () => {
  it("lists the known keys sorted", () => {
    expect(configKeyNames()).toEqual([
      "backend.cloud.endpoint",
      "backend.cloud.org_id",
      "backend.type",
      "context.organization",
    ]);
  });

  it("gets the backend type", () => {
    expect(getConfigValue(getDefault(), "backend.type")).toBe("local");
  });

  it("returns empty string for unset nested keys", () => {
    expect(getConfigValue(getDefault(), "backend.cloud.org_id")).toBe("");
  });

  it("sets a nested key, creating sub-objects", () => {
    const config = getDefault();
    setConfigValue(config, "backend.cloud.org_id", "acme");
    expect(config.backend.cloud?.org_id).toBe("acme");
  });

  it("validates backend.type values", () => {
    expect(() => setConfigValue(getDefault(), "backend.type", "bogus")).toThrow(UsageError);
  });

  it("rejects unknown keys", () => {
    expect(() => getConfigValue(getDefault(), "nope.nope")).toThrow(UsageError);
    expect(() => setConfigValue(getDefault(), "nope.nope", "x")).toThrow(UsageError);
  });
});
