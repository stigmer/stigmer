// Canonical valid Skill artifacts for the conformance suite.
// Domain: conformance support.
//
// Skill is the second versioned domain, but unlike Workflow it has no proto
// spec the client fills in. A skill is *pushed* as a ZIP whose root SKILL.md
// carries YAML frontmatter; the backend extracts the kebab-case `name` (which
// becomes metadata.name, with metadata.slug derived from it — dots become
// hyphens; backend is the single source of truth) and computes the version hash
// as the SHA-256 of the ZIP *bytes*.
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
  // Skill identifier written to the SKILL.md frontmatter `name` field: kebab-case,
  // optionally scoped with dot-separated namespaces. Must match
  // ^[a-z0-9]+([.-][a-z0-9]+)*$ — uniqueName("skill") qualifies. The backend
  // derives metadata.name from this and metadata.slug from it (dots -> hyphens).
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

// Builds a ZIP with *stored streaming entries*: method 0 (stored), general-purpose
// flag bit 3 set, zeroed sizes in the local file header, and a trailing data
// descriptor carrying the real CRC/sizes. This is byte-for-byte the default output
// of Go's standard archive/zip writer (zip.Writer.CreateHeader with Method:
// zip.Store) — the shape a streaming parser cannot read (a stored entry's payload
// length is only known from the descriptor *after* the payload) but every
// central-directory reader can. stigmer#336: the cloud edition's JDK ZipInputStream
// rejected this shape while the Go server accepted it. fflate's zipSync can only
// emit descriptor-free entries, which is exactly why no test caught the divergence;
// this builder exists so the parity stays pinned.
export function zipFilesStreaming(files: Record<string, Uint8Array | string>): Uint8Array {
  const chunks: number[] = [];
  const u16 = (v: number) => chunks.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (v: number) =>
    chunks.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);

  interface Written {
    nameBytes: Uint8Array;
    content: Uint8Array;
    crc: number;
    localHeaderOffset: number;
  }
  const written: Written[] = [];

  for (const [name, raw] of Object.entries(files)) {
    const content = typeof raw === "string" ? strToU8(raw) : raw;
    const nameBytes = strToU8(name);
    const entry: Written = { nameBytes, content, crc: crc32(content), localHeaderOffset: chunks.length };
    written.push(entry);

    // Local file header: flag bit 3 set, CRC/sizes zeroed (deferred to the descriptor).
    u32(0x04034b50);
    u16(20); // version needed to extract
    u16(0x0008); // general-purpose flags: data descriptor follows
    u16(0); // method: stored
    u16(0); // mod time
    u16(0); // mod date
    u32(0); // crc-32 (deferred)
    u32(0); // compressed size (deferred)
    u32(0); // uncompressed size (deferred)
    u16(nameBytes.length);
    u16(0); // extra field length
    chunks.push(...nameBytes);

    chunks.push(...content);

    // Data descriptor with the conventional signature (Go writes it).
    u32(0x08074b50);
    u32(entry.crc);
    u32(content.length); // compressed size (stored = raw)
    u32(content.length); // uncompressed size
  }

  const centralDirOffset = chunks.length;
  for (const entry of written) {
    // Central directory record: the authoritative CRC and sizes.
    u32(0x02014b50);
    u16(20); // version made by
    u16(20); // version needed to extract
    u16(0x0008);
    u16(0); // method: stored
    u16(0); // mod time
    u16(0); // mod date
    u32(entry.crc);
    u32(entry.content.length); // compressed size
    u32(entry.content.length); // uncompressed size
    u16(entry.nameBytes.length);
    u16(0); // extra field length
    u16(0); // comment length
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(entry.localHeaderOffset);
    chunks.push(...entry.nameBytes);
  }
  const centralDirSize = chunks.length - centralDirOffset;

  // End of central directory record.
  u32(0x06054b50);
  u16(0); // this disk number
  u16(0); // disk with central directory
  u16(written.length); // entries on this disk
  u16(written.length); // total entries
  u32(centralDirSize);
  u32(centralDirOffset);
  u16(0); // comment length

  return Uint8Array.from(chunks);
}

// A valid skill artifact in the streaming stored shape above — the Go-SDK-default
// twin of makeSkillArtifact, for edition-parity acceptance tests.
export function makeStreamingSkillArtifact(opts: SkillArtifactOptions): Uint8Array {
  return zipFilesStreaming({ "SKILL.md": skillMd(opts) });
}

// Standard CRC-32 (IEEE 802.3, the ZIP checksum). Implemented inline because
// fflate does not export its internal implementation.
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
