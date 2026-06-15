// Reader fixtures: encode protos with toBinary into a tmp dir, then assert the
// reader globs/sorts/decodes them, tolerates a missing dir and a missing
// dependencies.json, and errors when no resources are present.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, toBinary } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { LocalDirSchema, SkillSynthSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/synth_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSynthesisOutput } from "./reader.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "synth-reader-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeAgent(name: string, slug: string, file: string): void {
  const agent = create(AgentSchema, { apiVersion: "agentic.stigmer.ai/v1", kind: "Agent", metadata: { name, slug } });
  writeFileSync(join(dir, file), toBinary(AgentSchema, agent));
}

describe("readSynthesisOutput", () => {
  it("decodes every kind and groups by kind", () => {
    writeAgent("Support", "support", "agent-0.pb");
    writeFileSync(
      join(dir, "workflow-0.pb"),
      toBinary(WorkflowSchema, create(WorkflowSchema, { metadata: { name: "Onboard", slug: "onboard" } })),
    );
    writeFileSync(
      join(dir, "mcpserver-0.pb"),
      toBinary(McpServerSchema, create(McpServerSchema, { metadata: { name: "FS", slug: "fs" } })),
    );
    writeFileSync(
      join(dir, "skill-0.pb"),
      toBinary(
        SkillSynthSchema,
        create(SkillSynthSchema, { source: { case: "local", value: create(LocalDirSchema, { path: "./calc" }) } }),
      ),
    );

    const result = readSynthesisOutput(dir);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].metadata?.slug).toBe("support");
    expect(result.workflows[0].metadata?.slug).toBe("onboard");
    expect(result.mcpServers[0].metadata?.slug).toBe("fs");
    expect(result.skillSynths[0].source.case).toBe("local");
  });

  it("globs and lexically sorts files of the same kind", () => {
    writeAgent("A0", "a0", "agent-0.pb");
    writeAgent("A1", "a1", "agent-1.pb");
    writeAgent("A2", "a2", "agent-2.pb");

    const result = readSynthesisOutput(dir);

    expect(result.agents.map((a) => a.metadata?.slug)).toEqual(["a0", "a1", "a2"]);
  });

  it("tolerates a directory with no dependencies.json", () => {
    writeAgent("Solo", "solo", "agent-0.pb");
    // No dependencies.json written — must not throw.
    expect(() => readSynthesisOutput(dir)).not.toThrow();
  });

  it("ignores unrelated files", () => {
    writeAgent("Solo", "solo", "agent-0.pb");
    writeFileSync(join(dir, "dependencies.json"), "{}");
    writeFileSync(join(dir, "notes.txt"), "hi");
    const result = readSynthesisOutput(dir);
    expect(result.agents).toHaveLength(1);
  });

  it("throws when the output has no resources", () => {
    expect(() => readSynthesisOutput(dir)).toThrow(/no resources found/);
  });

  it("throws when the output directory does not exist", () => {
    expect(() => readSynthesisOutput(join(dir, "missing"))).toThrow(/no resources found/);
  });
});
