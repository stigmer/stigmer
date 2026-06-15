// Tests for the `@stigmer/sdk/synth` producer: explicit synth writes the
// reader-contract file names in order, each artifact round-trips through
// fromBinary, skills serialize both local and git sources, async builders are
// awaited, and a missing out dir produces actionable guidance.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromBinary } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { SkillSynthSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/synth_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineProject } from "../index";

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "stigmer-synth-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function readProto<T>(schema: Parameters<typeof fromBinary>[0], name: string): T {
  return fromBinary(schema, readFileSync(join(outDir, name))) as T;
}

describe("defineProject().synth()", () => {
  it("writes per-kind, zero-indexed file names in registration order", async () => {
    const project = defineProject((ctx) => {
      ctx.skill.fromDir("./skills/calculator");
      ctx.mcpServer({ name: "fs", org: "acme" });
      ctx.agent({ name: "support-bot", org: "acme", instructions: "help" });
      ctx.agent({ name: "sales-bot", org: "acme", instructions: "sell" });
      ctx.workflow({
        name: "onboard",
        org: "acme",
        document: { namespace: "acme", name: "onboard", version: "1.0.0" },
      });
    });

    const result = await project.synth({ outDir });

    expect(result.outDir).toBe(outDir);
    expect(result.counts).toEqual({ agents: 2, workflows: 1, mcpServers: 1, skills: 1 });
    expect(result.files).toEqual([
      "skill-0.pb",
      "mcpserver-0.pb",
      "agent-0.pb",
      "agent-1.pb",
      "workflow-0.pb",
    ]);
  });

  it("round-trips each kind through fromBinary", async () => {
    const project = defineProject((ctx) => {
      ctx.agent({ name: "support-bot", org: "acme", instructions: "be helpful" });
      ctx.workflow({
        name: "onboard",
        org: "acme",
        document: { namespace: "acme", name: "onboard", version: "2.1.0" },
      });
      ctx.mcpServer({ name: "filesystem", org: "acme" });
    });

    await project.synth({ outDir });

    const agent = readProto<{ metadata?: { name: string; org: string }; spec?: { instructions: string } }>(
      AgentSchema,
      "agent-0.pb",
    );
    expect(agent.metadata?.name).toBe("support-bot");
    expect(agent.metadata?.org).toBe("acme");
    expect(agent.spec?.instructions).toBe("be helpful");

    const workflow = readProto<{ spec?: { document?: { name: string; version: string } } }>(
      WorkflowSchema,
      "workflow-0.pb",
    );
    expect(workflow.spec?.document?.name).toBe("onboard");
    expect(workflow.spec?.document?.version).toBe("2.1.0");

    const mcp = readProto<{ metadata?: { name: string } }>(McpServerSchema, "mcpserver-0.pb");
    expect(mcp.metadata?.name).toBe("filesystem");
  });

  it("serializes skills from a local directory", async () => {
    const project = defineProject((ctx) => {
      ctx.skill.fromDir("./skills/calculator", { tag: "stable" });
    });
    await project.synth({ outDir });

    const synth = readProto<{ source: { case: string; value: { path: string } }; tag: string }>(
      SkillSynthSchema,
      "skill-0.pb",
    );
    expect(synth.source.case).toBe("local");
    expect(synth.source.value.path).toBe("./skills/calculator");
    expect(synth.tag).toBe("stable");
  });

  it("serializes skills from a git repository", async () => {
    const project = defineProject((ctx) => {
      ctx.skill.fromGit({ url: "https://github.com/acme/skills.git", ref: "v1", subdir: "calc" });
    });
    await project.synth({ outDir });

    const synth = readProto<{ source: { case: string; value: { url: string; ref: string; subdir: string } } }>(
      SkillSynthSchema,
      "skill-0.pb",
    );
    expect(synth.source.case).toBe("git");
    expect(synth.source.value.url).toBe("https://github.com/acme/skills.git");
    expect(synth.source.value.ref).toBe("v1");
    expect(synth.source.value.subdir).toBe("calc");
  });

  it("awaits an async builder", async () => {
    const project = defineProject(async (ctx) => {
      await Promise.resolve();
      ctx.agent({ name: "async-bot", org: "acme", instructions: "later" });
    });
    const result = await project.synth({ outDir });
    expect(result.counts.agents).toBe(1);
    expect(readProto<{ metadata?: { name: string } }>(AgentSchema, "agent-0.pb").metadata?.name).toBe("async-bot");
  });

  it("defaults org from the synth({ org }) option when a resource omits it", async () => {
    const project = defineProject((ctx) => {
      ctx.agent({ name: "no-org-bot", org: "", instructions: "x" });
    });
    await project.synth({ outDir, org: "from-option" });
    expect(readProto<{ metadata?: { org: string } }>(AgentSchema, "agent-0.pb").metadata?.org).toBe("from-option");
  });

  it("does not run the builder until synth() is called", async () => {
    let ran = false;
    defineProject(() => {
      ran = true;
    });
    expect(ran).toBe(false);
  });

  it("throws actionable guidance when no out dir is resolvable", async () => {
    const saved = process.env.STIGMER_OUT_DIR;
    delete process.env.STIGMER_OUT_DIR;
    try {
      const project = defineProject((ctx) => ctx.agent({ name: "x", org: "acme", instructions: "x" }));
      await expect(project.synth()).rejects.toThrow(/no synthesis output directory/);
      await expect(project.synth()).rejects.toThrow(/stigmer apply/);
    } finally {
      if (saved !== undefined) process.env.STIGMER_OUT_DIR = saved;
    }
  });

  it("resolves the out dir from STIGMER_OUT_DIR when no option is passed", async () => {
    const saved = process.env.STIGMER_OUT_DIR;
    process.env.STIGMER_OUT_DIR = outDir;
    try {
      const project = defineProject((ctx) => ctx.agent({ name: "env-bot", org: "acme", instructions: "x" }));
      const result = await project.synth();
      expect(result.outDir).toBe(outDir);
    } finally {
      if (saved !== undefined) process.env.STIGMER_OUT_DIR = saved;
      else delete process.env.STIGMER_OUT_DIR;
    }
  });
});
