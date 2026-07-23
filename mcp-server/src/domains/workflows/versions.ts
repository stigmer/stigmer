// Workflow versioning paths: the version timeline (listVersions), a pinned
// historical version (getVersion, surfaced through get_workflow's optional
// version argument), and tag assignment (tagVersion).
//
// Version identity is the SHA-256 content hash of the validated CNCF YAML;
// tags are mutable pointers onto hashes. getVersion and tagVersion address by
// workflow ID + full hash — no tag or slug resolution server-side — so the
// tools here do the org/slug → ID two-step, and tag → hash mapping goes
// through the timeline (the tool descriptions teach the model that sequence).
//
// The timeline projection strips validated_yaml from every entry: the backend
// embeds each version's full workflow YAML, which would multiply a 50-entry
// page into 50 documents. The timeline answers "what versions exist"; the
// YAML of one version comes from get_workflow with that version's hash.

import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  type ListWorkflowVersionsInputSchema,
  ListWorkflowVersionsResponseSchema,
  WorkflowVersionEntrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withClient, withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

export interface ListWorkflowVersionsArgs {
  readonly org: string;
  readonly slug: string;
  readonly pageSize?: number;
  readonly pageToken?: string;
}

/**
 * List a workflow's version history (newest first), with validated_yaml
 * stripped from every entry (see file header).
 */
export async function listWorkflowVersions(
  serverAddress: string,
  token: string,
  args: ListWorkflowVersionsArgs,
): Promise<string> {
  return withClient(WorkflowQueryController, serverAddress, token, async (client, callOptions) => {
    const req: MessageInitShape<typeof ListWorkflowVersionsInputSchema> = {
      org: args.org,
      slug: args.slug,
      pageToken: args.pageToken ?? "",
    };
    // Forward page_size only when set, letting the server apply its default.
    if ((args.pageSize ?? 0) > 0) {
      req.pageSize = args.pageSize;
    }
    try {
      const resp = await client.listVersions(req, callOptions);
      const data = JSON.parse(
        toProtoJson(ListWorkflowVersionsResponseSchema, resp),
      ) as Record<string, unknown>;
      if (Array.isArray(data.versions)) {
        for (const entry of data.versions as Array<Record<string, unknown>>) {
          delete entry.validated_yaml;
        }
      }
      return JSON.stringify(data, null, 2);
    } catch (err) {
      throw rpcError(err, `versions of workflow "${args.slug}" in org "${args.org}"`);
    }
  });
}

/**
 * Fetch one historical version of a workflow: resolve org/slug → ID, then
 * getVersion by full hash. Returns the WorkflowVersionEntry (hash, tag,
 * provenance, and the version's validated YAML) as protojson.
 */
export async function fetchWorkflowVersion(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
  versionHash: string,
): Promise<string> {
  const desc = `version "${versionHash}" of workflow "${slug}" in org "${org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const query = createClient(WorkflowQueryController, transport);
    try {
      const workflow = await query.getByReference(
        { org, kind: ApiResourceKind.workflow, slug },
        callOptions,
      );
      const entry = await query.getVersion(
        { workflowId: workflow.metadata?.id ?? "", versionHash },
        callOptions,
      );
      return toProtoJson(WorkflowVersionEntrySchema, entry);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}

export interface TagWorkflowVersionArgs {
  readonly org: string;
  readonly slug: string;
  readonly versionHash: string;
  readonly tag: string;
}

/**
 * Assign (or move) a tag onto a workflow version: resolve org/slug → ID, then
 * tagVersion. Returns the updated workflow as protojson.
 */
export async function tagWorkflowVersion(
  serverAddress: string,
  token: string,
  args: TagWorkflowVersionArgs,
): Promise<string> {
  const desc = `tag "${args.tag}" on workflow "${args.slug}" in org "${args.org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const query = createClient(WorkflowQueryController, transport);
    let id: string;
    try {
      const workflow = await query.getByReference(
        { org: args.org, kind: ApiResourceKind.workflow, slug: args.slug },
        callOptions,
      );
      id = workflow.metadata?.id ?? "";
    } catch (err) {
      throw rpcError(err, desc);
    }

    const command = createClient(WorkflowCommandController, transport);
    try {
      const workflow = await command.tagVersion(
        { workflowId: id, versionHash: args.versionHash, tag: args.tag },
        callOptions,
      );
      return toProtoJson(WorkflowSchema, workflow);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}
