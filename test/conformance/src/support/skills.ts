// Canonical valid Skill artifacts for the conformance suite.
// Domain: conformance support.
//
// Skill is the second versioned domain, but unlike Workflow it has no proto
// spec the client fills in. A skill is *pushed* as a ZIP whose root SKILL.md
// carries YAML frontmatter; the backend extracts the kebab-case `name` (which
// becomes both metadata.name and metadata.slug — backend is the single source
// of truth) and computes the version hash as the SHA-256 of the ZIP *bytes*.
//
// That last fact is the lever these builders expose: the version identity is a
// function of the artifact bytes, so changing `body` produces a new version,
// and reusing the exact same bytes produces the same version. The version-history
// tests rely on this — see the suite for the build-once / reuse-bytes idiom.
//
// Negative cases (non-zip bytes, missing SKILL.md, malformed frontmatter) are
// composed inline in the suite from the neutral `zipFiles` primitive below, not
// here: this module represents validity by construction, matching the convention
// established by support/workflows.ts and support/agents.ts.
import { strToU8, zipSync } from "fflate";

export interface SkillArtifactOptions {
  // Kebab-case skill identifier written to the SKILL.md frontmatter `name`
  // field. Must match ^[a-z0-9]+(-[a-z0-9]+)*$ — uniqueName("skill") qualifies.
  // The backend derives both metadata.name and metadata.slug from this.
  name: string;
  // Markdown body after the frontmatter. The body is part of the ZIP bytes, so
  // changing it changes the version hash — the lever for forcing a new version
  // (vary it) or asserting idempotency (keep the bytes identical by reusing the
  // returned buffer).
  body?: string;
  // Optional human-readable description written to the frontmatter.
  description?: string;
}

// Builds a ZIP from an explicit file map. A neutral primitive (not "a valid
// skill"), so the suite can compose malformed artifacts — e.g. a ZIP without a
// SKILL.md, or with bad frontmatter — without re-importing fflate and without
// blurring the valid/invalid boundary this module guards.
export function zipFiles(files: Record<string, Uint8Array | string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = typeof content === "string" ? strToU8(content) : content;
  }
  return zipSync(entries);
}

// Renders a valid SKILL.md: opening `---`, required kebab-case `name`, optional
// `description`, closing `---`, then a non-empty body (the extractor rejects an
// empty body).
function skillMd(opts: SkillArtifactOptions): string {
  const lines = ["---", `name: ${opts.name}`];
  if (opts.description !== undefined) {
    lines.push(`description: ${opts.description}`);
  }
  lines.push("---", opts.body ?? "# Conformance Skill\n\nA skill fixture for the conformance suite.");
  return lines.join("\n");
}

// A complete, valid skill artifact (a ZIP containing only SKILL.md) ready to
// hand to push(). Build it once and reuse the buffer when a test needs two
// pushes to resolve to the same version.
export function makeSkillArtifact(opts: SkillArtifactOptions): Uint8Array {
  return zipFiles({ "SKILL.md": skillMd(opts) });
}
