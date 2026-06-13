// Unit tests for shared MCP runtime_env construction.

import { create } from "@bufbuild/protobuf";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import { buildRuntimeEnv, mergeProcessEnv, parseEnvOverrides } from "./runtime-env.js";

function serverWithEnv(env: Record<string, { isSecret: boolean }>) {
  return create(McpServerSchema, { metadata: { id: "mcp_1" }, spec: { env } });
}

describe("parseEnvOverrides", () => {
  it("parses KEY=VALUE pairs, preserving '=' in the value", () => {
    expect(parseEnvOverrides(["A=1", "B=x=y"])).toEqual({ A: "1", B: "x=y" });
  });

  it("throws a usage error on an entry without '='", () => {
    expect(() => parseEnvOverrides(["BROKEN"])).toThrow(UsageError);
  });

  it("throws when the key is empty", () => {
    expect(() => parseEnvOverrides(["=value"])).toThrow(UsageError);
  });
});

describe("buildRuntimeEnv", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original, GITHUB_TOKEN: "from-os", PLANTON_API_KEY: "" };
  });
  afterEach(() => {
    process.env = original;
  });

  it("pulls declared keys from the OS environment with their secret flag", () => {
    const env = buildRuntimeEnv(serverWithEnv({ GITHUB_TOKEN: { isSecret: true } }));
    expect(env.GITHUB_TOKEN.value).toBe("from-os");
    expect(env.GITHUB_TOKEN.isSecret).toBe(true);
  });

  it("skips declared keys that are unset or empty in the environment", () => {
    const env = buildRuntimeEnv(serverWithEnv({ PLANTON_API_KEY: { isSecret: true }, MISSING: { isSecret: false } }));
    expect(env.PLANTON_API_KEY).toBeUndefined();
    expect(env.MISSING).toBeUndefined();
  });

  it("lets --env overrides win over the OS environment", () => {
    const env = buildRuntimeEnv(serverWithEnv({ GITHUB_TOKEN: { isSecret: true } }), ["GITHUB_TOKEN=override"]);
    expect(env.GITHUB_TOKEN.value).toBe("override");
    // is_secret is carried from the declaration.
    expect(env.GITHUB_TOKEN.isSecret).toBe(true);
  });

  it("treats an override for an undeclared key as non-secret", () => {
    const env = buildRuntimeEnv(serverWithEnv({}), ["EXTRA=1"]);
    expect(env.EXTRA.value).toBe("1");
    expect(env.EXTRA.isSecret).toBe(false);
  });
});

describe("mergeProcessEnv", () => {
  it("overlays overrides on top of process.env", () => {
    const merged = mergeProcessEnv(["PATH=/custom", "NEW=1"]);
    expect(merged.PATH).toBe("/custom");
    expect(merged.NEW).toBe("1");
  });
});
