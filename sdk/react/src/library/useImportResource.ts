"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { stringify as stringifyYaml } from "yaml";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";
import { parseResourceYaml, type ParsedResource } from "./parse-resource-yaml";
import type { ApplyResourceResult } from "./useApplyResource";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Detected format of the imported file content. */
export type ImportFormat = "yaml" | "json";

/**
 * Validated preview of an imported resource, shown to the user before
 * they confirm the apply operation.
 */
export interface ImportPreview {
  /** The detected resource kind. */
  readonly kind: "Agent" | "McpServer";
  /** The resource name from `metadata.name`. */
  readonly name: string;
  /** The resource slug from `metadata.slug`, if present. */
  readonly slug?: string;
  /** The detected file format. */
  readonly format: ImportFormat;
  /** The raw file content (for potential display or debugging). */
  readonly rawContent: string;
}

/** Return value of {@link useImportResource}. */
export interface UseImportResourceReturn {
  /**
   * Read and validate a file selected by the user. On success, populates
   * `preview`. On failure, populates `error`. In both cases, clears the
   * previous state first.
   */
  readonly readFile: (file: File) => Promise<void>;
  /** The validation preview, or `null` when no file has been validated. */
  readonly preview: ImportPreview | null;
  /** Validation or apply error message, or `null` when healthy. */
  readonly error: string | null;
  /** Clear all state (preview, error, internal content). */
  readonly reset: () => void;
  /**
   * Apply the previewed resource to the given organization.
   * Only callable when `preview` is non-null.
   *
   * @throws Re-throws the original error after setting `error` state.
   */
  readonly apply: (org: string) => Promise<ApplyResourceResult>;
  /** `true` while the apply RPC is in-flight. */
  readonly isApplying: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Headless import hook for Stigmer resources.
 *
 * Orchestrates the file import workflow:
 * 1. User selects a `.yaml`, `.yml`, or `.json` file
 * 2. `readFile` reads the content, detects the format, and validates
 *    the structure via `parseResourceYaml`
 * 3. On success, `preview` is populated with kind, name, slug, format
 * 4. On validation error, `error` is populated with a user-facing message
 * 5. User confirms → `apply(org)` calls the appropriate SDK `apply()` method
 *
 * Follows the established mutation-hook pattern: `isApplying` + `error` +
 * `reset`. The `preview` state enables a confirmation step before committing
 * (Nielsen heuristic #3: user control, #5: error prevention).
 *
 * @example
 * ```tsx
 * const { readFile, preview, error, reset, apply, isApplying } = useImportResource();
 *
 * const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
 *   const file = e.target.files?.[0];
 *   if (file) readFile(file);
 * };
 *
 * if (preview) {
 *   return (
 *     <div>
 *       <p>Import {preview.kind}: {preview.name}</p>
 *       <button onClick={() => apply(org)} disabled={isApplying}>
 *         Confirm
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see {@link parseResourceYaml} for the validation logic
 * @see {@link ImportResourceDialog} for the styled component that composes this hook
 */
export function useImportResource(): UseImportResourceReturn {
  const stigmer = useStigmer();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const contentRef = useRef<string | null>(null);
  const parsedRef = useRef<ParsedResource | null>(null);

  const reset = useCallback(() => {
    setPreview(null);
    setError(null);
    setIsApplying(false);
    contentRef.current = null;
    parsedRef.current = null;
  }, []);

  const readFile = useCallback(async (file: File) => {
    setPreview(null);
    setError(null);
    contentRef.current = null;
    parsedRef.current = null;

    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("Failed to read the selected file.");
      return;
    }

    if (!text.trim()) {
      setError("The selected file is empty.");
      return;
    }

    const format = detectFormat(file.name, text);

    // For JSON files, convert to YAML-parseable content first.
    // parseResourceYaml expects YAML, but since YAML is a superset of JSON,
    // we can pass JSON directly. However for cleaner error messages, we
    // normalize JSON → plain object → YAML string if needed.
    let yamlContent: string;
    if (format === "json") {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setError("JSON file must contain a single object (not an array or primitive).");
          return;
        }
        yamlContent = stringifyYaml(parsed);
      } catch {
        setError("The file does not contain valid JSON.");
        return;
      }
    } else {
      yamlContent = text;
    }

    // Validate structure using the existing parser. We use a dummy org
    // here — the real org is provided at apply time.
    let parsed: ParsedResource;
    try {
      parsed = parseResourceYaml(yamlContent, "__preview__");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to validate resource file.");
      return;
    }

    contentRef.current = yamlContent;
    parsedRef.current = parsed;

    setPreview({
      kind: parsed.kind,
      name: parsed.input.name,
      slug: "slug" in parsed.input ? (parsed.input.slug as string | undefined) : undefined,
      format,
      rawContent: text,
    });
  }, []);

  const apply = useCallback(async (org: string): Promise<ApplyResourceResult> => {
    const content = contentRef.current;
    if (!content) {
      throw new Error("No file has been validated. Call readFile first.");
    }

    setIsApplying(true);
    setError(null);

    try {
      const parsed = parseResourceYaml(content, org);

      switch (parsed.kind) {
        case "Agent": {
          const agent = await stigmer.agent.apply(parsed.input);
          return {
            kind: "Agent",
            name: agent.metadata?.name ?? parsed.input.name,
            org: agent.metadata?.org ?? org,
            slug: agent.metadata?.slug ?? parsed.input.name,
          };
        }
        case "McpServer": {
          const mcpServer = await stigmer.mcpServer.apply(parsed.input);
          return {
            kind: "McpServer",
            name: mcpServer.metadata?.name ?? parsed.input.name,
            org: mcpServer.metadata?.org ?? org,
            slug: mcpServer.metadata?.slug ?? parsed.input.name,
          };
        }
      }
    } catch (err) {
      const message = toError(err).message;
      setError(message);
      throw err;
    } finally {
      setIsApplying(false);
    }
  }, [stigmer]);

  return useMemo(
    () => ({ readFile, preview, error, reset, apply, isApplying }),
    [readFile, preview, error, reset, apply, isApplying],
  );
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

const JSON_EXTENSIONS = new Set([".json"]);
const YAML_EXTENSIONS = new Set([".yaml", ".yml"]);

function detectFormat(filename: string, content: string): ImportFormat {
  const lowerName = filename.toLowerCase();
  const dotIndex = lowerName.lastIndexOf(".");
  if (dotIndex >= 0) {
    const ext = lowerName.slice(dotIndex);
    if (JSON_EXTENSIONS.has(ext)) return "json";
    if (YAML_EXTENSIONS.has(ext)) return "yaml";
  }

  // Fallback: try parsing as JSON. If it parses, treat as JSON.
  try {
    JSON.parse(content);
    return "json";
  } catch {
    return "yaml";
  }
}
