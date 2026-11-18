// `stigmer docs search|read` — find and read Stigmer's documentation at
// stigmer.ai/docs from the terminal, so a person, or the coding agent working
// with them, answers from what the docs say today and cites the page.
//
// No backend and no sign-in: it reads the public site, so it works before
// `stigmer auth login`, for someone still deciding. The reader is the tool
// server's (`@stigmer/mcp-server/docs`, the same code its search_docs and
// read_doc tools run), imported through its own subpath so this command loads
// a few kilobytes, not the server. `read` prints the page's Markdown export
// whole, opening with its `Source:` URL; `-o json` prints `{results}` or
// `{url, markdown}`.

import type { Command } from "commander";
import { ExitCode } from "@stigmer/client/exit-codes";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { UsageError } from "../../errors/usage-error.js";
import { type OutputFlags, renderValue } from "../../output/index.js";
import { addValueFlags, resultFormat } from "../shared.js";

export function registerDocs(program: Command): void {
  const docs = program
    .command("docs")
    .description("search and read Stigmer's documentation at stigmer.ai/docs");

  const search = docs
    .command("search")
    .description("list the documentation pages that best match some words")
    .argument("<words...>", "what the question is about")
    .action(async (words: string[], options: OutputFlags) => {
      const { formatHits, sharedDocsReader } = await import("@stigmer/mcp-server/docs");
      const query = words.join(" ");
      const results = await asCliError(() => sharedDocsReader().searchDocs(query));
      renderValue(formatHits(query, results), { results }, resultFormat(options));
    });
  addValueFlags(search);

  const read = docs
    .command("read")
    .description("print one documentation page whole, as Markdown")
    .argument("<page>", "the page's path after /docs/ (concepts/tools) or its full URL")
    .action(async (page: string, options: OutputFlags) => {
      const { sharedDocsReader } = await import("@stigmer/mcp-server/docs");
      const { url, markdown } = await asCliError(() => sharedDocsReader().readDocPage(page));
      renderValue(markdown, { url, markdown }, resultFormat(options));
    });
  addValueFlags(read);
}

/**
 * Run a docs read, saying its failure as the CLI does: a page outside the
 * docs is a usage error, a missing page not-found, an unreachable site a
 * connection failure.
 */
export async function asCliError<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const kind = (error as { kind?: unknown }).kind;
    const message = error instanceof Error ? error.message : String(error);
    if (kind === "refused") throw new UsageError(message);
    if (kind === "not-found") throw new CliExitError(message, ExitCode.NotFound, ["Find the page's path:", "  stigmer docs search <words>"]);
    if (kind === "unreachable") throw new CliExitError(message, ExitCode.Connection);
    throw error;
  }
}
