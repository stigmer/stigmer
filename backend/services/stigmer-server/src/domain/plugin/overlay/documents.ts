/**
 * The plugin's Stigmer overlay, parsed: the three document families under
 * `ai.stigmer/` as protos, each still carrying the path it came from so
 * every later sentence can point at the file. `parseOverlays` is the one
 * place the library's byte-and-path documents meet the schemas; the
 * sanitiser and the materialisers read the result and never the bytes.
 */
import type { StigmerOverlay } from "@stigmer/plugin-package";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";

import { parseOverlayDocument } from "./parse.js";

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
export function parseOverlays(
  overlay: StigmerOverlay,
  org: string,
): ParsedOverlays {
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
            org,
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
        org,
      }),
    })),
    mcpServers: overlay.mcpServers.map((document) => ({
      path: document.path,
      server: document.server,
      resource: parseOverlayDocument(document.path, document.bytes, {
        schema: McpServerSchema,
        yamlKind: "McpServer",
        org,
      }),
    })),
  };
}
