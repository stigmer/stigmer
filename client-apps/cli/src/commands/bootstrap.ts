// `stigmer bootstrap` — make the configured backend ready for the CLI: the
// organization it falls back to when none is named (`stigmer`) exists.
// `stigmer up` does this for the local stack on its own; this verb is for a
// raw self-hosted server behind docker-compose or Helm, and runs the very
// same act (local/bootstrap.ts), so "ready" has one meaning everywhere. A
// team that created its organization in the console points the CLI at that
// one instead (`stigmer config context set --org`) and needs no bootstrap.
//
// Flagless on purpose: the act is idempotent, so there is nothing to force;
// a second run changes nothing and says so. It never deletes anything.
// Heavy modules load lazily inside the action so `--help` stays fast.

import type { Command } from "commander";
import { DEFAULT_LOCAL_ORG, ensureAuthenticated } from "../config/index.js";
import { CommandResult, type OutputFlags, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

export function registerBootstrap(program: Command): void {
  const bootstrap = program
    .command("bootstrap")
    .description(
      "make the configured backend ready: ensure the organization the CLI uses when none is named",
    )
    .action((options: OutputFlags) => runBootstrapCommand(options));
  addResultFlags(bootstrap);
}

async function runBootstrapCommand(flags: OutputFlags): Promise<void> {
  const [{ connectBackend }, { bootstrapBackend }] = await Promise.all([
    import("../backend.js"),
    import("../local/bootstrap.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const state = await bootstrapBackend(client.stigmer);

  const out = CommandResult.success("Backend is ready");
  out.addSection("Organization").field("Slug", DEFAULT_LOCAL_ORG).field("State", state);
  renderResult(out, resultFormat(flags));
}
