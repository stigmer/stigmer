// `tag` dispatch: assign a tag to a versioned resource. Tags are mutable
// pointers — reassigning a tag moves it to the named version. Only workflows are
// versioned/taggable today, matching the Go CLI's tag command.
//
// This is an id-shaped mutation, so it rides the high-level workflow sub-client
// (resolve the workflow by reference, then tagVersion) rather than a raw
// controller.

import { create } from "@bufbuild/protobuf";
import { TagWorkflowVersionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";

export async function tagVersion(
  client: Stigmer,
  typeArg: string,
  ref: string,
  hash: string,
  tag: string,
  org: string,
): Promise<CommandResult> {
  const normalized = typeArg.trim().toLowerCase();
  if (normalized !== "workflow" && normalized !== "wf") {
    throw new UsageError(`tagging is not supported for resource type "${typeArg}"\n\nSupported types: workflow`);
  }

  const [refOrg, slug] = parseOrgSlug(ref, org);
  const workflow = await client.workflow.getByReference({ org: refOrg, slug });
  const workflowId = workflow.metadata?.id ?? "";

  await client.workflow.tagVersion(create(TagWorkflowVersionInputSchema, { workflowId, versionHash: hash, tag }));

  return CommandResult.success(`Tagged version ${truncateHash(hash)} as '${tag}'`);
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
