// `stigmer runs to-eval-case <run-id>` — write a run as a test case folder
// in the local plugin's evals/ directory: its request as prompt.md, an AI
// rubric whose FAIL line names what went wrong, and, with --skill, a check
// that the skill fired. Thin handler: resolve the client, delegate to
// resources/run-to-eval-case.ts, which owns the rules.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";
import type { ToEvalCaseFlags } from "../../resources/run-to-eval-case.js";

export function registerRunsToEvalCase(runs: Command): void {
  runs
    .command("to-eval-case <run-id>")
    .description("write a run as a test case in the local plugin's evals/ folder")
    .option("--dir <dir>", "the plugin's eval directory to write into", "evals")
    .option("--name <case>", "the case's name and directory (default: from the run's request)")
    .option("--skill <plugin:skill>", "also check that this skill of the plugin fired")
    .action((runId: string, options: ToEvalCaseFlags) => runToEvalCase(runId, options));
}

async function runToEvalCase(runId: string, options: ToEvalCaseFlags): Promise<void> {
  const [{ connectBackend }, { writeEvalCaseFromRun }, { mkdir, writeFile, access }, { dirname }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-to-eval-case.js"),
    import("node:fs/promises"),
    import("node:path"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  await writeEvalCaseFromRun(client.stigmer, runId, options, {
    exists: (path) => access(path).then(
      () => true,
      () => false,
    ),
    writeFile: async (path, content) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, { encoding: "utf8", flag: "wx" });
    },
    stderr: process.stderr,
  });
}
