// `stigmer channel link <agent>` — turn an agent's chat link on
// (organization members, unless `--audience public`) or off (--off),
// printing the hosted chat link and embed snippet. `stigmer channel enable
// <channel>` and `stigmer channel disable <channel>` — flip any channel's
// switch (web, Slack or WhatsApp); disabling pauses it and keeps its
// configuration, where `delete channel` tears it down.
//
// A noun group beside the verb-first matrix, as `routine` is: the
// declarative verbs on channels stay generic (apply/get/list/delete), and
// this group holds the kind's operational actions, which no generic verb
// carries.
//
// Thin handler: resolve credentials/org and the console origin, delegate to
// resources/channel, render the result. `--open` is a best-effort browser
// launch after render (mirrors auth login: the URL is already on screen, so
// a failed launch costs nothing). Heavy modules are lazy-imported so
// `--help` stays fast.

import type { Command } from "commander";
import {
  activeBackend,
  ensureAuthenticated,
  resolveConsoleURL,
  resolveOrganization,
} from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags } from "../output/index.js";
import type { LinkAudience } from "../resources/channel.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface LinkFlags extends OutputFlags {
  off?: boolean;
  open?: boolean;
  audience?: string;
  resetLink?: boolean;
  name?: string;
}

export function registerChannel(program: Command): void {
  const channel = program
    .command("channel")
    .description("operate on channels: chat links, and switching a channel on or off");

  const link = channel
    .command("link <agent>")
    .description(
      "turn an agent's chat link on and print the link and embed snippet",
    )
    .option("--off", "turn the chat link off (the link stops working immediately)")
    .option(
      "--audience <audience>",
      "who can chat: 'public' (anyone with the link) or 'org' (signed-in organization members only); omit to keep the current audience (organization for a new link)",
    )
    .option(
      "--reset-link",
      "generate a new link and kill the current one immediately (public audience)",
    )
    .option(
      "--name <slug>",
      "the chat link's slug: edit that web channel of the agent, or create the link under it (default: <agent slug>-web)",
    )
    .option("--open", "open the chat link in your browser")
    .action((ref: string, options: LinkFlags, command: Command) =>
      runChannelLink(ref, options, command),
    );
  addResultFlags(link);

  const enable = channel
    .command("enable <channel>")
    .description("turn a channel on (id, org/slug, or slug)")
    .action((ref: string, options: OutputFlags, command: Command) =>
      runChannelSwitch(ref, true, options, command),
    );
  addResultFlags(enable);

  const disable = channel
    .command("disable <channel>")
    .description(
      "pause a channel, keeping its configuration (id, org/slug, or slug)",
    )
    .action((ref: string, options: OutputFlags, command: Command) =>
      runChannelSwitch(ref, false, options, command),
    );
  addResultFlags(disable);
}

// Validates --audience before any network work; omitted means "preserve".
function parseAudience(value: string | undefined): LinkAudience | undefined {
  if (value === undefined) return undefined;
  if (value === "public" || value === "org") return value;
  throw new UsageError(
    `invalid --audience '${value}'\n\nExpected 'public' or 'org'.`,
  );
}

async function runChannelLink(
  ref: string,
  options: LinkFlags,
  command: Command,
): Promise<void> {
  const format = resultFormat(options);

  const [{ connectBackend }, { linkAgent }, { renderResult }] =
    await Promise.all([
      import("../backend.js"),
      import("../resources/channel.js"),
      import("../output/command-result.js"),
    ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const appOrigin = resolveConsoleURL(client.config);
  const enabled = options.off !== true;
  const audience = parseAudience(options.audience);
  const resetLink = options.resetLink === true;
  if (resetLink && !enabled) {
    throw new UsageError(
      "--reset-link cannot be combined with --off\n\n" +
        "Turning the link off already kills it. Reset is for keeping the\n" +
        "link on while invalidating the current URL.",
    );
  }
  if (options.name === "") {
    throw new UsageError("--name needs a slug\n\nOmit it for the agent's own chat link.");
  }

  const result = await linkAgent(client.stigmer, ref, org, {
    enabled,
    ...(audience !== undefined ? { audience } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    resetLink,
    appOrigin,
    isLocal: activeBackend(client.config).entry === undefined,
  });
  renderResult(result, format);

  if (options.open === true && enabled) {
    // Best-effort: the link is already rendered above, so a launch failure
    // only needs a nudge, never an error exit (mirrors auth login).
    const url = result.sections.find((s) => s.title.endsWith("chat link"))
      ?.items[0];
    if (url !== undefined) {
      try {
        const { default: open } = await import("open");
        await open(url);
      } catch {
        process.stderr.write(
          "Could not open the browser automatically. Please open the link above.\n",
        );
      }
    }
  }
}

async function runChannelSwitch(
  ref: string,
  enabled: boolean,
  options: OutputFlags,
  command: Command,
): Promise<void> {
  const format = resultFormat(options);

  const [{ connectBackend }, { setChannelEnabled }, { renderResult }] =
    await Promise.all([
      import("../backend.js"),
      import("../resources/channel.js"),
      import("../output/command-result.js"),
    ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const result = await setChannelEnabled(client.stigmer, ref, org, enabled);
  renderResult(result, format);
}
