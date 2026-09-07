// The cloud-capability behavior inventory: schema, parsing and coverage.
// Domain: conformance inventory (DD-012's "behavior inventory, not a test count").
//
// `inventory/cloud-capabilities.yaml` enumerates, from the Java service's
// code, every behavior of the surfaces the TS composition must reproduce
// before the X1 cutover — the billing engine, the side-channel proxy and the
// public REST lane. Each row carries a DISPOSITION saying where that behavior
// is proven; only `conformance` and `deviation` rows are proven HERE, by a
// test whose name carries the row id as a `[billing.rpc.foo.bar]` tag. This
// module turns "every row is covered" from a sentence into a computed fact:
// parse the YAML against a strict schema, scan the suite sources for tags,
// and report every row that lacks a test and every tag that names no row.
//
// Deliberately static: it reads files, never boots a target. The CI lanes run
// it before the expensive boot so an uncovered row fails in seconds.
//
// The docs inventory (`docs/_inventory/classification.yaml`, checked by
// `make check-docs-inventory`) is the precedent: a YAML the owner rules on,
// machine-checked against the tree it describes.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { load } from "js-yaml";
import { z } from "zod";

// Row ids are stable dotted names — `<surface>.<lane>.<behavior>` — never
// numbers: a number renumbers on insert and tells a reader of a test name
// nothing. The surface segment must agree with the `surface` field.
export const ROW_ID_PATTERN = /^(billing|proxy|public)\.[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export const SURFACES = ["billing", "proxy", "public"] as const;
export type Surface = (typeof SURFACES)[number];

// Where a row's behavior is proven. Only the first two are proven by this
// suite; the rest name another home so the row is never silently dropped.
export const DISPOSITIONS = [
  // A test in this suite observes it against BOTH the hermetic Java launcher
  // and the composition.
  "conformance",
  // Java is wrong against the intended contract: the suite asserts the
  // contract and Java carries an entry in contract/deviations.ts.
  "deviation",
  // Pure logic (parsing, rating, arithmetic) whose home is an edition-internal
  // unit table the composition must carry; `java_test` names the Java table.
  "unit",
  // Needs a live upstream or a real account (the Cursor relay, real Stripe):
  // a live-smoke line owned by the implementing entry, on the X1 checklist.
  "smoke",
  // Proposed for the owner to cut as Java-only debris; awaits the ruling.
  "debris-candidate",
  // Ruled debris by the owner: recorded so the cut is visible, never tested.
  "debris",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

// Dispositions whose rows MUST carry a test tag; every other disposition's
// rows must NOT (a tag on a `smoke` row would claim a proof that isn't here).
export const TESTED_DISPOSITIONS: ReadonlySet<Disposition> = new Set(["conformance", "deviation"]);

// What kind of contract the row states. `carve-out` marks a DD-012
// byte-identical carve-out (status codes, console-rendered typed fields, the
// API-key hash, `*_micros`, Stripe ids / idempotency / signature, Temporal
// vocabulary, the public lane's site contract) — the suite pins bytes there
// and behavior elsewhere.
export const ROW_CLASSES = ["behavior", "carve-out", "adversarial"] as const;

// Whether the hermetic Java launcher (STIGMER_SECURITY_MODE=test) can show
// the behavior. `launcher-authz-only` rows need production security mode —
// HttpSecurityConfig is not loaded in test mode — so their tests skip through
// TargetProfile.edgeAuthenticationBypass() until the launcher entry lands.
export const OBSERVABILITY = [
  "launcher",
  "launcher-authz-only",
  "composition-only",
  "none",
] as const;

export const CALLERS = ["primary", "operator", "outsider", "anonymous", "runner-token", "none"] as const;

const rowSchema = z
  .object({
    id: z.string().regex(ROW_ID_PATTERN, "row id must be <surface>.<lane>.<behavior> in lowercase kebab segments"),
    surface: z.enum(SURFACES),
    lane: z.string().min(1),
    behavior: z.string().min(1),
    java_source: z.string().min(1),
    java_test: z.string().min(1),
    class: z.enum(ROW_CLASSES),
    disposition: z.enum(DISPOSITIONS),
    observability: z.enum(OBSERVABILITY),
    caller: z.enum(CALLERS),
    needs: z.array(z.string().min(1)),
    note: z.string().optional(),
    disputed: z.string().optional(),
  })
  .strict()
  .refine((row) => row.id.startsWith(`${row.surface}.`), {
    message: "row id's first segment must equal its surface",
    path: ["id"],
  });

export type InventoryRow = z.infer<typeof rowSchema>;

// The metric inventory DD-012 asks of C5 and C6 at their plan gates (checklist
// line 80): every Java `stigmer.*` metric in their domain is a row here,
// `ported` (the composition emits the byte-exact name) or `dropped` (its
// mechanism retires with Java — the note says which). `alerts` names the
// SigNoz alert files that read the series, so "re-pointed before X1" is a
// list, not a sentence. One inventory mechanism for the program, not two.
const metricRowSchema = z
  .object({
    name: z.string().regex(/^stigmer\.[a-z0-9_.]+$/, "a Java stigmer.* metric name, byte-exact"),
    surface: z.enum(["billing", "proxy"]),
    java_source: z.string().min(1),
    disposition: z.enum(["ported", "dropped"]),
    alerts: z.array(z.string().min(1)).optional(),
    note: z.string().optional(),
  })
  .strict()
  .refine((row) => row.disposition !== "dropped" || (row.note ?? "") !== "", {
    message: "a dropped metric must say why its mechanism retires",
    path: ["note"],
  });

export type MetricRow = z.infer<typeof metricRowSchema>;

const inventorySchema = z
  .object({
    rows: z.array(rowSchema),
    metrics: z.array(metricRowSchema).default([]),
  })
  .strict();

export interface Inventory {
  readonly rows: readonly InventoryRow[];
  readonly metrics: readonly MetricRow[];
}

export interface InventoryProblem {
  readonly kind:
    | "schema"
    | "duplicate-id"
    | "uncovered-row"
    | "unknown-tag"
    | "tag-on-untested-disposition";
  readonly message: string;
}

export function parseInventory(yamlText: string): { inventory: Inventory; problems: InventoryProblem[] } {
  const parsed = inventorySchema.safeParse(load(yamlText));
  if (!parsed.success) {
    return {
      inventory: { rows: [], metrics: [] },
      problems: parsed.error.issues.map((issue) => ({
        kind: "schema",
        message: `${issue.path.join(".")}: ${issue.message}`,
      })),
    };
  }
  const problems: InventoryProblem[] = [];
  const seen = new Set<string>();
  for (const row of parsed.data.rows) {
    if (seen.has(row.id)) {
      problems.push({ kind: "duplicate-id", message: `row id declared twice: ${row.id}` });
    }
    seen.add(row.id);
  }
  const seenMetrics = new Set<string>();
  for (const metric of parsed.data.metrics) {
    if (seenMetrics.has(metric.name)) {
      problems.push({ kind: "duplicate-id", message: `metric declared twice: ${metric.name}` });
    }
    seenMetrics.add(metric.name);
  }
  return { inventory: { rows: parsed.data.rows, metrics: parsed.data.metrics }, problems };
}

// A tag is the row id in square brackets anywhere in a suite source — by
// convention inside the `it(...)` / `describe(...)` title, so the id shows up
// in the vitest roster and the readout tables.
const TAG_PATTERN = /\[((?:billing|proxy|public)\.[a-z0-9.-]+)\]/g;

export interface TagOccurrence {
  readonly id: string;
  readonly file: string;
}

export function extractTags(source: string, file: string): TagOccurrence[] {
  const tags: TagOccurrence[] = [];
  for (const match of source.matchAll(TAG_PATTERN)) {
    const id = match[1];
    if (id !== undefined) tags.push({ id, file });
  }
  return tags;
}

// Scans every suite file (Class A and Class B) under the given roots.
export async function collectTags(suiteRoots: readonly string[], cwd: string): Promise<TagOccurrence[]> {
  const tags: TagOccurrence[] = [];
  for (const root of suiteRoots) {
    for (const file of await listTestFiles(root)) {
      tags.push(...extractTags(await readFile(file, "utf8"), relative(cwd, file)));
    }
  }
  return tags;
}

async function listTestFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTestFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files.sort();
}

export interface Coverage {
  readonly problems: InventoryProblem[];
  // Rows by disposition, for the summary line.
  readonly byDisposition: ReadonlyMap<Disposition, number>;
  readonly coveredRows: number;
}

// The three coverage invariants, each a distinct problem kind so a failure
// names its own fix: (1) a tested-disposition row with no tag is uncovered;
// (2) a tag naming no row is a typo or a deleted row; (3) a tag on a row whose
// disposition is not proven here claims a proof that does not exist.
export function computeCoverage(inventory: Inventory, tags: readonly TagOccurrence[]): Coverage {
  const rowsById = new Map(inventory.rows.map((row) => [row.id, row] as const));
  const taggedIds = new Set(tags.map((tag) => tag.id));
  const problems: InventoryProblem[] = [];
  const byDisposition = new Map<Disposition, number>();
  let coveredRows = 0;

  for (const row of inventory.rows) {
    byDisposition.set(row.disposition, (byDisposition.get(row.disposition) ?? 0) + 1);
    const tested = TESTED_DISPOSITIONS.has(row.disposition);
    const tagged = taggedIds.has(row.id);
    if (tested && !tagged) {
      problems.push({
        kind: "uncovered-row",
        message: `${row.id} is dispositioned ${row.disposition} but no suite test carries its tag`,
      });
    }
    if (tested && tagged) coveredRows += 1;
    if (!tested && tagged) {
      const files = [...new Set(tags.filter((tag) => tag.id === row.id).map((tag) => tag.file))].join(", ");
      problems.push({
        kind: "tag-on-untested-disposition",
        message: `${row.id} is dispositioned ${row.disposition} yet tagged in ${files} — a test cannot prove a row whose proof lives elsewhere`,
      });
    }
  }
  for (const tag of tags) {
    if (!rowsById.has(tag.id)) {
      problems.push({ kind: "unknown-tag", message: `${tag.file} tags ${tag.id}, which names no inventory row` });
    }
  }
  return { problems, byDisposition, coveredRows };
}

export function formatSummary(coverage: Coverage, totalRows: number): string {
  const parts = DISPOSITIONS.filter((d) => (coverage.byDisposition.get(d) ?? 0) > 0).map(
    (d) => `${d} ${coverage.byDisposition.get(d) ?? 0}`,
  );
  return `inventory: ${totalRows} rows (${parts.join(", ")}); ${coverage.coveredRows} tested rows covered; ${coverage.problems.length} problem(s)`;
}
