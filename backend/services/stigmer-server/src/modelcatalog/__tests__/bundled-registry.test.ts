/**
 * The bundled registry document's own contents: the Claude engine's rows
 * mirror the Stigmer harness's Anthropic rows.
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
 * The rows the Stigmer harness alone reads (`tokenCounterMethod`,
 * `summarization`, its own runtime's compaction) are not mirrored.
 *
 * It also holds the models the provider has retired out of the bundle. A
 * retirement can reach this file before it reaches the public registry, and a
 * refresh would then bring the dead model back into every offline server's
 * picker; `RETIRED` names each such model with its reason, and a refresh that
 * lists one fails here.
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

/** The fields a Claude row carries from its Stigmer twin. */
const MIRRORED = ["apiModelId", "displayName", "shortDescription", "speedTier", "provider", "costTier", "featured", "pricing", "pricingVariants", "contextWindowTokens", "maxOutputTokens", "capabilities"] as const;

/**
 * Models the provider has retired, kept out of the bundle even while the public
 * registry still lists them. An entry leaves once the public registry has
 * dropped the model too.
 */
const RETIRED: Readonly<Record<string, string>> = {
  "claude-sonnet-4.5": "Anthropic retires Claude Sonnet 4.5 on 2026-11-30 (stigmer#3147)",
};

/** The fields only the Stigmer harness's runtime reads. */
const STIGMER_ONLY = ["tokenCounterMethod", "summarization"] as const;

function rowsOf(document: string): Row[] {
  return (JSON.parse(document) as { models: Row[] }).models;
}

/** Each disagreement between the Claude rows and the Stigmer harness's Anthropic rows, as a sentence; empty when they mirror. */
function mirrorFindings(rows: readonly Row[]): string[] {
  const findings: string[] = [];
  const stigmer = new Map(rows.filter((row) => row.harness === "stigmer" && row.provider === "anthropic").map((row) => [row.id, row]));
  const claude = new Map(rows.filter((row) => row.harness === "claude").map((row) => [row.id, row]));
  for (const id of stigmer.keys()) if (!claude.has(id)) findings.push(`stigmer row ${id} has no claude twin`);
  for (const [id, row] of claude) {
    const twin = stigmer.get(id);
    if (twin === undefined) {
      findings.push(`claude row ${id} has no Stigmer Anthropic twin`);
      continue;
    }
    for (const field of MIRRORED) {
      if (JSON.stringify(row[field]) !== JSON.stringify(twin[field])) findings.push(`claude row ${id} differs from stigmer on ${field}`);
    }
    for (const field of STIGMER_ONLY) if (row[field] !== undefined) findings.push(`claude row ${id} carries the Stigmer harness's ${field}`);
  }
  return findings;
}

describe("the bundled model registry", () => {
  it("holds a Claude row for every Stigmer-harness Anthropic row, each agreeing with its twin", () => {
    const rows = rowsOf(bundledModelRegistryDocument());
    expect(rows.some((row) => row.harness === "claude"), "the Claude section is present").toBe(true);
    expect(mirrorFindings(rows)).toEqual([]);
  });

  it("lists no model the provider has retired", () => {
    const listed = rowsOf(bundledModelRegistryDocument())
      .filter((row) => RETIRED[row.id] !== undefined)
      .map((row) => `${row.harness} row ${row.id}: ${RETIRED[row.id]}`);
    expect(listed).toEqual([]);
  });

  it("names each drift: a missing twin, a changed price, a Stigmer-only field", () => {
    const rows = rowsOf(readFileSync(new URL("../data/model-registry.json", import.meta.url), "utf8"));
    const twin = rows.find((row) => row.harness === "claude")!;
    const drifted = rows.map((row) => (row === twin ? { ...row, pricing: { inputPricePerMillion: 0 }, summarization: {} } : row));
    expect(mirrorFindings(drifted)).toEqual([`claude row ${twin.id} differs from stigmer on pricing`, `claude row ${twin.id} carries the Stigmer harness's summarization`]);
    expect(mirrorFindings(rows.filter((row) => row !== twin))).toEqual([`stigmer row ${twin.id} has no claude twin`]);
  });
});
