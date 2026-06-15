// `stigmer tag <type> <org/slug> <hash> <tag>` — assign a tag to a resource
// version. Thin handler: resolve credentials/org, delegate to the resource
// layer, render the result. Heavy modules are lazy-imported (DD-001).

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { globalOrg } from "./shared.js";

export function registerTag(program: Command): void {
  program
    .command("tag <type> <org/slug> <hash> <tag>")
    .description("assign a tag to a resource version (supported types: workflow)")
    .action((type: string, ref: string, hash: string, tag: string, _options: unknown, command: Command) =>
      runTag(type, ref, hash, tag, command),
    );
}

async function runTag(type: string, ref: string, hash: string, tag: string, command: Command): Promise<void> {
  const [{ connectBackend }, { tagVersion }, { renderResult }] = await Promise.all([
    import("../backend.js"),
    import("../resources/tag.js"),
    import("../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const result = await tagVersion(client.stigmer, type, ref, hash, tag, org);
  renderResult(result, "human");
}
