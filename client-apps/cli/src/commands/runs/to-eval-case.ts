// `stigmer runs to-eval-case <run-id>` — turn a run into an eval case the
// server builds: its request, the conversation before it, the tool answers
// it got as mocks, and an AI rubric whose FAIL line names what went wrong.
// Written under --dir on this machine, or added to an eval with --eval.
// Thin handler: resolve the client and the organization, delegate to
// resources/run-to-eval-case.ts, which owns the rules.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../../config/index.js";
import type { ToEvalCaseFlags } from "../../resources/run-to-eval-case.js";
import { globalOrg } from "../shared.js";

export function registerRunsToEvalCase(runs: Command): void {
  runs
    .command("to-eval-case <run-id>")
    .description("turn a run into an eval case: written under evals/, or added to an eval")
    .option("--dir <dir>", "the eval directory to write the case into (default: evals)")
    .option("--name <case>", "the case's name and directory (default: from the run's request)")
    .option("--skill <plugin:skill>", "also check that this skill was read")
    .option("--eval <eval>", "add the case to this eval as a new version instead of writing it here")
    .action((runId: string, options: ToEvalCaseFlags, command: Command) => runToEvalCase(runId, options, command));
}

async function runToEvalCase(runId: string, options: ToEvalCaseFlags, command: Command): Promise<void> {
  const [{ connectBackend }, { writeEvalCaseFromRun }, { access }, { extractArchive }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-to-eval-case.js"),
    import("node:fs/promises"),
    import("../../resources/eval.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  await writeEvalCaseFromRun(
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
}
