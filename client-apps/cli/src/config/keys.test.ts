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
      "current_backend",
    ]);
  });

  it("gets the backend type", () => {
    expect(getConfigValue(getDefault(), "backend.type")).toBe("local");
  });

  it("returns empty string for unset nested keys", () => {
    expect(getConfigValue(getDefault(), "backend.cloud.org_id")).toBe("");
  });

  it("sets a nested key, creating the reserved cloud entry", () => {
    const config = getDefault();
    setConfigValue(config, "backend.cloud.org_id", "acme");
    expect(config.backends?.["cloud"]?.org_id).toBe("acme");
    expect(getConfigValue(config, "backend.cloud.org_id")).toBe("acme");
  });

  it("backend.type set to cloud selects the reserved cloud entry", () => {
    const config = getDefault();
    setConfigValue(config, "backend.type", "cloud");
    expect(config.current_backend).toBe("cloud");
    expect(config.backends?.["cloud"]?.type).toBe("cloud");
    expect(getConfigValue(config, "backend.type")).toBe("cloud");
  });

  it("current_backend switches only to known names", () => {
    const config = getDefault();
    expect(() => setConfigValue(config, "current_backend", "nope")).toThrow(
      UsageError,
    );
    setConfigValue(config, "current_backend", "local");
    expect(getConfigValue(config, "current_backend")).toBe("local");
  });

  it("validates backend.type values", () => {
    expect(() => setConfigValue(getDefault(), "backend.type", "bogus")).toThrow(
      UsageError,
    );
  });

  it("rejects unknown keys", () => {
    expect(() => getConfigValue(getDefault(), "nope.nope")).toThrow(UsageError);
    expect(() => setConfigValue(getDefault(), "nope.nope", "x")).toThrow(
      UsageError,
    );
  });
});
