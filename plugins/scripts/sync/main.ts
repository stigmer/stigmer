/**
 * The catalogue sync, end to end: `npm run sync -w @stigmer/plugins [-- --from-audit <audit.json> --strike <source/name=reason>]`
 * (or `make sync-plugins ARGS="..."`).
 *
 * One verb: make the tree agree with `vendor.json`. With `--from-audit`,
 * first rewrite `vendor.json` from an audit's verdicts (the audit's sources
 * at the commits it read, one row per `vendor` verdict that is not struck,
 * the strikes carried forward plus any `--strike`). Then, for each source,
 * check the repository out at its pinned commit (one shallow fetch; `git`
 * is the only network), copy every row's folder over ours byte for byte
 * after proving the source digests to what the row pins,
 * delete the folders whose rows are gone, and write the three derived
 * files: `vendor.json` with a source's commit moved only if its bytes or
 * rows moved, `NOTICE`, and `marketplace.json`'s plugin list. A second run
 * changes nothing.
 *
 * This is the one module that touches the world; every decision is
 * `plan.ts`'s and every rendering is `notice.ts`'s or `marketplace.ts`'s,
 * so the suite proves them over fixtures and this file stays a sequence of
 * steps. A refusal (a row that would overwrite an authored folder, a
 * malformed pin file) throws before anything is copied.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import type { AuditRun } from "../audit/report.js";
import { CATALOGUE_ROOT, digestOfFolder, pluginFolders } from "../lib/catalogue-tree.js";
import { checkoutTree } from "../lib/git-tree.js";
import { EMPTY_VENDOR_PINS, readVendorPins, renderVendorPins, VENDOR_PINS_FILE, type VendorPins, type VendorStrike } from "../lib/vendor-pins.js";
import { readMarketplaceHead, renderMarketplace } from "./marketplace.js";
import { renderNotice } from "./notice.js";
import { pinsFromAudit, planTree, settleCommits } from "./plan.js";
import { copyTree, treesDiffer } from "./tree.js";

const MARKETPLACE_FILE = "marketplace.json";
const NOTICE_FILE = "NOTICE";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "from-audit": { type: "string" },
      strike: { type: "string", multiple: true, default: [] },
    },
    strict: true,
  });

  const pinsPath = join(CATALOGUE_ROOT, VENDOR_PINS_FILE);
  const previous = existsSync(pinsPath) ? readVendorPins(pinsPath) : EMPTY_VENDOR_PINS;

  let next: VendorPins = previous;
  if (values["from-audit"] !== undefined) {
    const audit = JSON.parse(readFileSync(values["from-audit"], "utf8")) as AuditRun;
    if (!Array.isArray(audit.catalogues) || !Array.isArray(audit.verdicts?.entries)) throw new Error(`${values["from-audit"]} is not an audit.json (no catalogues or verdicts)`);
    const proposed = pinsFromAudit(audit, previous, values.strike.map(parseStrike));
    next = proposed.pins;
    for (const skipped of proposed.skipped) progress(`  left out ${skipped.source}/${skipped.name}: ${skipped.reason}`);
  } else if (values.strike.length > 0) {
    throw new Error("--strike is applied when the pins are rewritten from an audit; pass --from-audit, or edit vendor.json's 'struck' list by hand");
  }

  const onDisk = new Set(pluginFolders(CATALOGUE_ROOT));
  const plan = planTree(previous, next, onDisk);

  const scratch = mkdtempSync(join(tmpdir(), "stigmer-catalogue-sync-"));
  const changedSources = new Set<string>();
  let copied = 0;
  let unchanged = 0;
  try {
    for (const [sourceName, pin] of Object.entries(next.sources)) {
      const rows = plan.copies.filter((row) => row.source === sourceName);
      if (rows.length === 0) continue;
      progress(`reading ${pin.repo} at ${pin.commit.slice(0, 7)}`);
      const tree = checkoutTree({ repo: pin.repo, ref: pin.commit }, join(scratch, sourceName));
      for (const row of rows) {
        const source = join(tree.dir, ...row.path.split("/"));
        if (!existsSync(source)) throw new Error(`${pin.repo}@${pin.commit.slice(0, 7)} has no directory '${row.path}' for plugin '${row.name}'`);
        if (!existsSync(join(source, ...row.licence.split("/")))) throw new Error(`'${row.path}' in ${pin.repo} carries no '${row.licence}'; the row's licence file is wrong`);
        const destination = join(CATALOGUE_ROOT, row.name);
        const existed = existsSync(destination);
        if (existed && !treesDiffer(source, destination)) {
          unchanged++;
          continue;
        }
        const digest = await digestOfFolder(source);
        if (digest !== row.digest) {
          throw new Error(`'${row.path}' in ${pin.repo}@${pin.commit.slice(0, 7)} digests to ${digest}, not the pinned ${row.digest}; the pin and the source disagree, so '${row.name}' was not copied`);
        }
        copyTree(source, destination);
        changedSources.add(sourceName);
        copied++;
        progress(`  ${existed ? "updated" : "added"} ${row.name}/ <- ${row.path}/`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  for (const name of plan.deletions) {
    rmSync(join(CATALOGUE_ROOT, name), { recursive: true, force: true });
    const row = previous.plugins.find((candidate) => candidate.name === name);
    if (row !== undefined) changedSources.add(row.source);
    progress(`  removed ${name}/`);
  }

  const settled = settleCommits(previous, next, changedSources);
  writeIfChanged(pinsPath, renderVendorPins(settled));
  writeIfChanged(join(CATALOGUE_ROOT, NOTICE_FILE), renderNotice(settled));

  const marketplacePath = join(CATALOGUE_ROOT, MARKETPLACE_FILE);
  const head = readMarketplaceHead(readFileSync(marketplacePath, "utf8"), marketplacePath);
  const names = new Set([...pluginFolders(CATALOGUE_ROOT)]);
  writeIfChanged(marketplacePath, renderMarketplace(head, names));

  progress(`synced: ${copied} folder${copied === 1 ? "" : "s"} copied, ${unchanged} unchanged, ${plan.deletions.length} removed; ${settled.plugins.length} vendored, ${names.size - settled.plugins.length} authored, ${settled.struck.length} struck`);
}

/** `source/name=reason` from the command line. */
function parseStrike(value: string): VendorStrike {
  const eq = value.indexOf("=");
  const slash = value.indexOf("/");
  if (slash <= 0 || eq <= slash + 1 || eq === value.length - 1) throw new Error(`--strike expects 'source/name=reason', got '${value}'`);
  return { source: value.slice(0, slash), name: value.slice(slash + 1, eq), reason: value.slice(eq + 1) };
}

/** Write only when the text differs, so an unchanged file keeps its mtime and a no-op sync is visibly a no-op. */
function writeIfChanged(path: string, text: string): void {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return;
  writeFileSync(path, text);
  progress(`  wrote ${path.slice(CATALOGUE_ROOT.length)}`);
}

function progress(message: string): void {
  process.stderr.write(`${message}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`sync: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
