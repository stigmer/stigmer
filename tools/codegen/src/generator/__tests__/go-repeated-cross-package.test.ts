/**
 * Pins that the Go generator imports the package of a repeated message
 * field whose element lives in another proto package: the agent spec's
 * `mcp_server_usages` is `repeated mcpserver.v1.McpServerUsage`, so the
 * generated agent client must import that package or the SDK does not
 * build. The generator runs over the real schemas and the test reads what
 * it wrote.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSDKClientGeneration } from "../sdk-client-go.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");

describe("the Go generator's repeated cross-package message", () => {
  let root: string;
  let go: string;

  beforeAll(() => {
    // Nested output: the generator writes re-export files two levels up.
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-go-repeated-"));
    const output = path.join(root, "internal", "gen");
    runSDKClientGeneration(SCHEMAS, output);
    go = fs.readFileSync(path.join(output, "agent.go"), "utf8");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("imports the element's package and uses it", () => {
    expect(go).toMatch(/mcpserverv1 "[^"]*\/ai\/stigmer\/agentic\/mcpserver\/v1"/);
    expect(go).toContain("mcpserverv1.McpServerUsage");
  });
});
