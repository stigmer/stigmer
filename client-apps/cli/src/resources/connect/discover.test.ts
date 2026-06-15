// Local discovery tests over a real stdio MCP subprocess fixture.
//
// Spawns the fixture server (node __fixtures__/stdio-server.mjs), connects via
// the MCP SDK, and asserts the discovered tools + resource templates convert to
// the DiscoveredCapabilities proto and render correctly. Also asserts a crashing
// subprocess surfaces its stderr instead of hanging.

import { create } from "@bufbuild/protobuf";
import { McpServerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localDiscover } from "./discover.js";

const FIXTURE = fileURLToPath(new URL("./__fixtures__/stdio-server.mjs", import.meta.url));
const CRASH_FIXTURE = fileURLToPath(new URL("./__fixtures__/stdio-crash.mjs", import.meta.url));

function stdioSpec(scriptPath: string) {
  return create(McpServerSpecSchema, {
    serverType: { case: "stdio", value: { command: process.execPath, args: [scriptPath] } },
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
