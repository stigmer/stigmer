/**
 * The vendor-catalogue audit, end to end: `npm run audit -w @stigmer/plugins -- --out <dir>`
 * (or `make audit-plugins ARGS="--out <dir>"`).
 *
 * This is the one module that touches the world: it parses the arguments,
 * checks the vendors' repositories out, walks their trees, dials their
 * servers and writes the two outputs. Everything it calls is pure over what
 * it hands in (`entries.ts` over a listing, `probe.ts` over a `fetch`,
 * `classify.ts` and `report.ts` over data), which is what lets the suite
 * prove the verdicts without a network and lets this file stay a
 * sequence of steps with no decisions of its own.
 *
 * Network, by hand, at curation time: a probe against a hundred vendor
 * endpoints is not a CI job. Distinct URLs are probed once each, a few at
 * a time, so a server named by several entries is asked once and no host
 * sees a burst. Progress goes to stderr; the outputs are the only thing
 * written under `--out`.
 *
 * Arguments: `--out <dir>` (required); `--ref owner/repo=<ref>` (repeatable)
 * pins a catalogue to a commit; `--concurrency <n>` (default 4);
 * `--keep-trees` leaves the checkouts under the temporary directory for a
 * look.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { listDirectory } from "../lib/candidates.js";
import { checkoutTree } from "../lib/git-tree.js";
import { readVendorPins, VENDOR_PINS_FILE } from "../lib/vendor-pins.js";
import { classifyCatalogues } from "./classify.js";
import { type CatalogueFacts, readCatalogue } from "./entries.js";
import { probeEndpoint, type ProbeResult } from "./probe.js";
import { type AuditRun, renderJson, renderMarkdown } from "./report.js";
import { auditSources, parsePinnedRefs } from "./sources.js";

const DEFAULT_CONCURRENCY = 4;
/** The catalogue root (`plugins/`), where the pin file lives. */
const CATALOGUE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      ref: { type: "string", multiple: true, default: [] },
      concurrency: { type: "string", default: String(DEFAULT_CONCURRENCY) },
      "keep-trees": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.out === undefined) throw new Error("--out <dir> is required: where audit.md and audit.json are written");
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`--concurrency expects a positive integer, got '${values.concurrency}'`);

  const sources = auditSources(readVendorPins(join(CATALOGUE_ROOT, VENDOR_PINS_FILE)), parsePinnedRefs(values.ref));
  const scratch = mkdtempSync(join(tmpdir(), "stigmer-catalogue-audit-"));
  try {
    const catalogues: CatalogueFacts[] = [];
    for (const source of sources) {
      progress(`reading ${source.repo}${source.ref === undefined ? "" : ` at ${source.ref}`}`);
      const tree = checkoutTree(source, join(scratch, source.name));
      const catalogue = await readCatalogue(source, tree, listDirectory(tree.dir));
      progress(`  ${catalogue.entries.length} entries at ${tree.commit.slice(0, 7)}, ${catalogue.dropped.length} dropped by the reader`);
      catalogues.push(catalogue);
    }

    const urls = distinctHttpUrls(catalogues);
    progress(`probing ${urls.length} distinct hosted servers, ${concurrency} at a time`);
    const probes = await probeAll(urls, concurrency);

    const run: AuditRun = {
      generatedAt: new Date().toISOString(),
      catalogues,
      verdicts: classifyCatalogues(catalogues, probes),
      probes: urls.map((url) => {
        const probe = probes.get(url);
        if (probe === undefined) throw new Error(`no probe result for ${url}`);
        return probe;
      }),
    };

    mkdirSync(values.out, { recursive: true });
    writeFileSync(join(values.out, "audit.md"), renderMarkdown(run));
    writeFileSync(join(values.out, "audit.json"), renderJson(run));
    const vendor = run.verdicts.entries.filter((judged) => judged.verdict.kind === "vendor").length;
    progress(`wrote ${join(values.out, "audit.md")} and audit.json: ${run.verdicts.entries.length} entries, ${vendor} vendor, ${run.verdicts.entries.length - vendor} exclude, ${run.verdicts.authoredCandidates.length} endpoints to author`);
  } finally {
    if (values["keep-trees"]) progress(`checkouts kept under ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  }
}

/** Every HTTP server URL any entry declares, once, in first-seen order. */
function distinctHttpUrls(catalogues: readonly CatalogueFacts[]): readonly string[] {
  const urls = new Set<string>();
  for (const catalogue of catalogues) {
    for (const entry of catalogue.entries) {
      if (!entry.read.ok) continue;
      for (const server of entry.read.servers) if (server.transport === "http") urls.add(server.url);
    }
  }
  return [...urls];
}

/** Probe every URL, `concurrency` in flight at once. */
async function probeAll(urls: readonly string[], concurrency: number): Promise<ReadonlyMap<string, ProbeResult>> {
  const results = new Map<string, ProbeResult>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      const url = urls[next++];
      if (url === undefined) return;
      const result = await probeEndpoint(url);
      results.set(url, result);
      progress(`  ${result.outcome.kind.padEnd(20)} ${url}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return results;
}

function progress(message: string): void {
  process.stderr.write(`${message}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`audit: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
