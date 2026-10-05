/**
 * Pins the visibility input the MCP TypeScript generator writes on every
 * top-level apply tool: the three levels the server accepts, by enum name,
 * child organizations among them, and never the retired names.
 *
 * The generator runs over the real schemas into a temporary directory, and
 * the case reads what it wrote for Agent.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMCPTSGeneration } from "../mcp-ts.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");

describe("the MCP apply tools' visibility input", () => {
  let root: string;
  let agent: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-mcp-visibility-"));
    runMCPTSGeneration(SCHEMAS, root);
    agent = fs.readFileSync(path.join(root, "agent.ts"), "utf8");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("offers private, org and child_orgs by enum name, and no retired level", () => {
    expect(agent).toContain(
      "Allowed values: visibility_private, visibility_org, visibility_child_orgs.",
    );
    expect(agent).not.toContain("visibility_platform");
    expect(agent).not.toContain("visibility_public");
  });
});
