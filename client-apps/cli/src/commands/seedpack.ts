// `stigmer seedpack apply|status` — manage the embedded system seedpack.
//
// The seedpack (system agents, skills, MCP servers, workflows under the
// "stigmer" org) is applied automatically on `stigmer up` in local mode; these
// commands bootstrap it explicitly against whatever backend is configured
// (local or cloud). Apply is idempotent via a content-hash marker.
//
// Heavy modules load lazily inside the action so `--help` stays fast (DD-001).

import type { Command } from "commander";
import { configDir, dataDir, isCloudMode, load } from "../config/index.js";
import { CommandResult, type OutputFlags, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface ApplyFlags extends OutputFlags {
  force?: boolean;
}

export function registerSeedpack(program: Command): void {
  const seedpack = program.command("seedpack").description("manage the embedded system seedpack");

  const apply = seedpack
    .command("apply")
    .description("apply the seedpack to the configured backend")
    .option("--force", "re-apply even if the seedpack has not changed", false)
    .action((options: ApplyFlags) => runApply(options));
  addResultFlags(apply);

  const status = seedpack
    .command("status")
    .description("show seedpack bootstrap status")
    .action((options: OutputFlags) => runStatus(options));
  addResultFlags(status);
}

async function runApply(flags: ApplyFlags): Promise<void> {
  const [{ connectBackend }, { ensureAuthenticated }, { applySeedpack }] = await Promise.all([
    import("../backend.js"),
    import("../config/index.js"),
    import("../local/seedpack/apply.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const result = await applySeedpack(
    {
      controller: client.controller,
      stigmer: client.stigmer,
      info: (line) => process.stderr.write(`${line}\n`),
      warn: (line) => process.stderr.write(`${line}\n`),
    },
    { markerDir: markerDir(), force: flags.force === true },
  );

  const label = backendLabel();
  const message = result.applied
    ? `Seedpack applied to ${label} backend`
    : `Seedpack already up to date on ${label} backend (use --force to re-apply)`;
  renderResult(CommandResult.success(message), resultFormat(flags));
}

async function runStatus(flags: OutputFlags): Promise<void> {
  const { seedpackContentHash } = await import("../local/seedpack/apply.js");
  const { readMarker } = await import("../local/seedpack/content.js");

  const hash = seedpackContentHash();
  const stored = readMarker(markerDir());

  const result = CommandResult.success("Seedpack status");
  const section = result.addSection("");
  section.field("Backend", backendLabel());
  section.field("Embedded Hash", hash);
  if (stored === null) {
    section.field("Status", "Not applied (run 'stigmer seedpack apply')");
  } else {
    section.field("Applied Hash", stored);
    section.field("Status", stored === hash ? "Up to date" : "Outdated (run 'stigmer seedpack apply' to update)");
  }
  renderResult(result, resultFormat(flags));
}

// Marker lives with the backend's state: the data dir for local, the config dir
// for cloud (mirrors the Go CLI's resolveMarkerDir).
function markerDir(): string {
  return isCloudMode(load()) ? configDir() : dataDir();
}

function backendLabel(): string {
  const config = load();
  if (!isCloudMode(config)) return "local";
  const endpoint = config.backend.cloud?.endpoint ?? "api.stigmer.ai:443";
  return `cloud (${endpoint})`;
}
