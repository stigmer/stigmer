// The package API: where the content is, what it contains, how it hashes, and
// what an extracted copy looks like. These are the facts the CLI's on-demand
// acquisition and the bootstrap's idempotency marker rest on
// (client-apps/cli/src/local/seedpack/), so a regression here is a boot that
// re-applies every run or a project the declarative-apply path refuses.
//
// The "applyable project" and "system resources" arms replace
// `seedpack/seedpack_test.go` (TestExtractToDir, TestExtractToDir_ProducesApplyableProject,
// TestContentHash_*); the rest predates the port.

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentDir,
  contentHash,
  extractToDir,
  listContentFiles,
  SEEDPACK_ENTRIES,
} from "../index.js";

describe("contentDir", () => {
  it("resolves a directory containing stigmer.yaml", () => {
    expect(existsSync(join(contentDir(), "stigmer.yaml"))).toBe(true);
  });
});

describe("listContentFiles", () => {
  it("includes the project manifest and known resources, lexically sorted", () => {
    const files = listContentFiles();
    expect(files).toContain("stigmer.yaml");
    expect(files).toContain("organizations/stigmer.yaml");
    expect(
      files.some((f) => f.startsWith("skills/") && f.endsWith("/SKILL.md")),
    ).toBe(true);
    expect(files.some((f) => f.startsWith("agents/"))).toBe(true);
    expect([...files]).toEqual([...files].sort());
  });

  it("only lists files under the canonical entries (no tools/, icons/, or canary/)", () => {
    const files = listContentFiles();
    expect(files.some((f) => f.startsWith("tools/"))).toBe(false);
    expect(files.some((f) => f.startsWith("icons/"))).toBe(false);
    expect(files.some((f) => f.startsWith("canary/"))).toBe(false);
    // The CI canary manifest is a non-resource (no kind); it must never enter the
    // content set, or the declarative-apply bootstrap rejects it as kind-less.
    expect(files.some((f) => f.endsWith("credential-manifest.yaml"))).toBe(
      false,
    );
  });
});

describe("contentHash", () => {
  it("is deterministic and sha256-prefixed", () => {
    expect(contentHash()).toBe(contentHash());
    expect(contentHash()).toMatch(/^sha256:[0-9a-f]{16}$/);
  });
});

describe("extractToDir", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // The seedpack carries hundreds of files (fonts, multi-language references), so
  // a full recursive copy + double hash is I/O-heavy; allow generous headroom.
  it("extracts a clean project of only the canonical entries", () => {
    dir = mkdtempSync(join(tmpdir(), "seedpack-extract-"));
    extractToDir(dir);

    expect(existsSync(join(dir, "stigmer.yaml"))).toBe(true);
    const top = readdirSync(dir).sort();
    for (const entry of top) {
      expect(SEEDPACK_ENTRIES).toContain(
        entry as (typeof SEEDPACK_ENTRIES)[number],
      );
    }
    // An extracted copy hashes identically to the source.
    expect(contentHash(dir)).toBe(contentHash());
  }, 60_000);

  it("produces a project the declarative-apply path accepts, with the system resources the bootstrap depends on", () => {
    dir = mkdtempSync(join(tmpdir(), "seedpack-extract-"));
    extractToDir(dir);

    // The manifest that makes the directory a Stigmer project.
    const manifest = readFileSync(join(dir, "stigmer.yaml"), "utf8");
    expect(manifest).toContain("apiVersion: tenancy.stigmer.ai/v1");
    expect(manifest).toContain("kind: Project");
    expect(manifest).toContain("name: stigmer-seedpack");

    // The resources the platform's own features reach for by name and that
    // still live here: the stigmer MCP server, the sample workflows, the
    // workflow-creator skill. The default agent moved to the plugin catalogue
    // (plugins/assistant), which `stigmer up` installs after this project;
    // the three creator agents and their skills were retired with the
    // `draft` flow. None of those may be here: a copy of the default agent
    // would make the plugin install refuse its slug.
    const systemResources = [
      "organizations/stigmer.yaml",
      "mcp-servers/stigmer.yaml",
      "mcp-servers/github.yaml",
      "skills/workflow-creator/SKILL.md",
      "workflows/content-review-pipeline.yaml",
      "workflows/support-ticket-triage.yaml",
      "workflows/research-and-summarize.yaml",
    ];
    for (const rel of systemResources) {
      const path = join(dir, rel);
      expect(
        existsSync(path),
        `${rel} missing from the extracted project`,
      ).toBe(true);
      expect(statSync(path).size, `${rel} is empty`).toBeGreaterThan(0);
    }

    // Gone from here for good: the default agent (a plugin now) and the
    // retired creator agents with their skills.
    const gone = [
      "agents/assistant.yaml",
      "agents/agent-creator.yaml",
      "agents/skill-creator.yaml",
      "agents/mcp-server-creator.yaml",
      "skills/agent-creator",
      "skills/skill-creator",
      "skills/mcp-server-creator",
    ];
    for (const rel of gone) {
      expect(
        existsSync(join(dir, rel)),
        `${rel} must not be in the seedpack (the default agent is plugins/assistant; the creator agents were retired)`,
      ).toBe(false);
    }
  }, 60_000);
});
