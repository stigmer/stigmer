// `stigmer runs scores <run-id>` — show how good a finished run was: each
// person's thumbs and the platform's run-health checks. Thin handler: resolve
// the client and format, delegate to resources/run-scores.ts. Rating is the
// console's; the CLI only reads.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";
import type { OutputFlags } from "../../output/index.js";
import type { ScoresFormat } from "../../resources/run-scores.js";
import { addReadFlags, readFormat } from "../shared.js";

export function registerRunsScores(runs: Command): void {
  const scores = runs
    .command("scores <run-id>")
    .description("show a run's scores: people's thumbs and the run-health checks")
    .action((runId: string, options: OutputFlags) => runScores(runId, options));
  addReadFlags(scores);
}

async function runScores(runId: string, options: OutputFlags): Promise<void> {
  // Read-class format resolves to exactly table | json | yaml.
  const format = readFormat(options) as ScoresFormat;

  const [{ connectBackend }, { showRunScores }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-scores.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  await showRunScores(client.stigmer, runId, format);
}
