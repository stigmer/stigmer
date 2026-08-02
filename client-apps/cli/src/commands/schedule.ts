// `stigmer schedule resume <ref>` — clear a platform auto-pause from a
// schedule. `stigmer schedule trigger <ref>` — fire it once, immediately.
//
// The platform pauses a schedule after repeated failed runs and records
// why in status.paused_reason; resume is the owner's explicit act that
// clears it (the owner's enabled switch is a different lever — see
// docs/vocabulary.md, "Disabled vs. paused"). Trigger fires the schedule
// through its own clock (DD-014), so everything a cron fire does applies
// — including feeding the failure streak. Declarative verbs stay in the
// generic matrix (apply/get/list/delete); this group exists for the
// kind-specific operational actions, the `stigmer share` shape.
//
// Thin handler: resolve credentials/org, delegate to resources/schedule,
// render the result. Heavy modules are lazy-imported so `--help` stays
// fast (DD-001).

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import type { OutputFlags } from "../output/index.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

export function registerSchedule(program: Command): void {
  const schedule = program.command("schedule").description("operate on schedules");

  const resume = schedule
    .command("resume <ref>")
    .description("clear a platform pause so a schedule fires again (id, org/slug, or slug)")
    .action((ref: string, options: OutputFlags, command: Command) => runScheduleResume(ref, options, command));
  addResultFlags(resume);

  const trigger = schedule
    .command("trigger <ref>")
    .description("fire a schedule once, immediately (id, org/slug, or slug)")
    .action((ref: string, options: OutputFlags, command: Command) => runScheduleTrigger(ref, options, command));
  addResultFlags(trigger);
}

async function runScheduleTrigger(ref: string, options: OutputFlags, command: Command): Promise<void> {
  const format = resultFormat(options);

  const [{ connectBackend }, { triggerSchedule }, { renderResult }] = await Promise.all([
    import("../backend.js"),
    import("../resources/schedule.js"),
    import("../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const result = await triggerSchedule(client.stigmer, ref, org);
  renderResult(result, format);
}

async function runScheduleResume(ref: string, options: OutputFlags, command: Command): Promise<void> {
  const format = resultFormat(options);

  const [{ connectBackend }, { resumeSchedule }, { renderResult }] = await Promise.all([
    import("../backend.js"),
    import("../resources/schedule.js"),
    import("../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const result = await resumeSchedule(client.stigmer, ref, org);
  renderResult(result, format);
}
