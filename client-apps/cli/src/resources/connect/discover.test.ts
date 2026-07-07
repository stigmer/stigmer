// Local discovery tests over a real stdio MCP subprocess fixture.
//
// Spawns the fixture server (node __fixtures__/stdio-server.mjs), connects via
// the MCP SDK, and asserts the discovered tools + resource templates convert to
// the DiscoveredCapabilities proto and render correctly. Also asserts a crashing
// subprocess surfaces its stderr instead of hanging.

import { create } from "@bufbuild/protobuf";
import { McpServerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { localDiscover } from "./discover.js";
import { PlaceholderResolutionError } from "../mcp/placeholder-resolver.js";

const FIXTURE = fileURLToPath(new URL("./__fixtures__/stdio-server.mjs", import.meta.url));
const CRASH_FIXTURE = fileURLToPath(new URL("./__fixtures__/stdio-crash.mjs", import.meta.url));

function stdioSpec(scriptPath: string) {
  return create(McpServerSpecSchema, {
    serverType: { case: "stdio", value: { command: process.execPath, args: [scriptPath] } },
  });
}

// A spec whose args reference ${ALLOWED_DIR}, declared under spec.env — the shape
// the seedpack filesystem server uses (issue #141).
function stdioSpecWithPlaceholderArg(scriptPath: string) {
  return create(McpServerSpecSchema, {
    serverType: { case: "stdio", value: { command: process.execPath, args: [scriptPath, "${ALLOWED_DIR}"] } },
    env: { ALLOWED_DIR: { isSecret: false, description: "Directory the server may access" } },
  });
}

describe("localDiscover (stdio subprocess)", () => {
  it("discovers tools and resource templates and converts them to proto", async () => {
    const caps = await localDiscover(stdioSpec(FIXTURE), [], 10_000);

    expect(caps.tools.map((t) => t.name)).toEqual(["echo", "noop"]);
    expect(caps.tools[0].description).toContain("token=unset");
    expect(caps.tools[0].inputSchema).toBeDefined();

    expect(caps.resourceTemplates).toHaveLength(1);
    expect(caps.resourceTemplates[0].uriTemplate).toBe("file:///{path}");
    expect(caps.resourceTemplates[0].name).toBe("local-file");
    expect(caps.resourceTemplates[0].mimeType).toBe("text/plain");
  }, 15_000);

  it("propagates --env overrides into the spawned subprocess", async () => {
    const caps = await localDiscover(stdioSpec(FIXTURE), ["FIXTURE_TOKEN=secret-123"], 10_000);
    expect(caps.tools[0].description).toContain("token=secret-123");
  }, 15_000);

  it("surfaces subprocess stderr when the server crashes on startup", async () => {
    await expect(localDiscover(stdioSpec(CRASH_FIXTURE), [], 10_000)).rejects.toThrow(/fixture boom: missing CONFIG/);
  }, 15_000);
});

describe("localDiscover (${VAR} argument expansion — issue #141)", () => {
  const original = process.env;
  afterEach(() => {
    process.env = original;
  });

  it("expands a declared ${VAR} arg from --env into the spawned subprocess", async () => {
    const caps = await localDiscover(stdioSpecWithPlaceholderArg(FIXTURE), ["ALLOWED_DIR=/tmp/allowed"], 10_000);
    // The fixture echoes the argv it actually received; the resolved value must
    // reach the subprocess, never the literal placeholder.
    expect(caps.tools[0].description).toContain('args=["/tmp/allowed"]');
    expect(caps.tools[0].description).not.toContain("${ALLOWED_DIR}");
  }, 15_000);

  it("expands a declared ${VAR} arg from the exported shell environment", async () => {
    process.env = { ...original, ALLOWED_DIR: "/tmp/from-shell" };
    const caps = await localDiscover(stdioSpecWithPlaceholderArg(FIXTURE), [], 10_000);
    expect(caps.tools[0].description).toContain('args=["/tmp/from-shell"]');
  }, 15_000);

  it("rejects with a placeholder error before spawning when the declared var is unset", async () => {
    process.env = { ...original };
    delete process.env.ALLOWED_DIR;
    await expect(localDiscover(stdioSpecWithPlaceholderArg(FIXTURE), [], 10_000)).rejects.toBeInstanceOf(
      PlaceholderResolutionError,
    );
  }, 15_000);
});
