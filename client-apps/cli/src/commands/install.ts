// `stigmer install [marketplace/]name[@version]` — install a plugin by name
// from a marketplace. The verb takes a ref, not a kind: a plugin is the one
// thing a marketplace offers, so there is nothing to disambiguate. A folder
// on disk is installed with `stigmer push plugin <dir>`; a path given here is
// refused toward it.
//
// Install is: open the marketplace's tree, find the entry, read its directory
// through the same walker `push plugin` uses, push the archive. The server
// does the rest (materialising skills, servers, the agent), exactly as for a
// push, so an install from a marketplace and a push of the same checked-out
// folder are one digest and one plugin. There is no `uninstall`:
// `stigmer delete plugin <name>` is the one delete verb across kinds.
//
// Heavy modules load lazily inside the action so `--help` stays fast.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { type OutputFlags, renderResult } from "../output/index.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface InstallFlags extends OutputFlags {
  visibility?: string;
  message?: string;
  dryRun?: boolean;
}

export function registerInstall(program: Command): void {
  const install = program
    .command("install <ref>")
    .description(
      "install a plugin from a source by name: [source/]name[@version]",
    )
    .option(
      "--visibility <level>",
      "visibility for the plugin and everything it installs (private, org, platform)",
    )
    .option(
      "-m, --message <message>",
      "version message describing what changed",
    )
    .option(
      "--dry-run",
      "read the marketplace and show what would install, without pushing",
    )
    .action((ref: string, options: InstallFlags, command: Command) =>
      runInstall(ref, options, command),
    );
  addResultFlags(install);
}

async function runInstall(
  refText: string,
  options: InstallFlags,
  command: Command,
): Promise<void> {
  const format = resultFormat(options);
  const m = await import("../marketplace/index.js");
  const plugin = await import("../resources/plugin.js");
  const { parseVisibility } = await import("../resources/skill.js");
  const { CommandResult } = await import("../output/index.js");

  const ref = m.parseInstallRef(refText);
  const visibility = parseVisibility(options.visibility, "--visibility");

  const located = await m.locateEntry(ref, m.listMarketplaces());
  try {
    const prepared = await m.prepareEntry(located.tree, ref.name);
    m.assertVersion(prepared, ref.version, refText);
    const qualified = m.formatInstallRef({
      marketplace: located.marketplace.name,
      name: ref.name,
    });

    if (options.dryRun === true) {
      const result = plugin.describePackageOn(
        CommandResult.success(
          `Dry run: '${qualified}' would install plugin '${prepared.plugin.name}'`,
        ),
        prepared.plugin,
        prepared.warnings,
        prepared.stats,
      );
      result.hint("Run without --dry-run to install it.");
      renderResult(result, format);
      return;
    }

    const { connectBackend } = await import("../backend.js");
    const client = connectBackend();
    ensureAuthenticated(client.config);
    const org = resolveOrganization(client.config, globalOrg(command));
    const outcome = await plugin.pushPrepared(client.stigmer, prepared, {
      org,
      visibility,
      message:
        options.message ??
        `installed from marketplace '${located.marketplace.name}'`,
    });
    renderResult(
      plugin.renderPushOutcome(outcome, {
        installedFrom: `${located.marketplace.name} (${m.describeSource(located.marketplace.source)})`,
        next: await plugin.readNextSteps(client.stigmer, org, outcome.members),
      }),
      format,
    );
  } finally {
    located.open.dispose();
  }
}
