// `stigmer runs to-eval-case <run-id>` — turn a run into an eval case the
// server builds: its request, the conversation before it, the tool answers
// it got as mocks, and an AI rubric whose FAIL line names what went wrong.
// Written under --dir on this machine, or added to an eval with --eval.
// Thin handler: resolve the client and the organization, delegate to
// resources/run-to-eval-case.ts, which owns the rules. With `-o json` the
// case's directory (or the eval and its new digest) is printed as JSON.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../../config/index.js";
import type { ToEvalCaseFlags } from "../../resources/run-to-eval-case.js";
import { renderValue } from "../../output/command-result.js";
import type { OutputFlags } from "../../output/format.js";
import { addValueFlags, globalOrg, resultFormat } from "../shared.js";

type Flags = ToEvalCaseFlags & OutputFlags;

export function registerRunsToEvalCase(runs: Command): void {
  const toEvalCase = runs
    .command("to-eval-case <run-id>")
    .description("turn a run into an eval case: written under evals/, or added to an eval")
    .option("--dir <dir>", "the eval directory to write the case into (default: evals)")
    .option("--name <case>", "the case's name and directory (default: from the run's request)")
    .option("--skill <plugin:skill>", "also check that this skill was read")
    .option("--eval <eval>", "add the case to this eval as a new version instead of writing it here")
    .action((runId: string, options: Flags, command: Command) => runToEvalCase(runId, options, command));
  addValueFlags(toEvalCase);
}

async function runToEvalCase(runId: string, options: Flags, command: Command): Promise<void> {
  const format = resultFormat(options);
  const [{ connectBackend }, { writeEvalCaseFromRun }, { access }, { extractArchive }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-to-eval-case.js"),
    import("node:fs/promises"),
    import("../../resources/eval.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const written = await writeEvalCaseFromRun(
    client.stigmer,
    runId,
    options,
    {
      exists: (path) => access(path).then(
        () => true,
        () => false,
      ),
      extract: extractArchive,
      stderr: process.stderr,
    },
    org,
  );
  // The lines above went to stderr; `-o json` adds where the case went.
  if (format === "json") {
    const data = options.eval === undefined ? { runId, caseDir: written } : { runId, eval: options.eval, digest: written };
    renderValue("", data, format);
  }
}
