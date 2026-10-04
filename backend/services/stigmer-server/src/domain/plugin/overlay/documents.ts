/**
 * The plugin's Stigmer overlay, parsed: the three document families under
 * `ai.stigmer/` as protos, each still carrying the path it came from so
 * every later sentence can point at the file. `parseOverlays` is the one
 * place the library's byte-and-path documents meet the schemas; the
 * sanitiser and the materialisers read the result and never the bytes.
 * `resolveOverlayOrganizations` then gives the documents what the serving
 * chain gives a request: every organization they name by slug becomes its
 * id, and each document's own organization must be the installing one.
 */
import type { StigmerOverlay } from "@stigmer/plugin-package";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";

import type { OrganizationNameResolver } from "../../../pipeline/interceptors/organization-names.js";
import { resolveOrganizationNames } from "../../../pipeline/interceptors/organization-names.js";
import { metadataOf } from "../../../pipeline/steps/shapes.js";
import { checkOverlayOrg, foreignOverlayOrg, parseOverlayDocument } from "./parse.js";

export interface ParsedOverlayDocument<T> {
  readonly path: string;
  readonly resource: T;
}

export interface ParsedOverlayWorkflow extends ParsedOverlayDocument<Workflow> {
  /** The file stem: the workflow's name. */
  readonly name: string;
}

export interface ParsedOverlayMcpServer extends ParsedOverlayDocument<McpServer> {
  /** The `mcpServers` key this overlay layers over. */
  readonly server: string;
}

export interface ParsedOverlays {
  readonly agent?: ParsedOverlayDocument<Agent>;
  readonly workflows: readonly ParsedOverlayWorkflow[];
  readonly mcpServers: readonly ParsedOverlayMcpServer[];
}

/** Parses every overlay document strictly; the first refusal stops the read. */
export function parseOverlays(overlay: StigmerOverlay): ParsedOverlays {
  return {
    ...(overlay.agent !== undefined && {
      agent: {
        path: overlay.agent.path,
        resource: parseOverlayDocument(
          overlay.agent.path,
          overlay.agent.bytes,
          {
            schema: AgentSchema,
            yamlKind: "Agent",
          },
        ),
      },
    }),
    workflows: overlay.workflows.map((document) => ({
      path: document.path,
      name: document.name,
      resource: parseOverlayDocument(document.path, document.bytes, {
        schema: WorkflowSchema,
        yamlKind: "Workflow",
      }),
    })),
    mcpServers: overlay.mcpServers.map((document) => ({
      path: document.path,
      server: document.server,
      resource: parseOverlayDocument(document.path, document.bytes, {
        schema: McpServerSchema,
        yamlKind: "McpServer",
      }),
    })),
  };
}

/**
 * Resolves every organization the parsed documents name to its id, in
 * place, then refuses a document whose own organization is not `org`, the
 * installing organization's id. The first refusal stops the read.
 */
export async function resolveOverlayOrganizations(
  overlays: ParsedOverlays,
  org: string,
  resolver: OrganizationNameResolver,
  labelOf: (org: string) => Promise<string> = (value) => Promise.resolve(value),
): Promise<void> {
  const documents = [
    ...(overlays.agent === undefined ? [] : [{ schema: AgentSchema, document: overlays.agent }]),
    ...overlays.workflows.map((document) => ({ schema: WorkflowSchema, document })),
    ...overlays.mcpServers.map((document) => ({ schema: McpServerSchema, document })),
  ];
  for (const { schema, document } of documents) {
    const written = metadataOf(document.resource)?.org ?? "";
    await resolveOrganizationNames(schema, document.resource, resolver);
    // The refusal names the installing organization the way a person reads
    // it, looked up only when there is a refusal to word, and the document's
    // own org as its author wrote it.
    if (foreignOverlayOrg(document.resource, org) !== undefined) {
      checkOverlayOrg(document.path, document.resource, org, await labelOf(org), written);
    }
  }
}
