/**
 * Pins that every object the MCP TypeScript generator writes is closed: the
 * top-level apply input and every nested input are `z.strictObject`, so the
 * MCP server advertises `additionalProperties: false` at every level and
 * refuses an argument the tool does not declare, naming it, instead of
 * dropping it without a word; and every map is written as zod 4's
 * two-argument record, keyed by string.
 *
 * The generator runs over the real schemas into a temporary directory, and
 * the case reads what it wrote for Agent. The real schemas hold no cycle, so
 * one case runs over a copy in which HookGroup holds a HookGroup, to reach
 * the generator's lazy, self-referring branch.
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

  it("keys every map by string, the two-argument record zod 4 takes", () => {
    expect(agent).toContain("labels: z.record(z.string(), z.string())");
    expect(agent).toContain("env: z.record(z.string(), z.lazy(() => EnvVarDeclarationInputSchema))");
    expect(agent).not.toMatch(/z\.record\((?!z\.string\(\), )/);
  });

  it("closes every nested input and writes no open object", () => {
    expect(agent.match(/z\.strictObject\(\{/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(agent).not.toMatch(/z\.object\(/);
  });

  it("closes a type that refers to itself, through its lazy schema", () => {
    const schemas = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-mcp-cyclic-schemas-"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-mcp-cyclic-out-"));
    try {
      fs.cpSync(SCHEMAS, schemas, { recursive: true });
      const groupFile = path.join(schemas, "agentic/agent/types/hookgroup.json");
      const group = JSON.parse(fs.readFileSync(groupFile, "utf8")) as { fields: unknown[] };
      group.fields.push({
        name: "Nested",
        jsonName: "nested",
        protoField: "nested",
        type: { kind: "message", messageType: "HookGroup" },
        description: "A group inside the group, for this test only.",
        required: false,
      });
      fs.writeFileSync(groupFile, JSON.stringify(group));

      runMCPTSGeneration(schemas, out);
      const cyclic = fs.readFileSync(path.join(out, "agent.ts"), "utf8");

      expect(cyclic).toContain("const HookGroupInputSchema: z.ZodType<HookGroupInput> = z.lazy(() => z.strictObject({");
      expect(cyclic).not.toMatch(/z\.object\(/);
    } finally {
      fs.rmSync(schemas, { recursive: true, force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
