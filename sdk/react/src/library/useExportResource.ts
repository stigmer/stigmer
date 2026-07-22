"use client";

import { useCallback, useMemo } from "react";
import { parse as parseYaml } from "yaml";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Datastore } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { serializeManifest } from "@stigmer/sdk";
import { toast } from "../feedback/toast.js";
import { serializeWorkflowYaml } from "../workflow/serialize-workflow-yaml.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for {@link useExportResource}. */
export interface UseExportResourceOptions {
  /** The resource kind — determines which serializer is used. */
  readonly kind: "Agent" | "McpServer" | "Workflow" | "Datastore";
  /** The proto resource to export, or `null` when not yet loaded. */
  readonly resource: Agent | McpServer | Workflow | Datastore | null;
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
 * Headless export hook for Stigmer resources (Agent, McpServer,
 * Workflow, Datastore).
 *
 * Serializes the resource into YAML and JSON formats and provides
 * stable callbacks for copying to clipboard or triggering a file
 * download. All operations are client-side — no additional API calls.
 *
 * Non-workflow kinds serialize through the SDK manifest engine
 * ({@link serializeManifest}) — the canonical Stigmer resource format
 * (`apiVersion`, `kind`, `metadata`, `spec`, snake_case fields) that
 * round-trips through `parseManifest` and `stigmer apply -f`. Workflows
 * use their own canonical serializer, shared with the workflow Editor
 * tab, so one workflow has exactly one YAML shape across the product.
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
 * @see {@link serializeManifest} for the underlying Agent/McpServer serializer
 * @see {@link serializeWorkflowYaml} for the workflow-canonical serializer
 */
export function useExportResource({
  kind,
  resource,
}: UseExportResourceOptions): UseExportResourceReturn {
  const yaml = useMemo<string | null>(() => {
    if (!resource) return null;
    if (kind === "Workflow") return serializeWorkflowYaml(resource as Workflow);
    return serializeManifest(resource);
  }, [kind, resource]);

  const json = useMemo<string | null>(() => {
    if (!yaml) return null;
    // Parse the YAML output to re-stringify as JSON — this guarantees the
    // JSON structure is identical to the YAML structure (snake_case
    // fields, no status).
    return JSON.stringify(parseYaml(yaml), null, 2);
  }, [yaml]);

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
