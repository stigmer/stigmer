/**
 * Prints the full contrast-audit matrix for every preset × color mode —
 * the human-readable companion to `src/contract/__tests__/contrast.test.ts`.
 *
 * Run from `sdk/theme/`:
 *
 *     npx tsx scripts/contrast-report.ts            # failures only
 *     npx tsx scripts/contrast-report.ts --all      # every measured pair
 */
import { runContrastAudit, resultId } from "../src/contract/audit.js";

const showAll = process.argv.includes("--all");
const { results, leaks } = runContrastAudit();

if (leaks.length > 0) {
  console.log("PRESET CASCADE LEAKS (light-only value overrides default dark):");
  for (const leak of leaks) {
    console.log(`  ${leak.preset}: ${leak.tokens.join(", ")}`);
  }
  console.log();
}

const rows = results
  .filter((r) => showAll || (!r.passes && r.enforced))
  .sort((a, b) => resultId(a).localeCompare(resultId(b)));

const failCount = results.filter((r) => !r.passes && r.enforced).length;
const infoCount = results.filter((r) => !r.passes && !r.enforced).length;
console.log(
  `${results.length} measurements — ${failCount} enforced failures, ${infoCount} report-only misses` +
    (showAll ? "" : " (showing enforced failures; --all for everything)"),
);
console.log();

let lastScope = "";
for (const row of rows) {
  const scope = `${row.preset} / ${row.mode}`;
  if (scope !== lastScope) {
    console.log(`── ${scope} ${"─".repeat(Math.max(0, 60 - scope.length))}`);
    lastScope = scope;
  }
  const status = row.passes ? " ok " : row.enforced ? "FAIL" : "info";
  const metric = row.pair.kind === "surface" ? "ΔL" : "ratio";
  console.log(
    `  [${status}] ${row.pair.foreground.replace("--stgm-", "")} on ${row.pair.background.replace("--stgm-", "")}` +
      ` — ${metric} ${row.measured.toFixed(2)} (min ${row.threshold})` +
      ` [${row.foregroundValue} / ${row.backgroundValue}]`,
  );
  console.log(`         ${row.pair.usage}`);
}
