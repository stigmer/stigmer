// `stigmer tag <type> <org/slug> <hash> <tag>` — assign a tag to a resource
// version. Tags are mutable pointers: assigning an existing tag to a new version
// moves it. Only workflows are versioned/taggable today, matching the Go CLI.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
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
  const normalized = type.trim().toLowerCase();
  if (normalized !== "workflow" && normalized !== "wf") {
    throw new UsageError(`tagging is not supported for resource type "${type}"\n\nSupported types: workflow`);
  }

  const [{ connectBackend }, { create }, { TagWorkflowVersionInputSchema }, { CommandResult, renderResult }] =
    await Promise.all([
      import("../backend.js"),
      import("@bufbuild/protobuf"),
      import("@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb"),
      import("../output/command-result.js"),
    ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const [refOrg, slug] = parseOrgSlug(ref, org);
  const workflow = await client.stigmer.workflow.getByReference({ org: refOrg, slug });
  const workflowId = workflow.metadata?.id ?? "";

  await client.stigmer.workflow.tagVersion(
    create(TagWorkflowVersionInputSchema, { workflowId, versionHash: hash, tag }),
  );

  renderResult(CommandResult.success(`Tagged version ${truncateHash(hash)} as '${tag}'`), "human");
}

// "org/slug" → [org, slug]; a bare token uses the resolved org context.
function parseOrgSlug(ref: string, defaultOrg: string): [string, string] {
  const slash = ref.indexOf("/");
  if (slash > 0) {
    return [ref.slice(0, slash), ref.slice(slash + 1)];
  }
  return [defaultOrg, ref];
}

// The backend addresses versions by their full content hash; the CLI echoes a
// 12-char prefix for readability, matching Go's truncateHash.
function truncateHash(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) : hash;
}
