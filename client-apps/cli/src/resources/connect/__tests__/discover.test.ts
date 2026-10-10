// Local discovery tests over a real stdio MCP subprocess fixture.
//
// Spawns the fixture server (node __fixtures__/stdio-server.mjs) from a
// plugin's server entry, connects via the MCP SDK, and asserts the tools
// convert to the PluginTool proto a runner's listing answers, the destructive
// mark included. Also asserts a crashing subprocess surfaces its stderr
// instead of hanging, and that a ${VAR} argument resolves from the shell, else
// the plugin's declared default, and is refused unresolved before spawning.

import { create } from "@bufbuild/protobuf";
import { McpServerEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { goRunEnvOverrides, localDiscover } from "../discover.js";
import { PlaceholderResolutionError } from "../../mcp/placeholder-resolver.js";

const FIXTURE = fileURLToPath(new URL("../__fixtures__/stdio-server.mjs", import.meta.url));
const CRASH_FIXTURE = fileURLToPath(new URL("../__fixtures__/stdio-crash.mjs", import.meta.url));

function stdioSpec(scriptPath: string) {
  return create(McpServerEntrySchema, {
    name: "fixture",
    transport: { case: "stdio", value: { command: process.execPath, args: [scriptPath] } },
  });
}

// An entry whose args reference ${ALLOWED_DIR}, a variable it reads: the shape
// a filesystem MCP server declares its root with (issue #141).
function stdioSpecWithPlaceholderArg(scriptPath: string) {
  return create(McpServerEntrySchema, {
    name: "files",
    transport: { case: "stdio", value: { command: process.execPath, args: [scriptPath, "${ALLOWED_DIR}"] } },
    env: ["ALLOWED_DIR"],
  });
}

describe("localDiscover (stdio subprocess)", () => {
  it("lists the tools as PluginTool protos, the destructive mark included", async () => {
    const tools = await localDiscover(stdioSpec(FIXTURE), {}, 10_000);

    expect(tools.map((t) => t.name)).toEqual(["echo", "noop"]);
    expect(tools[0].description).toContain("token=unset");
    expect(tools.map((t) => t.destructive)).toEqual([false, true]);
  }, 15_000);

  it("passes the caller's shell environment to the spawned subprocess", async () => {
    const original = process.env;
    process.env = { ...original, FIXTURE_TOKEN: "secret-123" };
    try {
      const tools = await localDiscover(stdioSpec(FIXTURE), {}, 10_000);
      expect(tools[0].description).toContain("token=secret-123");
    } finally {
      process.env = original;
    }
  }, 15_000);

  it("surfaces subprocess stderr when the server crashes on startup", async () => {
    await expect(localDiscover(stdioSpec(CRASH_FIXTURE), {}, 10_000)).rejects.toThrow(/fixture boom: missing CONFIG/);
  }, 15_000);
});

describe("localDiscover (${VAR} argument expansion — issue #141)", () => {
  const original = process.env;
  afterEach(() => {
    process.env = original;
  });

  it("expands a declared ${VAR} arg from the exported shell environment", async () => {
    process.env = { ...original, ALLOWED_DIR: "/tmp/from-shell" };
    const tools = await localDiscover(stdioSpecWithPlaceholderArg(FIXTURE), {}, 10_000);
    // The fixture echoes the argv it actually received; the resolved value must
    // reach the subprocess, never the literal placeholder.
    expect(tools[0].description).toContain('args=["/tmp/from-shell"]');
    expect(tools[0].description).not.toContain("${ALLOWED_DIR}");
  }, 15_000);

  it("falls back to the plugin's declared default when the shell has none", async () => {
    process.env = { ...original };
    delete process.env.ALLOWED_DIR;
    const tools = await localDiscover(
      stdioSpecWithPlaceholderArg(FIXTURE),
      { ALLOWED_DIR: create(EnvVarDeclarationSchema, { value: "/srv/default" }) },
      10_000,
    );
    expect(tools[0].description).toContain('args=["/srv/default"]');
  }, 15_000);

  it("rejects with a placeholder error before spawning when the declared var is unset", async () => {
    process.env = { ...original };
    delete process.env.ALLOWED_DIR;
    await expect(localDiscover(stdioSpecWithPlaceholderArg(FIXTURE), {}, 10_000)).rejects.toBeInstanceOf(
      PlaceholderResolutionError,
    );
  }, 15_000);
});

describe("goRunEnvOverrides (a freshly tagged `go run` module)", () => {
  it("skips the checksum database for the module's own path", () => {
    expect(goRunEnvOverrides("go", ["run", "github.com/acme/mcp/cmd/server@v1.2.3"])).toEqual({
      GONOSUMDB: "github.com/acme/mcp/*",
      GONOSUMCHECK: "github.com/acme/mcp/*",
    });
  });

  it("overrides nothing for a path too short to name a module, or another command", () => {
    expect(goRunEnvOverrides("go", ["run", "./cmd@latest"])).toEqual({});
    expect(goRunEnvOverrides("npx", ["run", "github.com/acme/mcp@v1"])).toEqual({});
  });
});
