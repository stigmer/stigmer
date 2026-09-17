// `stigmer marketplace add|list|show|remove` — the plugin marketplaces this
// CLI installs from. A noun group, like `config` and `auth`, because a
// marketplace is client-side configuration rather than a resource kind: the
// server never sees one, only the plugin archive a client pushes from it.
//
// `list` is offline (the config file alone). `add` and `show` fetch the tree
// once, so `add` also proves the source is a readable marketplace before it
// is recorded, and the recorded name is the one the marketplace file gives
// itself unless `--name` says otherwise. Nothing is cached; `show` reads the
// source every time and says so in its docs.
//
// Heavy modules load lazily inside the action so `--help` stays fast.

import type { Command } from "commander";
import { type OutputFlags, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface AddFlags extends OutputFlags {
  name?: string;
}

export function registerMarketplace(program: Command): void {
  const marketplace = program
    .command("marketplace")
    .description("manage the plugin marketplaces you install from");

  const add = marketplace
    .command("add <source>")
    .description(
      "add a marketplace: a directory, a GitHub 'owner/repo[@ref]', or that repository's URL",
    )
    .option(
      "--name <name>",
      "the name to install from (defaults to the name the marketplace file gives itself)",
    )
    .action((source: string, options: AddFlags) => runAdd(source, options));
  addResultFlags(add);

  const list = marketplace
    .command("list")
    .description("list the configured marketplaces (offline)")
    .action((options: OutputFlags) => runList(options));
  addResultFlags(list);

  const show = marketplace
    .command("show <name>")
    .description("show the plugins a marketplace offers (reads its source)")
    .action((name: string, options: OutputFlags) => runShow(name, options));
  addResultFlags(show);

  const remove = marketplace
    .command("remove <name>")
    .description("remove a configured marketplace (installed plugins stay)")
    .action((name: string, options: OutputFlags) => runRemove(name, options));
  addResultFlags(remove);
}

async function runAdd(source: string, flags: AddFlags): Promise<void> {
  const format = resultFormat(flags);
  const m = await import("../marketplace/index.js");
  const { CommandResult } = await import("../output/index.js");
  const { UsageError } = await import("../errors/index.js");
  const { isValidPluginName } = await import("@stigmer/plugin-package");

  const parsed = m.parseAddSource(source);
  if (flags.name !== undefined && !isValidPluginName(flags.name)) {
    throw new UsageError(
      `'${flags.name}' is not a marketplace name\n\nA name is lowercase letters, digits, '.' and '-', like 'cursor-plugins'.`,
    );
  }

  // Read before recording: an entry that cannot be read is a mistake caught
  // now, not on the first install, and the file's own name is the default.
  const { name, offered } = await m.withMarketplace(parsed, (open) => {
    const tree = m.readMarketplaceTree(open.root, m.describeSource(parsed));
    return {
      name: flags.name ?? tree.marketplace.name,
      offered: tree.marketplace.plugins.length,
    };
  });
  m.addMarketplace(name, parsed);

  const result = CommandResult.success(
    `Added marketplace '${name}' (${m.describeSource(parsed)}), offering ${offered} plugin${offered === 1 ? "" : "s"}`,
  );
  result.hint(`See what it offers with: stigmer marketplace show ${name}`);
  result.hint(`Install from it with:     stigmer install ${name}/<plugin>`);
  renderResult(
    result.withData({ name, source: parsed, plugins: offered }),
    format,
  );
}

async function runList(flags: OutputFlags): Promise<void> {
  const format = resultFormat(flags);
  const m = await import("../marketplace/index.js");
  renderResult(m.renderMarketplaceList(m.listMarketplaces()), format);
}

async function runShow(name: string, flags: OutputFlags): Promise<void> {
  const format = resultFormat(flags);
  const m = await import("../marketplace/index.js");
  const { UsageError } = await import("../errors/index.js");

  const marketplace = m.findMarketplace(name);
  if (marketplace === undefined) {
    throw new UsageError(
      `no marketplace named '${name}' is configured\n\nRun 'stigmer marketplace list' to see the configured names.`,
    );
  }
  const result = await m.withMarketplace(marketplace.source, (open) => {
    const tree = m.readMarketplaceTree(
      open.root,
      m.describeSource(marketplace.source),
    );
    return m.renderMarketplaceShow(marketplace, tree, m.inspectEntries(tree));
  });
  renderResult(result, format);
}

async function runRemove(name: string, flags: OutputFlags): Promise<void> {
  const format = resultFormat(flags);
  const m = await import("../marketplace/index.js");
  const { CommandResult } = await import("../output/index.js");
  m.removeMarketplace(name);
  const result = CommandResult.success(`Removed marketplace '${name}'`);
  result.hint(
    "Plugins installed from it stay installed; remove one with: stigmer delete plugin <name>",
  );
  renderResult(result, format);
}
