// Unit tests for declarative-mode detection, scanning, and item building —
// the pure, filesystem-driven logic that does not need a backend.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDeclarativeItems, detectTrack, scanResourceFiles, scanSkillDirectories } from "./declarative.js";

function project(dir: string, body: string): void {
  writeFileSync(join(dir, "stigmer.yaml"), body);
}

const DECLARATIVE_PROJECT = ["kind: Project", "metadata:", "  name: Demo", "  slug: demo", "spec:", "  description: d", ""].join(
  "\n",
);

describe("detectTrack", () => {
  it("returns atomic when no stigmer.yaml is found", () => {
    const dir = mkdtempSync(join(tmpdir(), "decl-"));
    try {
      // A deep child with no config anywhere up to the temp root quickly.
      expect(detectTrack(dir, 2).track).toBe("atomic");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects the declarative track (stigmer.yaml without entry_point)", () => {
    const dir = mkdtempSync(join(tmpdir(), "decl-"));
    try {
      project(dir, DECLARATIVE_PROJECT);
      const detect = detectTrack(dir);
      expect(detect.track).toBe("declarative");
      expect(detect.project?.metadata?.slug).toBe("demo");
      expect(detect.configDir).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects the project track when entry_point is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "decl-"));
    try {
      project(dir, ["kind: Project", "metadata:", "  name: P", "  slug: p", "spec:", "  entryPoint: main.ts", ""].join("\n"));
      expect(detectTrack(dir).track).toBe("project");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("walks up to a parent stigmer.yaml", () => {
    const root = mkdtempSync(join(tmpdir(), "decl-"));
    try {
      project(root, DECLARATIVE_PROJECT);
      const child = join(root, "a", "b");
      mkdirSync(child, { recursive: true });
      const detect = detectTrack(child);
      expect(detect.track).toBe("declarative");
      expect(detect.configDir).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an invalid stigmer.yaml rather than falling back to atomic", () => {
    const dir = mkdtempSync(join(tmpdir(), "decl-"));
    try {
      project(dir, ["kind: Project", "spec:", "  bogusField: nope", ""].join("\n"));
      expect(() => detectTrack(dir)).toThrow(/invalid project configuration/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scanResourceFiles", () => {
  it("collects top-level and one-level-deep YAML, excluding stigmer.yaml and skills", () => {
    const dir = mkdtempSync(join(tmpdir(), "decl-"));
    try {
      project(dir, DECLARATIVE_PROJECT);
      writeFileSync(join(dir, "agent.yaml"), "kind: Agent\n");
      mkdirSync(join(dir, "workflows"));
      writeFileSync(join(dir, "workflows", "wf.yaml"), "kind: Workflow\n");
      // a skill dir must be excluded from YAML scanning
      mkdirSync(join(dir, "my-skill"));
      writeFileSync(join(dir, "my-skill", "SKILL.md"), "---\nname: my-skill\n---\n");
      writeFileSync(join(dir, "my-skill", "config.yaml"), "kind: Agent\n");

      const files = scanResourceFiles(dir).map((f) => f.replace(`${dir}/`, ""));
      expect(files).toEqual(["agent.yaml", "workflows/wf.yaml"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scanSkillDirectories", () => {
  it("finds flat and organized skill directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "decl-"));
    try {
      mkdirSync(join(dir, "flat-skill"));
      writeFileSync(join(dir, "flat-skill", "SKILL.md"), "---\nname: flat-skill\n---\n");
      mkdirSync(join(dir, "skills", "nested-skill"), { recursive: true });
      writeFileSync(join(dir, "skills", "nested-skill", "SKILL.md"), "---\nname: nested-skill\n---\n");

      const dirs = scanSkillDirectories(dir).map((d) => d.replace(`${dir}/`, ""));
      expect(dirs).toEqual(["flat-skill", "skills/nested-skill"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildDeclarativeItems", () => {
  it("skips Project, warns-and-skips Organization, and orders the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "decl-"));
    try {
      writeFileSync(join(dir, "agent.yaml"), "kind: Agent\nmetadata:\n  slug: a\n");
      writeFileSync(join(dir, "mcp.yaml"), "kind: McpServer\nmetadata:\n  slug: m\n");
      writeFileSync(join(dir, "org.yaml"), "kind: Organization\nmetadata:\n  slug: o\n");
      writeFileSync(join(dir, "proj.yaml"), "kind: Project\nmetadata:\n  slug: p\n");

      const warnings: string[] = [];
      const items = buildDeclarativeItems(scanResourceFiles(dir), (line) => warnings.push(line));
      expect(items.map((i) => i.handler.displayName)).toEqual(["MCP Server", "Agent"]);
      expect(warnings.some((w) => w.includes("Organization"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
