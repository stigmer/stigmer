/**
 * TSDoc coverage analysis for @stigmer/ink.
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
  | "provider"
  | "transport"
  | "component"
  | "composedView"
  | "utility"
  | "propsInterface"
  | "typeAlias"
  | "variable";

const CATEGORY_LABELS: Record<ExportCategory, string> = {
  provider: "Provider",
  transport: "Transport (re-exports)",
  component: "Components",
  composedView: "Composed Views",
  utility: "Utilities",
  propsInterface: "Props Interfaces",
  typeAlias: "Type Aliases",
  variable: "Variables",
};

const PROVIDER_NAMES = new Set(["InkStigmerProvider"]);
const TRANSPORT_NAMES = new Set(["createNodeClient", "createNodeTransport"]);
const COMPOSED_VIEW_NAMES = new Set(["SessionView", "SessionApp"]);
const UTILITY_NAMES = new Set(["renderMarkdown"]);

function classifyExport(entry: TypeDocChild): ExportCategory {
  if (entry.kind === KIND_FUNCTION) {
    if (PROVIDER_NAMES.has(entry.name)) return "provider";
    if (TRANSPORT_NAMES.has(entry.name)) return "transport";
    if (COMPOSED_VIEW_NAMES.has(entry.name)) return "composedView";
    if (UTILITY_NAMES.has(entry.name)) return "utility";
    return "component";
  }
  if (entry.kind === KIND_INTERFACE) {
    if (entry.name.endsWith("Props")) return "propsInterface";
    return "propsInterface";
  }
  if (entry.kind === KIND_TYPE_ALIAS) {
    if (TRANSPORT_NAMES.has(entry.name) || entry.name === "NodeClientConfig")
      return "transport";
    return "typeAlias";
  }
  if (entry.kind === KIND_VARIABLE) return "variable";
  return "variable";
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
  if (!sig?.parameters?.length) return true;
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
  fileName: string;
  hasDoc: boolean;
  hasExample: boolean;
  hasParamDocs: boolean;
  hasReturns: boolean;
  fieldCoverage: FieldCoverage | null;
}

function analyzeExport(entry: TypeDocChild): ExportInfo {
  const category = classifyExport(entry);
  const isCallable =
    category === "provider" ||
    category === "transport" ||
    category === "component" ||
    category === "composedView" ||
    category === "utility";
  return {
    name: entry.name,
    category,
    fileName: entry.sources?.[0]?.fileName ?? "(unknown)",
    hasDoc: hasTopLevelDoc(entry),
    hasExample: hasExample(entry),
    hasParamDocs: isCallable ? hasParamDocs(entry) : true,
    hasReturns: category === "utility" ? hasReturnsTag(entry) : true,
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
  return [
    `| ${headerLine} |`,
    `| ${separator} |`,
    ...dataLines.map((l) => `| ${l} |`),
  ].join("\n");
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

console.log("# TSDoc Coverage Report — @stigmer/ink\n");
console.log(`**Total exports**: ${totalExports}`);
console.log(
  `**Documented** (has top-level summary): ${documented} (${pct(documented, totalExports)})`,
);
console.log(
  `**With @example**: ${withExample} (${pct(withExample, totalExports)})`,
);
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

// ── 3. Component documentation depth ─────────────────────────────────

console.log("## Component Documentation Depth\n");

const components = exports.filter(
  (e) =>
    e.category === "provider" ||
    e.category === "component" ||
    e.category === "composedView",
);
const compsWithDoc = components.filter((e) => e.hasDoc).length;
const compsWithParams = components.filter((e) => e.hasParamDocs).length;
const compsWithExample = components.filter((e) => e.hasExample).length;

console.log(
  renderTable(
    ["Metric", "Count", "Percentage"],
    [
      [
        "Has summary",
        String(compsWithDoc),
        pct(compsWithDoc, components.length),
      ],
      [
        "Has @param docs",
        String(compsWithParams),
        pct(compsWithParams, components.length),
      ],
      [
        "Has @example",
        String(compsWithExample),
        pct(compsWithExample, components.length),
      ],
    ],
    [1, 2],
  ),
);
console.log();

// ── 4. Undocumented exports ───────────────────────────────────────────

const undocumented = exports.filter((e) => !e.hasDoc);

if (showUndocumented && undocumented.length > 0) {
  console.log("## Undocumented Exports\n");

  const undocRows = undocumented.map((e) => [
    e.name,
    CATEGORY_LABELS[e.category],
    e.fileName,
  ]);

  console.log(renderTable(["Export", "Category", "File"], undocRows));
  console.log();
} else if (!showUndocumented && undocumented.length > 0) {
  console.log(
    `*${undocumented.length} exports lack a top-level summary. Run with \`--undocumented\` to see the full list.*\n`,
  );
}

// ── 5. Interface field coverage ───────────────────────────────────────

const interfacesWithFields = exports.filter(
  (e) => e.fieldCoverage != null && e.fieldCoverage.total > 0,
);

if (showFields) {
  console.log("## Props Interface Field Coverage\n");

  const fieldRows = interfacesWithFields
    .sort(
      (a, b) => a.fieldCoverage!.percentage - b.fieldCoverage!.percentage,
    )
    .map((e) => [
      e.name,
      `${e.fieldCoverage!.documented}/${e.fieldCoverage!.total}`,
      `${e.fieldCoverage!.percentage.toFixed(0)}%`,
    ]);

  console.log(
    renderTable(["Interface", "Fields Documented", "Coverage"], fieldRows, [
      1,
      2,
    ]),
  );
  console.log();
} else if (interfacesWithFields.length > 0) {
  const poorCount = interfacesWithFields.filter(
    (e) => e.fieldCoverage!.percentage < 100,
  ).length;
  if (poorCount > 0) {
    console.log(
      `*${poorCount} interfaces have <100% field-level coverage. Run with \`--fields\` to see details.*\n`,
    );
  }
}

// ── 6. Per-export detail ──────────────────────────────────────────────

console.log("## Per-Export Detail\n");

const detailRows = exports.map((e) => [
  e.name,
  CATEGORY_LABELS[e.category],
  e.hasDoc ? "yes" : "**NO**",
  e.hasExample ? "yes" : "no",
  e.fieldCoverage
    ? `${e.fieldCoverage.documented}/${e.fieldCoverage.total}`
    : "—",
]);

console.log(
  renderTable(
    ["Export", "Category", "Summary", "Example", "Fields"],
    detailRows,
  ),
);
console.log();

// ── 7. Summary statistics ─────────────────────────────────────────────

console.log("## Summary\n");

const propsInterfaces = exports.filter(
  (e) => e.category === "propsInterface",
);
const propsDoc = propsInterfaces.filter((e) => e.hasDoc).length;
const funcExports = exports.filter(
  (e) =>
    e.category === "provider" ||
    e.category === "transport" ||
    e.category === "component" ||
    e.category === "composedView" ||
    e.category === "utility",
);
const funcDoc = funcExports.filter((e) => e.hasDoc).length;

console.log(
  `- Functions/Components: ${funcDoc}/${funcExports.length} documented (${pct(funcDoc, funcExports.length)})`,
);
console.log(
  `- Props Interfaces: ${propsDoc}/${propsInterfaces.length} documented (${pct(propsDoc, propsInterfaces.length)})`,
);

const allFieldCoverage = interfacesWithFields.reduce(
  (acc, e) => ({
    total: acc.total + e.fieldCoverage!.total,
    documented: acc.documented + e.fieldCoverage!.documented,
  }),
  { total: 0, documented: 0 },
);
console.log(
  `- Field-level: ${allFieldCoverage.documented}/${allFieldCoverage.total} fields documented (${pct(allFieldCoverage.documented, allFieldCoverage.total)})`,
);
