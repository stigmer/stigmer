/**
 * The docs inventory: joins the classification record
 * (docs/_inventory/classification.yaml) against the docs tree and computes
 * the invariants that `make check-docs-inventory` enforces in CI.
 *
 * The classification is the docs revamp's source of truth for three
 * per-page decisions — fate (does the page survive), diataxis (what kind
 * of page it is), and medium (its demonstration centerpiece; see DD-01 in
 * the stigmer-cloud 20260727.01.docs-revamp project). Generated pages are
 * covered by directory-prefix cohort rules instead of per-page entries,
 * because their classification belongs to the generator, not the page.
 *
 * Three invariants keep the record honest while the revamp runs:
 *
 *   1. Completeness — every hand-authored page ON DISK has an entry, and
 *      every generated page is covered by a cohort. The universe is a disk
 *      walk, not the nav walk: a page dropped from meta.json while still
 *      on disk is exactly the junk the inventory exists to catch.
 *   2. Existence — every entry resolves to a page on disk. Executing a
 *      fate (delete/move/merge) must remove or re-key the entry in the
 *      same commit; git history is the decision record.
 *   3. Embed agreement — the embeds a page actually renders (ScenarEmbed
 *      ids and legacy <Demo*> components) match the entry's per-embed
 *      fate map, in both directions.
 *
 * Layering mirrors llms-pages.ts: this module is pure logic with unit
 * tests; scripts/generate-docs-inventory/index.ts is the thin CLI wrapper.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import matter from "gray-matter";
import { load as loadYaml, YAMLException } from "js-yaml";
import { cleanContent, collectDocsPages } from "./llms-pages";

// ---------------------------------------------------------------------------
// Classification schema
// ---------------------------------------------------------------------------

export const DIATAXIS_TYPES = [
  "tutorial",
  "how-to",
  "explanation",
  "reference",
  // Hub/landing pages (section overviews, hero landings) are none of the
  // four Diátaxis types; forcing them into one would make the record lie.
  "landing",
] as const;
export type Diataxis = (typeof DIATAXIS_TYPES)[number];

export const MEDIUMS = [
  // Prose and code are the substrate of every page, not a medium. `medium`
  // names the page's demonstration centerpiece, if it has one (DD-01).
  "none",
  "diagram",
  "still",
  "screenshot-journey",
  "animated-tour",
  "interactive",
] as const;
export type Medium = (typeof MEDIUMS)[number];

export const EMBED_FATES = ["keep", "replace", "drop"] as const;
export type EmbedFate = (typeof EMBED_FATES)[number];

/** Standalone fates; `move:<path>` and `merge:<path>` carry a target. */
export const SIMPLE_FATES = ["keep", "split", "archive", "delete"] as const;

export interface PageClassification {
  /** keep | split | archive | delete | move:<path> | merge:<path> */
  fate: string;
  diataxis: Diataxis;
  /** One sentence: what the reader walks away knowing or having done. */
  teaches: string;
  medium: Medium;
  /**
   * Rationale for the decisions that need one: a non-"none" medium (why
   * that centerpiece), a non-"keep" fate (why the page doesn't survive
   * as-is), or both in one sentence each when both apply. Destructive
   * plans with no reason on the record are exactly what the gate exists
   * to prevent.
   */
  why?: string;
  /**
   * Per-embed fate map, keyed by ScenarEmbed id (e.g. "quickstart-tour")
   * or legacy component name (e.g. "DemoToolCallsPlayback"). Scalar was
   * rejected on purpose: pages carry up to three embeds, and one page
   * carries an embed from each system.
   */
  embeds?: Record<string, EmbedFate>;
}

export interface CohortRule {
  /** The Makefile target that owns these pages (e.g. "gen-cli-docs"). */
  generator: string;
  diataxis: Diataxis;
  medium: Medium;
}

export interface DocsClassification {
  /** Keyed by extension-less docs-relative path; the docs root is "index". */
  pages: Record<string, PageClassification>;
  /** Keyed by directory prefix ending in "/" (e.g. "sdk/react/"). */
  cohorts: Record<string, CohortRule>;
}

// ---------------------------------------------------------------------------
// Parsing + schema validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidFate(fate: string): boolean {
  if ((SIMPLE_FATES as readonly string[]).includes(fate)) return true;
  return /^(move|merge):\S+$/.test(fate);
}

/**
 * Parses and schema-validates the classification YAML. Collects every
 * problem instead of throwing on the first, so one gate run reports the
 * full repair list.
 */
export function parseClassification(raw: string): {
  classification: DocsClassification | null;
  errors: string[];
} {
  const errors: string[] = [];

  let doc: unknown;
  try {
    doc = loadYaml(raw);
  } catch (err) {
    const detail = err instanceof YAMLException ? err.message : String(err);
    return { classification: null, errors: [`not parseable as YAML: ${detail}`] };
  }
  if (!isRecord(doc)) {
    return { classification: null, errors: ["top level must be a mapping"] };
  }

  const pages: Record<string, PageClassification> = {};
  const rawPages = doc.pages;
  if (!isRecord(rawPages)) {
    errors.push('missing or non-mapping "pages" section');
  } else {
    for (const [key, value] of Object.entries(rawPages)) {
      const where = `pages["${key}"]`;
      if (!isRecord(value)) {
        errors.push(`${where}: must be a mapping`);
        continue;
      }
      const { fate, diataxis, teaches, medium, why, embeds } = value;
      if (typeof fate !== "string" || !isValidFate(fate)) {
        errors.push(
          `${where}: fate must be one of ${SIMPLE_FATES.join(" | ")} | move:<path> | merge:<path>`,
        );
      }
      if (!(DIATAXIS_TYPES as readonly unknown[]).includes(diataxis)) {
        errors.push(`${where}: diataxis must be one of ${DIATAXIS_TYPES.join(" | ")}`);
      }
      if (typeof teaches !== "string" || teaches.trim() === "") {
        errors.push(`${where}: teaches must be a non-empty sentence`);
      }
      if (!(MEDIUMS as readonly unknown[]).includes(medium)) {
        errors.push(`${where}: medium must be one of ${MEDIUMS.join(" | ")}`);
      }
      // `why` is demanded by two independent decisions, each considered
      // only when its field is itself valid (an invalid fate or medium
      // already has its own error above — no cascading noise). Keying the
      // fate trigger on medium (the pre-2026-08 shape) let a destructive
      // plan rest with no reason on the record (oss#315).
      const mediumNeedsWhy =
        (MEDIUMS as readonly unknown[]).includes(medium) && medium !== "none";
      const fateNeedsWhy = typeof fate === "string" && isValidFate(fate) && fate !== "keep";
      if ((mediumNeedsWhy || fateNeedsWhy) && (typeof why !== "string" || why.trim() === "")) {
        errors.push(
          `${where}: a non-"none" medium and a non-"keep" fate each require a "why" rationale`,
        );
      }
      if (embeds !== undefined) {
        if (!isRecord(embeds)) {
          errors.push(`${where}: embeds must be a mapping of embed id to fate`);
        } else {
          for (const [embedId, embedFate] of Object.entries(embeds)) {
            if (!(EMBED_FATES as readonly unknown[]).includes(embedFate)) {
              errors.push(
                `${where}: embeds["${embedId}"] must be one of ${EMBED_FATES.join(" | ")}`,
              );
            }
          }
        }
      }
      pages[key] = value as unknown as PageClassification;
    }
  }

  const cohorts: Record<string, CohortRule> = {};
  const rawCohorts = doc.cohorts;
  if (!isRecord(rawCohorts)) {
    errors.push('missing or non-mapping "cohorts" section');
  } else {
    for (const [prefix, value] of Object.entries(rawCohorts)) {
      const where = `cohorts["${prefix}"]`;
      if (!prefix.endsWith("/")) {
        errors.push(`${where}: cohort prefixes must end with "/"`);
      }
      if (!isRecord(value)) {
        errors.push(`${where}: must be a mapping`);
        continue;
      }
      if (typeof value.generator !== "string" || value.generator.trim() === "") {
        errors.push(`${where}: generator must name the owning make target`);
      }
      if (!(DIATAXIS_TYPES as readonly unknown[]).includes(value.diataxis)) {
        errors.push(`${where}: diataxis must be one of ${DIATAXIS_TYPES.join(" | ")}`);
      }
      if (!(MEDIUMS as readonly unknown[]).includes(value.medium)) {
        errors.push(`${where}: medium must be one of ${MEDIUMS.join(" | ")}`);
      }
      cohorts[prefix] = value as unknown as CohortRule;
    }
  }

  if (errors.length > 0) return { classification: null, errors };
  return { classification: { pages, cohorts }, errors };
}

// ---------------------------------------------------------------------------
// Page facts read from the tree
// ---------------------------------------------------------------------------

/**
 * Matches the marker comment every docs generator writes near the top of
 * its output ("Auto-generated by …" / "Autogenerated by …"). The marker
 * lives in an MDX comment, which cleanContent strips — so detection must
 * run on the RAW file text.
 */
const GENERATED_MARKER = /\{\/\*[^*]*auto-?generated by/i;

export function isGeneratedContent(raw: string): boolean {
  return GENERATED_MARKER.test(raw);
}

/**
 * Extracts the embeds a page renders: ScenarEmbed ids plus legacy
 * <Demo*> component names, one key space (the two never collide — tour
 * ids are kebab-case, legacy components are PascalCase "Demo" names).
 * Callers pass comment-stripped content (cleanContent) so a commented-out
 * embed does not count.
 */
export function extractEmbeds(content: string): string[] {
  const embeds: string[] = [];
  // [^>]* deliberately spans newlines — multi-line ScenarEmbed tags exist.
  const scenarPattern = /<ScenarEmbed\b[^>]*\bid=["']([^"']+)["']/g;
  for (const match of content.matchAll(scenarPattern)) embeds.push(match[1]);
  const legacyPattern = /<(Demo[A-Z][A-Za-z0-9]*)\b/g;
  for (const match of content.matchAll(legacyPattern)) embeds.push(match[1]);
  return [...new Set(embeds)];
}

export interface InventoryPage {
  /** Extension-less docs-relative path; "index" for the docs root. */
  key: string;
  title: string;
  generated: boolean;
  /** Cohort prefix covering this page, when generated. */
  cohort?: string;
  /** Embeds the page actually renders. */
  embeds: string[];
  /** Sidebar section title from the nav walk; undefined if not in nav. */
  section?: string;
  classification?: PageClassification;
}

export interface Violation {
  kind:
    | "schema"
    | "unclassified-page"
    | "generated-page-classified"
    | "uncovered-generated-page"
    | "unknown-page"
    | "embed-drift";
  /** Classification key (or file path for schema problems). */
  key: string;
  message: string;
}

export interface Inventory {
  pages: InventoryPage[];
  cohorts: Record<string, CohortRule>;
  violations: Violation[];
}

/**
 * Walks every .mdx under docsDir (skipping _archive, mirroring the
 * Fumadocs content collection) and returns classification keys in sorted
 * order. This walk — not the nav walk — is the completeness universe.
 */
async function walkDocsKeys(docsDir: string): Promise<string[]> {
  const keys: string[] = [];
  async function walk(dirRelative: string): Promise<void> {
    const dirents = await fs.readdir(path.join(docsDir, dirRelative), {
      withFileTypes: true,
    });
    for (const dirent of dirents) {
      const rel = dirRelative ? `${dirRelative}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (rel === "_archive") continue;
        await walk(rel);
      } else if (dirent.name.endsWith(".mdx")) {
        const stripped = rel.replace(/\.mdx$/, "").replace(/(^|\/)index$/, "");
        keys.push(stripped === "" ? "index" : stripped);
      }
    }
  }
  await walk("");
  return keys.sort();
}

/** Resolves a classification key back to its .mdx file, or null. */
async function resolveKey(docsDir: string, key: string): Promise<string | null> {
  const candidates =
    key === "index"
      ? ["index.mdx"]
      : [`${key}.mdx`, path.join(key, "index.mdx")];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(docsDir, candidate));
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The inventory build + invariants
// ---------------------------------------------------------------------------

/**
 * Builds the joined inventory and computes every invariant violation.
 * Never throws on content problems — violations are data, so the CLI can
 * print the complete repair list in one run.
 */
export async function buildInventory(
  docsDir: string,
  classificationRaw: string,
): Promise<Inventory> {
  const violations: Violation[] = [];

  const { classification, errors } = parseClassification(classificationRaw);
  for (const error of errors) {
    violations.push({ kind: "schema", key: "classification.yaml", message: error });
  }
  const pagesRecord = classification?.pages ?? {};
  const cohorts = classification?.cohorts ?? {};

  // Nav metadata is a decoration on the disk universe, never the universe
  // itself. The nav walk needs a URL base but the inventory ignores URLs.
  const navPages = await collectDocsPages(docsDir, "https://stigmer.ai");
  const sectionByKey = new Map<string, string>();
  for (const page of navPages) {
    const key = page.relativePath === "" ? "index" : page.relativePath;
    if (page.topSectionTitle) sectionByKey.set(key, page.topSectionTitle);
  }

  const cohortPrefixes = Object.keys(cohorts);
  const pages: InventoryPage[] = [];

  for (const key of await walkDocsKeys(docsDir)) {
    const mdxRel = await resolveKey(docsDir, key);
    // walkDocsKeys only emits keys it found on disk, so this cannot miss.
    const raw = await fs.readFile(path.join(docsDir, mdxRel as string), "utf-8");
    const { data, content } = matter(raw);
    const generated = isGeneratedContent(raw);
    // A cohort prefix "x/" covers "x/..." AND the folder's own index page,
    // whose key strips to exactly "x" — generated folder indexes belong to
    // their generator too.
    const cohort = cohortPrefixes.find(
      (prefix) => key.startsWith(prefix) || `${key}/` === prefix,
    );
    const embeds = extractEmbeds(cleanContent(content));
    const entry = pagesRecord[key];

    pages.push({
      key,
      title: typeof data.title === "string" ? data.title : path.basename(key),
      generated,
      cohort: generated ? cohort : undefined,
      embeds,
      section: sectionByKey.get(key),
      classification: entry,
    });

    // Invariant 1 — completeness. Generated-ness decides which side of the
    // record owns the page: markers → cohorts, everything else → entries.
    if (generated) {
      if (entry) {
        violations.push({
          kind: "generated-page-classified",
          key,
          message:
            "generated page has a per-page entry — its classification belongs " +
            "to the generator; cover it with a cohort rule instead",
        });
      }
      if (!cohort) {
        violations.push({
          kind: "uncovered-generated-page",
          key,
          message: "generated page is covered by no cohort rule",
        });
      }
    } else if (!entry) {
      violations.push({
        kind: "unclassified-page",
        key,
        message:
          "hand-authored page has no classification entry — add it to " +
          "docs/_inventory/classification.yaml (fate, diataxis, teaches, medium)",
      });
    }

    // Invariant 3 — embed agreement, both directions.
    if (entry) {
      const declared = Object.keys(entry.embeds ?? {});
      const actual = new Set(embeds);
      for (const id of embeds) {
        if (!declared.includes(id)) {
          violations.push({
            kind: "embed-drift",
            key,
            message: `page renders embed "${id}" but the entry does not declare it`,
          });
        }
      }
      for (const id of declared) {
        if (!actual.has(id)) {
          violations.push({
            kind: "embed-drift",
            key,
            message: `entry declares embed "${id}" but the page does not render it`,
          });
        }
      }
    }
  }

  // Invariant 2 — existence. Executing a fate must remove or re-key the
  // entry in the same commit, so a dangling key is always a mistake.
  const knownKeys = new Set(pages.map((page) => page.key));
  for (const key of Object.keys(pagesRecord)) {
    if (!knownKeys.has(key)) {
      violations.push({
        kind: "unknown-page",
        key,
        message:
          "entry points at no page on disk — if the page was deleted or " +
          "moved, update the entry in the same commit",
      });
    }
  }

  return { pages, cohorts, violations };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function count<T>(items: T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function formatCounts(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `${key} ${n}`)
    .join(" · ");
}

/**
 * Renders the human-readable view of the inventory. Deterministic given
 * the inventory (no timestamps) — the CLI prepends provenance. This view
 * is generated on demand and never committed to the docs tree; reviewed
 * snapshots live in the project docs with the regeneration command.
 */
export function renderReport(inventory: Inventory): string {
  const lines: string[] = ["# Docs inventory", ""];

  const handAuthored = inventory.pages.filter((page) => !page.generated);
  const generated = inventory.pages.filter((page) => page.generated);
  lines.push(
    `${inventory.pages.length} pages: ${handAuthored.length} hand-authored, ` +
      `${generated.length} generated (${Object.keys(inventory.cohorts).length} cohorts).`,
    "",
  );

  if (inventory.violations.length > 0) {
    lines.push(`## Violations (${inventory.violations.length})`, "");
    for (const violation of inventory.violations) {
      lines.push(`- \`${violation.key}\` [${violation.kind}]: ${violation.message}`);
    }
    lines.push("");
  }

  const classified = handAuthored.filter((page) => page.classification);
  if (classified.length > 0) {
    lines.push("## Summary (hand-authored)", "");
    const byClass = (
      keyOf: (classification: PageClassification) => string,
    ): string =>
      formatCounts(
        count(classified, (page) => keyOf(page.classification as PageClassification)),
      );
    lines.push(`- **diataxis**: ${byClass((c) => c.diataxis)}`);
    lines.push(`- **medium**: ${byClass((c) => c.medium)}`);
    lines.push(`- **fate**: ${byClass((c) => c.fate.split(":")[0])}`);
    const embedFates = classified.flatMap((page) =>
      Object.entries(page.classification?.embeds ?? {}),
    );
    if (embedFates.length > 0) {
      lines.push(
        `- **embed fates** (${embedFates.length} embeds): ` +
          formatCounts(count(embedFates, ([, fate]) => fate)),
      );
    }
    lines.push("");
  }

  lines.push("## Generated cohorts", "");
  for (const [prefix, rule] of Object.entries(inventory.cohorts)) {
    const covered = generated.filter((page) => page.cohort === prefix).length;
    lines.push(
      `- \`${prefix}\` — ${covered} pages, \`${rule.generator}\`, ` +
        `${rule.diataxis}, medium ${rule.medium}`,
    );
  }
  lines.push("");

  // Group hand-authored pages by sidebar section, nav order preserved by
  // the section-first-seen ordering of the underlying disk walk join.
  const sections = new Map<string, InventoryPage[]>();
  for (const page of handAuthored) {
    const section = page.section ?? "(not in nav)";
    const bucket = sections.get(section) ?? [];
    bucket.push(page);
    sections.set(section, bucket);
  }

  lines.push("## Pages (hand-authored)", "");
  for (const [section, sectionPages] of sections) {
    lines.push(`### ${section}`, "");
    for (const page of sectionPages) {
      const c = page.classification;
      if (!c) {
        lines.push(`- \`${page.key}\` — **UNCLASSIFIED**`);
        continue;
      }
      const embeds = Object.entries(c.embeds ?? {})
        .map(([id, fate]) => `${id}→${fate}`)
        .join(", ");
      const embedNote = embeds ? ` — embeds: ${embeds}` : "";
      lines.push(
        `- \`${page.key}\` — ${c.diataxis} · ${c.medium} · ${c.fate}${embedNote}`,
        `  - ${c.teaches}${c.why ? ` *(${c.why})*` : ""}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
