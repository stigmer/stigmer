// `stigmer routine resume <ref>` — clear a platform auto-pause from a
// routine. `stigmer routine fire <ref> [--text <text>]` — run it once,
// immediately, with an optional note for that run. `stigmer routine fires
// <ref>` — its fire history: when each run started, who or what started it,
// and how it went.
//
// The platform pauses a routine after repeated failed runs on its schedule
// and records why in status.paused_reason; resume is the explicit act that
// clears it (the owner's enabled switch is a different lever — see
// docs/vocabulary.md, "Disabled vs. paused"). Fire runs the routine now,
// as its owner, and does not feed the failure streak. Declarative verbs
// stay in the generic matrix (apply/get/list/delete); this group exists for
// the kind-specific operational actions, the `stigmer channel` shape.
//
// `--text` is the contract's own word (FireRoutineInput.text), not
// `--message`, which would read as replacing the routine's saved message.
// It takes the note inline only: a file or a pipe is the shell's job
// (`--text "$(cat alert.txt)"`), as for every other message flag, and the
// server's bound on its length answers in the server's words.
//
// Thin handler: resolve credentials/org, delegate to resources/routine,
// render the result. Heavy modules are lazy-imported so `--help` stays
// fast.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/usage-error.js";
import type { OutputFlags } from "../output/index.js";
import type { FiresFormat } from "../resources/routine.js";
import { addReadFlags, addResultFlags, globalOrg, readFormat, resultFormat } from "./shared.js";

interface FireFlags extends OutputFlags {
  text?: string;
}

interface FiresFlags extends OutputFlags {
  limit?: string;
}

const DEFAULT_FIRES_LIMIT = 50;

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
    .option("--text <text>", "a note for this run, such as the alert that prompted it")
    .action((ref: string, options: FireFlags, command: Command) => runRoutineFire(ref, options, command));
  addResultFlags(fire);

  const fires = routine
    .command("fires <ref>")
    .description("list a routine's fires: when each started, who started it, and how it went (id, org/slug, or slug)")
    .option("--limit <n>", `the most fires to list, newest first (default ${DEFAULT_FIRES_LIMIT}; 0 lists them all)`)
    .action((ref: string, options: FiresFlags, command: Command) => runRoutineFires(ref, options, command));
  addReadFlags(fires);
}

async function runRoutineFire(ref: string, options: FireFlags, command: Command): Promise<void> {
  const format = resultFormat(options);

  const [{ connectBackend }, { fireRoutine }, { renderResult }] = await Promise.all([
    import("../backend.js"),
    import("../resources/routine.js"),
    import("../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const result = await fireRoutine(client.stigmer, ref, org, options.text);
  renderResult(result, format);
}

async function runRoutineFires(ref: string, options: FiresFlags, command: Command): Promise<void> {
  // Read-class format resolves to exactly table | json | yaml.
  const format = readFormat(options) as FiresFormat;
  const limit = parseLimit(options.limit);

  const [{ connectBackend }, { showRoutineFires }] = await Promise.all([
    import("../backend.js"),
    import("../resources/routine.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  await showRoutineFires(client.stigmer, ref, org, limit, format);
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

/** `--limit` as `stigmer list` reads it: a count, where 0 reads every page. */
function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_FIRES_LIMIT;
  if (!/^\d+$/.test(raw)) throw new UsageError(`invalid --limit value "${raw}"`);
  return Number.parseInt(raw, 10);
}
