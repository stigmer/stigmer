/**
 * Docs Inventory CLI
 *
 * Thin wrapper over src/lib/docs-inventory.ts (the unit-tested logic —
 * same lib/script split as generate-llms-txt.ts over llms-pages.ts).
 *
 *   tsx scripts/generate-docs-inventory/index.ts            # report → stdout
 *   tsx scripts/generate-docs-inventory/index.ts --out F    # report → file F
 *   tsx scripts/generate-docs-inventory/index.ts --check    # invariants only
 *
 * `--check` is the CI gate (`make check-docs-inventory`): it prints every
 * violation and exits 1 if any exist. The report is a generated VIEW of
 * docs/_inventory/classification.yaml and is never committed to the docs
 * tree — reviewed snapshots live in the revamp project docs, stamped with
 * the provenance header this script prepends.
 *
 * Runs as part of: make check-docs-inventory (check-site bucket, ci.docs)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildInventory, renderReport } from "../../src/lib/docs-inventory";

const DOCS_DIR = path.resolve(process.cwd(), "..", "docs");
const CLASSIFICATION_PATH = path.join(DOCS_DIR, "_inventory", "classification.yaml");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0 ? args[outIndex + 1] : null;
  if (outIndex >= 0 && !outPath) {
    console.error("[docs-inventory] Error: --out requires a path");
    process.exit(1);
  }

  let classificationRaw: string;
  try {
    classificationRaw = await fs.readFile(CLASSIFICATION_PATH, "utf-8");
  } catch {
    console.error(
      `[docs-inventory] Error: ${CLASSIFICATION_PATH} not found — the docs ` +
        "inventory classification is required (see docs/STYLE.md, " +
        '"Classify every page").',
    );
    process.exit(1);
  }

  const inventory = await buildInventory(DOCS_DIR, classificationRaw);

  if (check) {
    if (inventory.violations.length > 0) {
      console.error(
        `docs inventory gate found ${inventory.violations.length} problem(s):\n`,
      );
      for (const violation of inventory.violations) {
        console.error(`  ${violation.key} [${violation.kind}]`);
        console.error(`    ${violation.message}`);
      }
      console.error(
        "\nEvery hand-authored docs page needs an entry in " +
          "docs/_inventory/classification.yaml (fate, diataxis, teaches, " +
          "medium, per-embed fates); generated pages are covered by cohort " +
          "rules. See docs/STYLE.md.",
      );
      process.exit(1);
    }
    const handAuthored = inventory.pages.filter((page) => !page.generated).length;
    const generated = inventory.pages.length - handAuthored;
    console.log(
      `docs inventory gate: ${inventory.pages.length} pages OK ` +
        `(${handAuthored} classified, ${generated} cohort-covered)`,
    );
    return;
  }

  const provenance = [
    "<!--",
    `  Generated view of docs/_inventory/classification.yaml — do not edit.`,
    `  Regenerate: cd site && yarn generate-docs-inventory`,
    `  Generated at: ${new Date().toISOString()}`,
    "-->",
    "",
  ].join("\n");
  const report = provenance + renderReport(inventory);

  if (outPath) {
    await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await fs.writeFile(outPath, report, "utf-8");
    console.error(`[docs-inventory] Report written to ${outPath}`);
  } else {
    console.log(report);
  }
}

main().catch((err: unknown) => {
  console.error("[docs-inventory] Fatal error:", err);
  process.exit(1);
});
