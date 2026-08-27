// `stigmer share agent <ref>` — enable (default) or disable (--off) public
// sharing for an agent, printing the hosted chat link and embed snippet.
//
// Thin handler: resolve credentials/org and the console origin, delegate the
// merge-preserving toggle to resources/share, render the result. `--open` is a
// best-effort browser launch after render (mirrors auth login: the URL is
// already on screen, so a failed launch costs nothing). Heavy modules are
// lazy-imported so `--help` stays fast (DD-001).

import type { Command } from "commander";
import {
  activeBackend,
  ensureAuthenticated,
  resolveConsoleURL,
  resolveOrganization,
} from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags } from "../output/index.js";
import type { ShareAudience } from "../resources/share.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface ShareAgentFlags extends OutputFlags {
  off?: boolean;
  open?: boolean;
  audience?: string;
  resetLink?: boolean;
}

export function registerShare(program: Command): void {
  const share = program
    .command("share")
    .description("share resources via a hosted link");

  const agent = share
    .command("agent <ref>")
    .description(
      "enable sharing for an agent and print its chat link and embed snippet",
    )
    .option("--off", "disable sharing (the link stops working immediately)")
    .option(
      "--audience <audience>",
      "who can chat: 'public' (anyone with the link) or 'org' (signed-in organization members only); omit to keep the current audience",
    )
    .option(
      "--reset-link",
      "generate a new share link and kill the current one immediately (public audience)",
    )
    .option("--open", "open the chat link in your browser")
    .action((ref: string, options: ShareAgentFlags, command: Command) =>
      runShareAgent(ref, options, command),
    );
  addResultFlags(agent);
}

// Validates --audience before any network work; omitted means "preserve".
function parseAudience(value: string | undefined): ShareAudience | undefined {
  if (value === undefined) return undefined;
  if (value === "public" || value === "org") return value;
  throw new UsageError(
    `invalid --audience '${value}'\n\nExpected 'public' or 'org'.`,
  );
}

async function runShareAgent(
  ref: string,
  options: ShareAgentFlags,
  command: Command,
): Promise<void> {
  const format = resultFormat(options);

  const [{ connectBackend }, { shareAgent }, { renderResult }] =
    await Promise.all([
      import("../backend.js"),
      import("../resources/share.js"),
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
        "Disabling sharing already kills the link. Reset is for keeping\n" +
        "sharing on while invalidating the current URL.",
    );
  }

  const result = await shareAgent(client.stigmer, ref, org, {
    enabled,
    ...(audience !== undefined ? { audience } : {}),
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
