// `stigmer delete <type> <reference>` — delete a resource by type and reference.
//
// Thin handler: resolve credentials/org, ask the resource layer for a delete
// plan, run the confirmation interaction, then perform and render. The plan
// (resources/delete.ts) owns what to delete and how to describe it; this file
// owns only the prompt flow and stream wiring. Heavy modules are lazy-imported
// inside the action so `--help` stays fast (DD-001).

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import type { OutputFlags } from "../output/index.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface DeleteFlags extends OutputFlags {
  force?: boolean;
}

export function registerDelete(program: Command): void {
  const del = program
    .command("delete <type> <reference>")
    .description("delete a resource by type and reference (slug, org/slug, or ID)")
    .option("-f, --force", "skip the confirmation prompt and acknowledge destructive side effects (e.g. destroying a datastore's records)")
    .action((type: string, reference: string, options: DeleteFlags, command: Command) =>
      runDelete(type, reference, options, command),
    );
  addResultFlags(del);
}

async function runDelete(type: string, reference: string, options: DeleteFlags, command: Command): Promise<void> {
  const format = resultFormat(options);

  const [{ connectBackend }, { planDelete }, { confirm }, { renderResult }] = await Promise.all([
    import("../backend.js"),
    import("../resources/delete.js"),
    import("../output/confirm.js"),
    import("../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  // `-f/--force` carries double duty by design: it skips the prompt below AND
  // rides the delete RPC as the force acknowledgment for kinds with
  // server-side destruction guards (e.g. a non-empty datastore).
  const plan = await planDelete(client.stigmer, type, reference, org, options.force === true);

  if (options.force !== true) {
    renderResult(plan.warning, format);
    const confirmed = await confirm(plan.confirmPrompt);
    if (!confirmed) {
      // User declined (or no TTY): a clean, intentional no-op — exit 0.
      process.stderr.write("Aborted.\n");
      return;
    }
  }

  renderResult(await plan.perform(), format);
}
