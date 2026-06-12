// `stigmer get <type> <reference>` — fetch a single resource.
//
// Thin handler: resolve the kind via the registry, verify verb support, then
// delegate to the resource layer. Heavy modules (backend client, SDK schemas)
// are dynamically imported inside the action so `--help` stays fast (DD-001).

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags } from "../output/index.js";
import { defaultRegistry, Verb } from "../registry/index.js";
import { addReadFlags, globalOrg, readFormat } from "./shared.js";

export function registerGet(program: Command): void {
  const get = program
    .command("get <type> <reference>")
    .description("get a resource by type and reference (slug, org/slug, or ID)")
    .action((type: string, reference: string, options: OutputFlags, command: Command) =>
      runGet(type, reference, options, command),
    );
  addReadFlags(get);
}

async function runGet(type: string, reference: string, options: OutputFlags, command: Command): Promise<void> {
  const info = defaultRegistry().getByAlias(type);
  if (info === undefined) {
    throw new UsageError(`unknown resource type: ${type}`);
  }
  if (!info.supportedVerbs.has(Verb.Get)) {
    throw new UsageError(`${info.displayName} does not support 'get'`);
  }

  const [{ connectBackend }, { parseReference }, { fetchResource }, { renderResource }] = await Promise.all([
    import("../backend.js"),
    import("../resources/reference.js"),
    import("../resources/get.js"),
    import("../resources/render.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const parsed = parseReference(reference, org, info.idPrefix);

  const { schema, message } = await fetchResource(client.stigmer, info.kind, parsed);
  process.stdout.write(renderResource(schema, message, readFormat(options)));
}
