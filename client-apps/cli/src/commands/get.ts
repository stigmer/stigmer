// `stigmer get <type> <reference>` — fetch a single resource.
//
// Thin handler: route the two non-registry special cases (executions, addressed
// by `aex_`/`wex_` ID; workflow version history/retrieval) first, then the
// registry-driven standard path. Heavy modules (backend client, SDK schemas)
// are dynamically imported inside the action so `--help` stays fast (DD-001).

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import type { OutputFlags } from "../output/index.js";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { defaultRegistry, Verb } from "../registry/index.js";
import { addReadFlags, globalOrg, readFormat } from "./shared.js";

interface GetFlags extends OutputFlags {
  version?: string;
  versionHistory?: boolean;
}

export function registerGet(program: Command): void {
  const get = program
    .command("get <type> <reference>")
    .description("get a resource by type and reference (slug, org/slug, or ID)")
    .option("--version <hashOrTag>", "fetch a specific version by hash or tag (workflows only)")
    .option("--version-history", "show the version history timeline (workflows only)")
    .action((type: string, reference: string, options: GetFlags, command: Command) =>
      runGet(type, reference, options, command),
    );
  addReadFlags(get);
}

async function runGet(type: string, reference: string, options: GetFlags, command: Command): Promise<void> {
  const { isExecutionAlias } = await import("../resources/execution.js");
  if (isExecutionAlias(type)) {
    await runGetExecution(reference, options, command);
    return;
  }

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

  // Workflow versioning is the only versioned read surface today (Go ignores the
  // flags for other kinds, returning the current resource).
  if (info.kind === ApiResourceKind.workflow && (options.versionHistory === true || (options.version ?? "") !== "")) {
    const [refOrg, slug] = parseOrgSlug(reference, org);
    const { renderWorkflowVersionHistory, getWorkflowVersionYaml } = await import("../resources/version.js");
    if (options.versionHistory === true) {
      process.stdout.write(await renderWorkflowVersionHistory(client.stigmer, refOrg, slug));
    } else {
      process.stdout.write(await getWorkflowVersionYaml(client.stigmer, refOrg, slug, options.version ?? ""));
    }
    return;
  }

  const parsed = parseReference(reference, org, info.idPrefix);
  const { schema, message } = await fetchResource(client.stigmer, info.kind, parsed);
  process.stdout.write(renderResource(schema, message, readFormat(options)));
}

async function runGetExecution(reference: string, options: GetFlags, command: Command): Promise<void> {
  const [{ connectBackend }, { getExecution }, { renderResource }] = await Promise.all([
    import("../backend.js"),
    import("../resources/execution.js"),
    import("../resources/render.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  // Executions are addressed by ID; org context is irrelevant. `getExecution`
  // resolves agent-vs-workflow by prefix and throws a usage error otherwise.
  void globalOrg(command);

  const { schema, message } = await getExecution(client.stigmer, reference);
  process.stdout.write(renderResource(schema, message, readFormat(options)));
}

// Splits "org/slug" into its parts; a bare token uses the resolved org context.
function parseOrgSlug(reference: string, org: string): [string, string] {
  const idx = reference.indexOf("/");
  if (idx > 0) return [reference.slice(0, idx), reference.slice(idx + 1)];
  return [org, reference];
}
