"use client";

import { useCallback, useMemo } from "react";
import { parse as parseYaml } from "yaml";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { serializeManifest } from "@stigmer/sdk";
import { toast } from "../feedback/toast.js";
import { downloadTextFile } from "../internal/download.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";
import { serializeWorkflowYaml } from "../workflow/serialize-workflow-yaml.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for {@link useExportResource}. */
export interface UseExportResourceOptions {
  /** The resource kind — determines which serializer is used. */
  readonly kind: "Agent" | "McpServer" | "Workflow" | "Schedule";
  /** The proto resource to export, or `null` when not yet loaded. */
  readonly resource: Agent | McpServer | Workflow | Schedule | null;
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
 * Workflow, Schedule).
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

  const { copy: copyText } = useCopyFeedback();

  const copyYaml = useCallback(async () => {
    if (!yaml) return;
    if (await copyText(yaml)) {
      toast.success("YAML copied to clipboard");
    } else {
      toast.error("Couldn't copy YAML");
    }
  }, [copyText, yaml]);

  const copyJson = useCallback(async () => {
    if (!json) return;
    if (await copyText(json)) {
      toast.success("JSON copied to clipboard");
    } else {
      toast.error("Couldn't copy JSON");
    }
  }, [copyText, json]);

  const downloadYaml = useCallback(() => {
    if (!yaml) return;
    downloadTextFile(yaml, `${slug}.yaml`, "text/yaml");
  }, [yaml, slug]);

  const downloadJson = useCallback(() => {
    if (!json) return;
    downloadTextFile(json, `${slug}.json`, "application/json");
  }, [json, slug]);

  return useMemo(
    () => ({ copyYaml, copyJson, downloadYaml, downloadJson, yaml, json }),
    [copyYaml, copyJson, downloadYaml, downloadJson, yaml, json],
  );
}
