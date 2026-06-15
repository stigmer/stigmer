import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDeclarativeItems, scanResourceFiles } from "../../resources/apply/declarative.js";
import type { ControllerFn } from "../../resources/apply/handlers.js";
import { applySeedpack, resolveSeedpackOrg, seedpackContentHash } from "./apply.js";
import type { SeedpackContent } from "./content.js";
import { extractSeedpack, readMarker, resolveSeedpackContent } from "./content.js";

const ORG_YAML = [
  "apiVersion: tenancy.stigmer.ai/v1",
  "kind: Organization",
  "metadata:",
  "  name: Stigmer",
  "  slug: stigmer",
  "spec:",
  '  description: "System org"',
  "  management_mode: self_managed",
  "",
].join("\n");

const PROJECT_YAML = [
  "apiVersion: tenancy.stigmer.ai/v1",
  "kind: Project",
  "metadata:",
  "  name: stigmer-seedpack",
  "  org: stigmer",
  "spec:",
  "  description: System seedpack",
  "",
].join("\n");

// A seedpack fixture with just an org + the project manifest — enough to exercise
// both apply phases (organizations via file mode, the project via the declarative
// reconciler) without pulling in skill-push or MCP discovery.
function makeContent(): SeedpackContent {
  const dir = mkdtempSync(join(tmpdir(), "seedpack-apply-"));
  writeFileSync(join(dir, "stigmer.yaml"), PROJECT_YAML);
  mkdirSync(join(dir, "organizations"), { recursive: true });
  writeFileSync(join(dir, "organizations", "stigmer.yaml"), ORG_YAML);
  return { dir, source: "repo" };
}

// Records each applied message's proto type name; every controller resolves to
// the same stub apply (the handlers only call `.apply`).
function recordingDeps() {
  const applied: string[] = [];
  const controller = (() => ({
    apply: async (m: Message) => {
      applied.push((m as { $typeName: string }).$typeName);
      return m;
    },
  })) as unknown as ControllerFn;
  return {
    applied,
    deps: {
      controller,
      stigmer: {} as never,
      info: () => {},
      warn: () => {},
    },
  };
}

let content: SeedpackContent;
let markerDir: string;
beforeEach(() => {
  content = makeContent();
  markerDir = mkdtempSync(join(tmpdir(), "seedpack-marker-"));
});
afterEach(() => {
  rmSync(content.dir, { recursive: true, force: true });
  rmSync(markerDir, { recursive: true, force: true });
});

describe("resolveSeedpackOrg", () => {
  const saved = process.env.STIGMER_SEEDPACK_ORG;
  afterEach(() => {
    if (saved === undefined) delete process.env.STIGMER_SEEDPACK_ORG;
    else process.env.STIGMER_SEEDPACK_ORG = saved;
  });

  it("prefers explicit, then env var, then the default", () => {
    delete process.env.STIGMER_SEEDPACK_ORG;
    expect(resolveSeedpackOrg("acme")).toBe("acme");
    expect(resolveSeedpackOrg()).toBe("stigmer");
    process.env.STIGMER_SEEDPACK_ORG = "from-env";
    expect(resolveSeedpackOrg()).toBe("from-env");
    expect(resolveSeedpackOrg("explicit")).toBe("explicit");
  });
});

describe("applySeedpack", () => {
  it("applies the org and project, then writes the marker", async () => {
    const { applied, deps } = recordingDeps();
    const result = await applySeedpack(deps, { markerDir, content });

    expect(result.applied).toBe(true);
    expect(result.org).toBe("stigmer");
    expect(applied.some((t) => t.endsWith("Organization"))).toBe(true);
    expect(applied.some((t) => t.endsWith("Project"))).toBe(true);
    expect(readMarker(markerDir)).toBe(result.hash);
  });

  it("is idempotent: a matching marker skips the backend entirely", async () => {
    const { applied, deps } = recordingDeps();
    await applySeedpack(deps, { markerDir, content });

    const second = recordingDeps();
    const result = await applySeedpack(second.deps, { markerDir, content });
    expect(result.applied).toBe(false);
    expect(second.applied).toHaveLength(0);
    // The first run did touch the backend.
    expect(applied.length).toBeGreaterThan(0);
  });

  it("re-applies when forced even if the marker matches", async () => {
    const first = recordingDeps();
    await applySeedpack(first.deps, { markerDir, content });

    const forced = recordingDeps();
    const result = await applySeedpack(forced.deps, { markerDir, content, force: true });
    expect(result.applied).toBe(true);
    expect(forced.applied.length).toBeGreaterThan(0);
  });
});

describe("seedpackContentHash", () => {
  it("hashes the provided content", () => {
    expect(seedpackContentHash({ content })).toMatch(/^sha256:[0-9a-f]{16}$/);
  });
});

// Regression guard for the credential-manifest bootstrap blocker: the *real*
// seedpack content must pass cleanly through the declarative scanner. Every
// staged file is a resource (carries a `kind`); any non-resource file (e.g. the
// CI canary manifest) must live outside the content set, never beside the
// McpServer YAMLs where `loadDocuments(strict)` would reject it for missing a
// `kind`. The synthetic fixtures above can't catch this — only real content can.
describe("real seedpack content loads through the declarative scanner", () => {
  it("scans + builds apply items without a missing-kind error", () => {
    const real = resolveSeedpackContent();
    const stage = mkdtempSync(join(tmpdir(), "seedpack-real-"));
    try {
      extractSeedpack(real.dir, stage);

      const files = scanResourceFiles(stage);
      // The scan must reach mcp-servers/ — the directory that historically held
      // the kind-less credential-manifest.yaml.
      expect(files.some((f) => f.includes("mcp-servers"))).toBe(true);

      // The throw site. Before the fix this raises "missing 'kind' field".
      const items = buildDeclarativeItems(files, () => {});
      expect(items.length).toBeGreaterThan(0);

      const kinds = new Set(items.map((i) => (i.document as { kind?: string }).kind));
      expect(kinds).toContain("McpServer");
      expect(kinds).toContain("Agent");
      expect(kinds).toContain("Workflow");
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  });
});
