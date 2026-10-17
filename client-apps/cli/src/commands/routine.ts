// `stigmer routine resume <ref>` — clear a platform auto-pause from a
// routine. `stigmer routine fire <ref>` — run it once, immediately.
//
// The platform pauses a routine after repeated failed runs on its schedule
// and records why in status.paused_reason; resume is the explicit act that
// clears it (the owner's enabled switch is a different lever — see
// docs/vocabulary.md, "Disabled vs. paused"). Fire runs the routine now,
// as its owner, and does not feed the failure streak. Declarative verbs
// stay in the generic matrix (apply/get/list/delete); this group exists for
// the kind-specific operational actions, the `stigmer channel` shape.
//
// Thin handler: resolve credentials/org, delegate to resources/routine,
// render the result. Heavy modules are lazy-imported so `--help` stays
// fast.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import type { OutputFlags } from "../output/index.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

export function registerRoutine(program: Command): void {
  const routine = program.command("routine").description("operate on routines");

  const resume = routine
    .command("resume <ref>")
    .description("clear a platform pause so a routine runs on its schedule again (id, org/slug, or slug)")
    .action((ref: string, options: OutputFlags, command: Command) => runRoutineResume(ref, options, command));
  addResultFlags(resume);

  const fire = routine
    .command("fire <ref>")
    .description("run a routine once, immediately (id, org/slug, or slug)")
    .action((ref: string, options: OutputFlags, command: Command) => runRoutineFire(ref, options, command));
  addResultFlags(fire);
}

async function runRoutineFire(ref: string, options: OutputFlags, command: Command): Promise<void> {
  const format = resultFormat(options);

  const [{ connectBackend }, { fireRoutine }, { renderResult }] = await Promise.all([
    import("../backend.js"),
    import("../resources/routine.js"),
    import("../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const result = await fireRoutine(client.stigmer, ref, org);
  renderResult(result, format);
}

async function runRoutineResume(ref: string, options: OutputFlags, command: Command): Promise<void> {
  const format = resultFormat(options);

  const [{ connectBackend }, { resumeRoutine }, { renderResult }] = await Promise.all([
    import("../backend.js"),
    import("../resources/routine.js"),
    import("../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const result = await resumeRoutine(client.stigmer, ref, org);
  renderResult(result, format);
}
