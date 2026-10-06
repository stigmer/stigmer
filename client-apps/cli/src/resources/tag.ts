// `tag` dispatch: assign a tag to a versioned resource. Tags are mutable
// pointers — reassigning a tag moves it to the named version. Agents carry a
// tag RPC; skills and plugins are tagged when they are pushed.
//
// This is an id-shaped mutation, so it rides the high-level sub-clients
// (resolve the resource by reference, then tagVersion) rather than a raw
// controller.

import { create } from "@bufbuild/protobuf";
import { TagAgentVersionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";

/** The resource types a tag can be assigned to, by the aliases the CLI accepts. */
const TAGGABLE: ReadonlySet<string> = new Set(["agent"]);

export async function tagVersion(
  client: Stigmer,
  typeArg: string,
  ref: string,
  hash: string,
  tag: string,
  org: string,
): Promise<CommandResult> {
  if (!TAGGABLE.has(typeArg.trim().toLowerCase())) {
    throw new UsageError(`tagging is not supported for resource type "${typeArg}"\n\nSupported types: agent`);
  }

  const [refOrg, slug] = parseOrgSlug(ref, org);
  const agent = await client.agent.getByReference({ org: refOrg, slug });
  const agentId = agent.metadata?.id ?? "";
  await client.agent.tagVersion(create(TagAgentVersionInputSchema, { agentId, versionHash: hash, tag }));

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
