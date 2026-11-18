/**
 * Pins that every object the MCP TypeScript generator writes is closed: the
 * top-level apply input and every nested input are `z.strictObject`, so the
 * MCP server advertises `additionalProperties: false` at every level and
 * refuses an argument the tool does not declare, naming it, instead of
 * dropping it without a word.
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

describe("the MCP apply tools' inputs", () => {
  let root: string;
  let agent: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-mcp-closed-"));
    runMCPTSGeneration(SCHEMAS, root);
    agent = fs.readFileSync(path.join(root, "agent.ts"), "utf8");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("closes the top-level input", () => {
    expect(agent).toContain("export const AgentInputSchema = z.strictObject(AgentInputShape);");
  });

  it("closes every nested input and writes no open object", () => {
    expect(agent.match(/z\.strictObject\(\{/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(agent).not.toMatch(/z\.object\(/);
  });
});
