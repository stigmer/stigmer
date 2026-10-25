// Reads harness benchmark reports and prints, arm by arm and cell by cell,
// whether each arm holds the bar a reference arm sets
// (`npm run benchmark:compare -- [--reference <arm>] <report.json> ...`).
// Domain: conformance benchmark (the readout's entrypoint).
//
// Thin over src/benchmark/compare.ts (the lib/script split of
// check-inventory.ts): the files and the exit code here, the comparability
// rule, the pooling and the bar there. Every report is read through
// `readBenchmarkReport`, so a report of another schema version is refused by
// name. `--reference` names an arm as the table prints it
// (`native/<model>@<endpoint>#<code>`, `cursor/<model>#<code>`), or a prefix
// of one ending where its endpoint or code begins, or inside its code, when
// one arm matches (`native/<model>`, `native/<model>@<endpoint>#1a2b`); the
// default is native on the parity model.
//
// Exit 0 when every arm holds the bar, 1 when any misses it or is not
// measured, 2 when the reports cannot be read or compared together.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compareReports, renderComparison, type ComparedReport } from "../src/benchmark/compare";
import { readBenchmarkReport } from "../src/benchmark/report";

function main(argv: readonly string[]): number {
  let reference: string | undefined;
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--reference") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--reference needs an arm");
      reference = next;
      i++;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag ${arg}`);
    } else {
      paths.push(resolve(arg));
    }
  }
  if (paths.length === 0) throw new Error("name at least one report");
  const reports: ComparedReport[] = paths.map((path) => {
    try {
      return { path, report: readBenchmarkReport(JSON.parse(readFileSync(path, "utf8"))) };
    } catch (error) {
      throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const comparison = compareReports(reports, reference);
  console.log(renderComparison(comparison, reports));
  return comparison.readings.every((reading) => reading.verdict === "holds the bar") ? 0 : 1;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  console.error(`benchmark-compare: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
