/**
 * TSDoc coverage analysis for @stigmer/react.
 *
 * Reads the TypeDoc JSON output (dist/api.json) and produces a structured
 * coverage report as markdown tables to stdout. Designed to be run
 * repeatedly during TSDoc backfill to measure progress.
 *
 * Usage: npx tsx scripts/tsdoc-coverage.ts [--undocumented] [--fields]
 *
 *   --undocumented  Print the full list of undocumented exports
 *   --fields        Print interfaces with poor field-level coverage
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── TypeDoc JSON shape (subset we care about) ──────────────────────────

interface TypeDocComment {
  summary?: Array<{ kind: string; text: string }>;
  blockTags?: Array<{ tag: string; name?: string }>;
}

interface TypeDocParameter {
  name: string;
  comment?: TypeDocComment;
}

interface TypeDocSignature {
  comment?: TypeDocComment;
  parameters?: TypeDocParameter[];
}

interface TypeDocSource {
  fileName: string;
  line: number;
}

interface TypeDocChild {
  id: number;
  name: string;
  kind: number;
  comment?: TypeDocComment;
  signatures?: TypeDocSignature[];
  children?: TypeDocChild[];
  sources?: TypeDocSource[];
  flags?: Record<string, boolean>;
}

interface TypeDocRoot {
  children: TypeDocChild[];
}

// ── Classification ─────────────────────────────────────────────────────

const KIND_VARIABLE = 32;
const KIND_FUNCTION = 64;
const KIND_INTERFACE = 256;
const KIND_TYPE_ALIAS = 2097152;

type ExportCategory =
  | "hook"
  | "component"
  | "propsInterface"
  | "returnInterface"
  | "otherInterface"
  | "typeAlias"
  | "variable";

const CATEGORY_LABELS: Record<ExportCategory, string> = {
  hook: "Hooks",
  component: "Components",
  propsInterface: "Props Interfaces",
  returnInterface: "Return Interfaces",
  otherInterface: "Other Interfaces",
  typeAlias: "Type Aliases",
  variable: "Variables",
};

const DOMAIN_REMAP: Record<string, string> = {
  root: "core",
  internal: "core",
  search: "library",
};

function classifyExport(entry: TypeDocChild): ExportCategory {
  if (entry.kind === KIND_FUNCTION) {
    return entry.name.startsWith("use") ? "hook" : "component";
  }
  if (entry.kind === KIND_INTERFACE) {
    if (entry.name.endsWith("Props")) return "propsInterface";
    if (/^Use\w+Return$/.test(entry.name)) return "returnInterface";
    return "otherInterface";
  }
  if (entry.kind === KIND_TYPE_ALIAS) return "typeAlias";
  return "variable";
}

function resolveDomain(entry: TypeDocChild): string {
  const fileName = entry.sources?.[0]?.fileName ?? "";

  // TypeDoc may produce paths in two forms depending on config:
  //   - src-relative: "session/useSession.ts"
  //   - monorepo-relative: "sdk/react/src/session/useSession.ts"
  // Normalize by finding the segment after "src/" if present.
  const srcIdx = fileName.indexOf("src/");
  const relative = srcIdx >= 0 ? fileName.slice(srcIdx + 4) : fileName;

  // Exclude entries from outside sdk/react/src/ (re-exported externals).
  if (srcIdx >= 0 && !fileName.startsWith("sdk/react/src/") && !relative.startsWith("src/")) {
    const topDir = fileName.split("/")[0];
    if (topDir !== relative.split("/")[0]) return "external";
  }
  if (fileName.startsWith("apis/") || fileName.startsWith("sdk/typescript/")) {
    return "external";
  }

  const firstSegment = relative.split("/")[0];
  if (!firstSegment || firstSegment.includes(".")) return "core";
  return DOMAIN_REMAP[firstSegment] ?? firstSegment;
}

// ── Doc presence checks ────────────────────────────────────────────────

function hasNonEmptySummary(comment?: TypeDocComment): boolean {
  if (!comment?.summary) return false;
  return comment.summary.some((s) => s.text.trim().length > 0);
}

function getFunctionComment(entry: TypeDocChild): TypeDocComment | undefined {
  return entry.signatures?.[0]?.comment;
}

function hasTopLevelDoc(entry: TypeDocChild): boolean {
  if (entry.kind === KIND_FUNCTION) {
    return hasNonEmptySummary(getFunctionComment(entry));
  }
  return hasNonEmptySummary(entry.comment);
}

function hasTag(comment: TypeDocComment | undefined, tag: string): boolean {
  return comment?.blockTags?.some((t) => t.tag === tag) ?? false;
}

function hasParamDocs(entry: TypeDocChild): boolean {
  const sig = entry.signatures?.[0];
  if (!sig?.parameters?.length) return true; // no params = trivially documented
  return sig.parameters.some((p) => p.comment != null);
}

function hasExample(entry: TypeDocChild): boolean {
  if (entry.kind === KIND_FUNCTION) {
    return hasTag(getFunctionComment(entry), "@example");
  }
  return hasTag(entry.comment, "@example");
}

function hasReturnsTag(entry: TypeDocChild): boolean {
  return hasTag(getFunctionComment(entry), "@returns");
}

// ── Field-level coverage for interfaces ────────────────────────────────

interface FieldCoverage {
  total: number;
  documented: number;
  percentage: number;
}

function getFieldCoverage(entry: TypeDocChild): FieldCoverage | null {
  if (entry.kind !== KIND_INTERFACE || !entry.children?.length) return null;
  const total = entry.children.length;
  const documented = entry.children.filter((c) =>
    hasNonEmptySummary(c.comment),
  ).length;
  return { total, documented, percentage: (documented / total) * 100 };
}

// ── Report data structures ─────────────────────────────────────────────

interface ExportInfo {
  name: string;
  category: ExportCategory;
  domain: string;
  fileName: string;
  hasDoc: boolean;
  hasExample: boolean;
  hasParamDocs: boolean;
  hasReturns: boolean;
  fieldCoverage: FieldCoverage | null;
}

function analyzeExport(entry: TypeDocChild): ExportInfo {
  const category = classifyExport(entry);
  return {
    name: entry.name,
    category,
    domain: resolveDomain(entry),
    fileName: entry.sources?.[0]?.fileName ?? "(unknown)",
    hasDoc: hasTopLevelDoc(entry),
    hasExample: hasExample(entry),
    hasParamDocs:
      category === "hook" || category === "component"
        ? hasParamDocs(entry)
        : true,
    hasReturns: category === "hook" ? hasReturnsTag(entry) : true,
    fieldCoverage: getFieldCoverage(entry),
  };
}

// ── Markdown rendering ─────────────────────────────────────────────────

function padEnd(s: string, len: number): string {
  return s + " ".repeat(Math.max(0, len - s.length));
}

function padStart(s: string, len: number): string {
  return " ".repeat(Math.max(0, len - s.length)) + s;
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function renderTable(
  headers: string[],
  rows: string[][],
  alignRight: number[] = [],
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const headerLine = headers
    .map((h, i) =>
      alignRight.includes(i) ? padStart(h, widths[i]) : padEnd(h, widths[i]),
    )
    .join(" | ");
  const separator = widths
    .map((w, i) =>
      alignRight.includes(i) ? "-".repeat(w - 1) + ":" : "-".repeat(w),
    )
    .join(" | ");
  const dataLines = rows.map((row) =>
    row
      .map((cell, i) =>
        alignRight.includes(i)
          ? padStart(cell, widths[i])
          : padEnd(cell, widths[i]),
      )
      .join(" | "),
  );
  return [`| ${headerLine} |`, `| ${separator} |`, ...dataLines.map((l) => `| ${l} |`)].join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));
const showUndocumented = args.has("--undocumented");
const showFields = args.has("--fields");

const jsonPath = resolve(import.meta.dirname ?? ".", "..", "dist", "api.json");
const raw = readFileSync(jsonPath, "utf-8");
const root: TypeDocRoot = JSON.parse(raw);

const exports = root.children.map(analyzeExport);

// ── 1. Overall summary ────────────────────────────────────────────────

const totalExports = exports.length;
const documented = exports.filter((e) => e.hasDoc).length;
const withExample = exports.filter((e) => e.hasExample).length;

console.log("# TSDoc Coverage Report — @stigmer/react\n");
console.log(`**Total exports**: ${totalExports}`);
console.log(`**Documented** (has top-level summary): ${documented} (${pct(documented, totalExports)})`);
console.log(`**With @example**: ${withExample} (${pct(withExample, totalExports)})`);
console.log();

// ── 2. Per-category summary ───────────────────────────────────────────

console.log("## Coverage by Category\n");

const categories = Object.keys(CATEGORY_LABELS) as ExportCategory[];
const categoryRows = categories.map((cat) => {
  const items = exports.filter((e) => e.category === cat);
  const doc = items.filter((e) => e.hasDoc).length;
  const ex = items.filter((e) => e.hasExample).length;
  return [
    CATEGORY_LABELS[cat],
    String(items.length),
    String(doc),
    pct(doc, items.length),
    String(ex),
    pct(ex, items.length),
  ];
});
categoryRows.push([
  "**Total**",
  `**${totalExports}**`,
  `**${documented}**`,
  `**${pct(documented, totalExports)}**`,
  `**${withExample}**`,
  `**${pct(withExample, totalExports)}**`,
]);

console.log(
  renderTable(
    ["Category", "Count", "Documented", "Doc %", "Examples", "Ex %"],
    categoryRows,
    [1, 2, 3, 4, 5],
  ),
);
console.log();

// ── 3. Per-domain summary ─────────────────────────────────────────────

console.log("## Coverage by Domain\n");

const domainMap = new Map<string, ExportInfo[]>();
for (const e of exports) {
  const list = domainMap.get(e.domain) ?? [];
  list.push(e);
  domainMap.set(e.domain, list);
}

const sortedDomains = [...domainMap.entries()].sort(
  (a, b) => b[1].length - a[1].length,
);

const domainRows = sortedDomains.map(([domain, items]) => {
  const doc = items.filter((e) => e.hasDoc).length;
  const hooks = items.filter((e) => e.category === "hook");
  const comps = items.filter((e) => e.category === "component");
  const ifaces = items.filter(
    (e) =>
      e.category === "propsInterface" ||
      e.category === "returnInterface" ||
      e.category === "otherInterface",
  );
  const ifaceDoc = ifaces.filter((e) => e.hasDoc).length;
  return [
    domain,
    String(items.length),
    String(doc),
    pct(doc, items.length),
    String(hooks.length),
    String(comps.length),
    String(ifaces.length),
    pct(ifaceDoc, ifaces.length),
  ];
});

console.log(
  renderTable(
    [
      "Domain",
      "Exports",
      "Documented",
      "Doc %",
      "Hooks",
      "Components",
      "Interfaces",
      "Iface Doc %",
    ],
    domainRows,
    [1, 2, 3, 4, 5, 6, 7],
  ),
);
console.log();

// ── 4. Hook-specific metrics ──────────────────────────────────────────

console.log("## Hook Documentation Depth\n");

const hooks = exports.filter((e) => e.category === "hook");
const hooksWithDoc = hooks.filter((e) => e.hasDoc).length;
const hooksWithParams = hooks.filter((e) => e.hasParamDocs).length;
const hooksWithReturns = hooks.filter((e) => e.hasReturns).length;
const hooksWithExample = hooks.filter((e) => e.hasExample).length;

console.log(
  renderTable(
    ["Metric", "Count", "Percentage"],
    [
      ["Has summary", String(hooksWithDoc), pct(hooksWithDoc, hooks.length)],
      ["Has @param docs", String(hooksWithParams), pct(hooksWithParams, hooks.length)],
      ["Has @returns tag", String(hooksWithReturns), pct(hooksWithReturns, hooks.length)],
      ["Has @example", String(hooksWithExample), pct(hooksWithExample, hooks.length)],
    ],
    [1, 2],
  ),
);
console.log();

// ── 5. Undocumented exports ───────────────────────────────────────────

const undocumented = exports.filter((e) => !e.hasDoc);

if (showUndocumented && undocumented.length > 0) {
  console.log("## Undocumented Exports\n");

  for (const [domain, items] of sortedDomains) {
    const missing = items.filter((e) => !e.hasDoc);
    if (missing.length === 0) continue;

    console.log(`### ${domain} (${missing.length} undocumented)\n`);
    console.log(
      renderTable(
        ["Export", "Category", "File"],
        missing.map((e) => [e.name, CATEGORY_LABELS[e.category], e.fileName]),
      ),
    );
    console.log();
  }
} else if (!showUndocumented && undocumented.length > 0) {
  console.log(
    `*${undocumented.length} exports lack a top-level summary. Run with \`--undocumented\` to see the full list.*\n`,
  );
}

// ── 6. Interface field coverage ───────────────────────────────────────

const interfacesWithFields = exports.filter(
  (e) => e.fieldCoverage != null && e.fieldCoverage.total > 0,
);

if (showFields) {
  const poorFieldCoverage = interfacesWithFields.filter(
    (e) => e.fieldCoverage!.percentage < 50,
  );

  if (poorFieldCoverage.length > 0) {
    console.log("## Interfaces with Poor Field Coverage (<50%)\n");

    const fieldRows = poorFieldCoverage
      .sort((a, b) => a.fieldCoverage!.percentage - b.fieldCoverage!.percentage)
      .map((e) => [
        e.name,
        e.domain,
        `${e.fieldCoverage!.documented}/${e.fieldCoverage!.total}`,
        `${e.fieldCoverage!.percentage.toFixed(0)}%`,
      ]);

    console.log(
      renderTable(
        ["Interface", "Domain", "Fields Documented", "Coverage"],
        fieldRows,
        [2, 3],
      ),
    );
    console.log();
  }
} else if (interfacesWithFields.length > 0) {
  const poorCount = interfacesWithFields.filter(
    (e) => e.fieldCoverage!.percentage < 50,
  ).length;
  if (poorCount > 0) {
    console.log(
      `*${poorCount} interfaces have <50% field-level coverage. Run with \`--fields\` to see details.*\n`,
    );
  }
}

// ── 7. Summary statistics (machine-readable) ──────────────────────────

console.log("## Summary\n");

const interfaceExports = exports.filter(
  (e) =>
    e.category === "propsInterface" ||
    e.category === "returnInterface" ||
    e.category === "otherInterface",
);
const ifaceDoc = interfaceExports.filter((e) => e.hasDoc).length;
const funcExports = exports.filter(
  (e) => e.category === "hook" || e.category === "component",
);
const funcDoc = funcExports.filter((e) => e.hasDoc).length;

console.log(`- Functions: ${funcDoc}/${funcExports.length} documented (${pct(funcDoc, funcExports.length)})`);
console.log(`- Interfaces: ${ifaceDoc}/${interfaceExports.length} documented (${pct(ifaceDoc, interfaceExports.length)})`);
console.log(`- Biggest gap: ${CATEGORY_LABELS[
  categories.reduce((worst, cat) => {
    const items = exports.filter((e) => e.category === cat);
    const doc = items.filter((e) => e.hasDoc).length;
    const worstItems = exports.filter((e) => e.category === worst);
    const worstDoc = worstItems.filter((e) => e.hasDoc).length;
    const worstPct = worstItems.length > 0 ? worstDoc / worstItems.length : 1;
    const catPct = items.length > 0 ? doc / items.length : 1;
    return catPct < worstPct ? cat : worst;
  })
]} (lowest documentation rate)`);
console.log(`- Domains needing most work: ${
  sortedDomains
    .filter(([, items]) => {
      const doc = items.filter((e) => e.hasDoc).length;
      return items.length > 0 && doc / items.length < 0.5;
    })
    .map(([d]) => d)
    .join(", ") || "(none below 50%)"
}`);
