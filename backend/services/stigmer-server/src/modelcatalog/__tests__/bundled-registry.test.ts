/**
 * The bundled registry document's own contents: the Claude engine's rows
 * mirror the native engine's Anthropic rows.
 *
 * Why it matters: both engines call the same Anthropic API on the
 * organization's own key, so a model's id, provider id, prices and
 * capabilities are one fact with two rows. Each engine keeps its own rows
 * because the catalog answers "what does this engine run" per engine
 * (`document-catalog.ts`), and the runner reads a turn's thinking form from
 * its own engine's row. The file is refreshed from the public registry
 * (`make sync-model-registry`), so a refresh from a registry without the
 * Claude section, or one whose rows drifted apart, fails here instead of
 * shipping a Claude picker with no models or a price that differs by engine.
 *
 * The rows native alone reads (`tokenCounterMethod`, `summarization`, its
 * own runtime's compaction) are not mirrored.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bundledModelRegistryDocument } from "../bundled.js";

interface Row {
  readonly id: string;
  readonly harness: string;
  readonly provider: string;
  readonly [field: string]: unknown;
}

/** The fields a Claude row carries from its native twin. */
const MIRRORED = ["apiModelId", "displayName", "shortDescription", "speedTier", "provider", "costTier", "featured", "pricing", "pricingVariants", "contextWindowTokens", "maxOutputTokens", "capabilities"] as const;

/** The fields only native's runtime reads. */
const NATIVE_ONLY = ["tokenCounterMethod", "summarization"] as const;

function rowsOf(document: string): Row[] {
  return (JSON.parse(document) as { models: Row[] }).models;
}

/** Each disagreement between the Claude rows and the native Anthropic rows, as a sentence; empty when they mirror. */
function mirrorFindings(rows: readonly Row[]): string[] {
  const findings: string[] = [];
  const native = new Map(rows.filter((row) => row.harness === "stigmer" && row.provider === "anthropic").map((row) => [row.id, row]));
  const claude = new Map(rows.filter((row) => row.harness === "claude").map((row) => [row.id, row]));
  for (const id of native.keys()) if (!claude.has(id)) findings.push(`native row ${id} has no claude twin`);
  for (const [id, row] of claude) {
    const twin = native.get(id);
    if (twin === undefined) {
      findings.push(`claude row ${id} has no native Anthropic twin`);
      continue;
    }
    for (const field of MIRRORED) {
      if (JSON.stringify(row[field]) !== JSON.stringify(twin[field])) findings.push(`claude row ${id} differs from native on ${field}`);
    }
    for (const field of NATIVE_ONLY) if (row[field] !== undefined) findings.push(`claude row ${id} carries native's ${field}`);
  }
  return findings;
}

describe("the bundled model registry", () => {
  it("holds a Claude row for every native Anthropic row, each agreeing with its twin", () => {
    const rows = rowsOf(bundledModelRegistryDocument());
    expect(rows.some((row) => row.harness === "claude"), "the Claude section is present").toBe(true);
    expect(mirrorFindings(rows)).toEqual([]);
  });

  it("names each drift: a missing twin, a changed price, a native-only field", () => {
    const rows = rowsOf(readFileSync(new URL("../data/model-registry.json", import.meta.url), "utf8"));
    const twin = rows.find((row) => row.harness === "claude")!;
    const drifted = rows.map((row) => (row === twin ? { ...row, pricing: { inputPricePerMillion: 0 }, summarization: {} } : row));
    expect(mirrorFindings(drifted)).toEqual([`claude row ${twin.id} differs from native on pricing`, `claude row ${twin.id} carries native's summarization`]);
    expect(mirrorFindings(rows.filter((row) => row !== twin))).toEqual([`native row ${twin.id} has no claude twin`]);
  });
});
