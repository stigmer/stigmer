"use client";

import { useCallback, useMemo } from "react";
import { parse as parseYaml } from "yaml";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { toast } from "../feedback/toast";
import { serializeAgentYaml, serializeMcpServerYaml } from "./serialize-resource-yaml";
import { serializeWorkflowYaml } from "../workflow/serialize-workflow-yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for {@link useExportResource}. */
export interface UseExportResourceOptions {
  /** The resource kind — determines which serializer is used. */
  readonly kind: "Agent" | "McpServer" | "Workflow";
  /** The proto resource to export, or `null` when not yet loaded. */
  readonly resource: Agent | McpServer | Workflow | null;
}

/** Return value of {@link useExportResource}. */
export interface UseExportResourceReturn {
  /** Copy the resource as YAML to the clipboard (with toast feedback). */
  readonly copyYaml: () => Promise<void>;
  /** Copy the resource as JSON to the clipboard (with toast feedback). */
  readonly copyJson: () => Promise<void>;
  /** Download the resource as a `.yaml` file. */
  readonly downloadYaml: () => void;
  /** Download the resource as a `.json` file. */
  readonly downloadJson: () => void;
  /** The serialized YAML string, or `null` when the resource is not loaded. */
  readonly yaml: string | null;
  /** The serialized JSON string, or `null` when the resource is not loaded. */
  readonly json: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Headless export hook for Stigmer resources (Agent, McpServer).
 *
 * Serializes the resource into YAML and JSON formats and provides
 * stable callbacks for copying to clipboard or triggering a file
 * download. All operations are client-side — no additional API calls.
 *
 * The serialized output uses the canonical Stigmer resource format
 * (`apiVersion`, `kind`, `metadata`, `spec`) with snake_case field
 * names, identical to what the CLI produces and what `parseResourceYaml`
 * accepts — ensuring full round-trip compatibility.
 *
 * @param options - Resource kind and the proto resource object.
 * @returns Stable callbacks and memoized serialized strings.
 *
 * @example
 * ```tsx
 * const { agent } = useAgent(org, slug);
 * const { copyYaml, downloadYaml } = useExportResource({
 *   kind: "Agent",
 *   resource: agent,
 * });
 *
 * <ActionMenu.Item onSelect={copyYaml}>Export YAML</ActionMenu.Item>
 * <ActionMenu.Item onSelect={downloadYaml}>Download YAML</ActionMenu.Item>
 * ```
 *
 * @see {@link serializeAgentYaml} for the underlying Agent serializer
 * @see {@link serializeMcpServerYaml} for the underlying McpServer serializer
 */
export function useExportResource({
  kind,
  resource,
}: UseExportResourceOptions): UseExportResourceReturn {
  const yaml = useMemo<string | null>(() => {
    if (!resource) return null;
    if (kind === "Agent") return serializeAgentYaml(resource as Agent);
    if (kind === "Workflow") return serializeWorkflowYaml(resource as Workflow);
    return serializeMcpServerYaml(resource as McpServer);
  }, [kind, resource]);

  const json = useMemo<string | null>(() => {
    if (!resource) return null;
    return serializeResourceJson(resource, kind);
  }, [kind, resource]);

  const slug = useMemo<string>(() => {
    if (!resource) return "resource";
    return resource.metadata?.slug || resource.metadata?.name || "resource";
  }, [resource]);

  const copyYaml = useCallback(async () => {
    if (!yaml) return;
    await copyToClipboard(yaml);
    toast.success("YAML copied to clipboard");
  }, [yaml]);

  const copyJson = useCallback(async () => {
    if (!json) return;
    await copyToClipboard(json);
    toast.success("JSON copied to clipboard");
  }, [json]);

  const downloadYaml = useCallback(() => {
    if (!yaml) return;
    downloadFile(yaml, `${slug}.yaml`, "text/yaml");
  }, [yaml, slug]);

  const downloadJson = useCallback(() => {
    if (!json) return;
    downloadFile(json, `${slug}.json`, "application/json");
  }, [json, slug]);

  return useMemo(
    () => ({ copyYaml, copyJson, downloadYaml, downloadJson, yaml, json }),
    [copyYaml, copyJson, downloadYaml, downloadJson, yaml, json],
  );
}

// ---------------------------------------------------------------------------
// JSON serialization
// ---------------------------------------------------------------------------

/**
 * Produces a JSON representation of the resource using the same canonical
 * structure as the YAML export (apiVersion, kind, metadata, spec).
 *
 * Internally parses the YAML output to get a clean plain object, then
 * re-stringifies as JSON. This guarantees the JSON structure is identical
 * to the YAML structure (snake_case fields, no status).
 */
function serializeResourceJson(
  resource: Agent | McpServer | Workflow,
  kind: "Agent" | "McpServer" | "Workflow",
): string {
  let yamlStr: string;
  if (kind === "Agent") yamlStr = serializeAgentYaml(resource as Agent);
  else if (kind === "Workflow") yamlStr = serializeWorkflowYaml(resource as Workflow);
  else yamlStr = serializeMcpServerYaml(resource as McpServer);

  const doc = parseYaml(yamlStr);
  return JSON.stringify(doc, null, 2);
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

// ---------------------------------------------------------------------------
// File download
// ---------------------------------------------------------------------------

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
