"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  containsRedactedSecrets,
  parseManifest,
  type AppliedManifest,
  type ManifestDocument,
} from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Per-document apply lifecycle within one manifest. */
export type ManifestEntryStatus =
  | "pending"
  | "applying"
  | "applied"
  | "failed"
  /** A prior document failed; this one was not attempted. */
  | "skipped";

/** One document of the manifest, with its preview and apply state. */
export interface ManifestPreviewEntry {
  /** The parsed document (kind handler, message, name/slug/org). */
  readonly document: ManifestDocument;
  /** What applying will do, resolved against live server state. */
  readonly action: "create" | "update" | "unknown";
  /** Apply lifecycle status. */
  readonly status: ManifestEntryStatus;
  /** The applied resource, present when `status` is `"applied"`. */
  readonly result?: AppliedManifest;
  /** User-facing failure message, present when `status` is `"failed"`. */
  readonly errorMessage?: string;
}

/** Return value of {@link useApplyManifest}. */
export interface UseApplyManifestReturn {
  /** Current manifest text (paste target). */
  readonly content: string;
  /** Update the manifest text. Re-validates (debounced). */
  readonly setContent: (value: string) => void;
  /** Read a `.yaml`/`.yml`/`.json` file into `content`. */
  readonly readFile: (file: File) => Promise<void>;
  /**
   * Validated per-document preview in dependency apply order, or `null`
   * while the content is empty or invalid.
   */
  readonly entries: readonly ManifestPreviewEntry[] | null;
  /** Validation error for the current content, or `null` when valid. */
  readonly validationError: string | null;
  /** `true` while the (debounced) validation + existence checks run. */
  readonly isValidating: boolean;
  /** `true` when the content contains `***REDACTED***` secret markers. */
  readonly hasRedactedSecrets: boolean;
  /**
   * Apply all documents sequentially in dependency order. Entries update
   * live. Stops at the first failure (later entries become `"skipped"`).
   * Resolves `true` when every document applied.
   */
  readonly applyAll: () => Promise<boolean>;
  /** `true` while applies are in flight. */
  readonly isApplying: boolean;
  /** Clear all state (content, preview, errors). */
  readonly reset: () => void;
}

// Validation parses + resolves existence server-side; wait for a typing pause.
const VALIDATE_DEBOUNCE_MS = 500;

/**
 * Headless "apply a YAML manifest" flow for any registry-supported kind —
 * the console counterpart of `stigmer apply -f`.
 *
 * Orchestrates: paste or upload → strict parse against generated proto
 * schemas ({@link parseManifest}) → per-document create-vs-update preview
 * (server existence check) → sequential apply in dependency order with
 * live per-document status.
 *
 * Accepts multi-document manifests (`---` separators) and JSON content
 * (YAML is a superset). The target `org` is injected into documents that
 * omit `metadata.org`; documents naming a *different* org are honored and
 * apply there (matching `stigmer apply` semantics — the org-mismatch
 * warning surfaces on the parsed document).
 *
 * @param org - Target organization slug for `metadata.org` injection.
 *
 * @example
 * ```tsx
 * const manifest = useApplyManifest(activeOrg);
 *
 * <textarea value={manifest.content}
 *           onChange={(e) => manifest.setContent(e.target.value)} />
 * {manifest.entries?.map((e) => (
 *   <PreviewRow key={e.document.slug} entry={e} />
 * ))}
 * <button onClick={manifest.applyAll} disabled={!manifest.entries}>Apply</button>
 * ```
 *
 * @see {@link ApplyManifestDialog} for the styled component composing this hook
 * @see {@link useEditResourceYaml} for the edit-in-place counterpart
 */
export function useApplyManifest(org: string): UseApplyManifestReturn {
  const stigmer = useStigmer();

  const [content, setContentState] = useState("");
  const [entries, setEntries] = useState<readonly ManifestPreviewEntry[] | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const orgRef = useRef(org);
  orgRef.current = org;

  const setContent = useCallback((value: string) => {
    setContentState(value);
  }, []);

  const readFile = useCallback(async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      setContentState("");
      setEntries(null);
      setValidationError(`Failed to read ${file.name}.`);
      return;
    }
    setContentState(text);
  }, []);

  const reset = useCallback(() => {
    setContentState("");
    setEntries(null);
    setValidationError(null);
    setIsValidating(false);
    setIsApplying(false);
  }, []);

  // Debounced validation + existence resolution, cancellation-safe. Applies
  // freeze the preview: entries carry live statuses the validator must not
  // clobber mid-run.
  const validateSeq = useRef(0);
  useEffect(() => {
    if (isApplying) return;

    const seq = ++validateSeq.current;

    if (!content.trim()) {
      setEntries(null);
      setValidationError(null);
      setIsValidating(false);
      return;
    }

    setIsValidating(true);

    const timer = setTimeout(async () => {
      let documents: ManifestDocument[];
      try {
        documents = parseManifest(content, { org: orgRef.current });
      } catch (err) {
        if (validateSeq.current === seq) {
          setEntries(null);
          setValidationError(toError(err).message);
          setIsValidating(false);
        }
        return;
      }

      const resolved = await Promise.all(
        documents.map(async (document): Promise<ManifestPreviewEntry> => {
          let action: ManifestPreviewEntry["action"];
          try {
            const existing = await stigmer.manifest.getByReference(
              document.handler.yamlKind,
              document.org,
              document.slug,
            );
            action = existing !== null ? "update" : "create";
          } catch {
            action = "unknown";
          }
          return { document, action, status: "pending" };
        }),
      );

      if (validateSeq.current === seq) {
        setEntries(resolved);
        setValidationError(null);
        setIsValidating(false);
      }
    }, VALIDATE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [content, stigmer, isApplying]);

  const applyAll = useCallback(async (): Promise<boolean> => {
    if (!entries || entries.length === 0) return false;

    // Invalidate any in-flight validation so it cannot clobber apply statuses.
    validateSeq.current++;
    setIsApplying(true);

    // Local working copy — React state is updated per transition so the
    // dialog renders progress live.
    const working = entries.map((entry): ManifestPreviewEntry => ({ ...entry, status: "pending" }));
    const commit = () => setEntries([...working]);

    let allApplied = true;

    for (let i = 0; i < working.length; i++) {
      if (!allApplied) {
        working[i] = { ...working[i], status: "skipped" };
        continue;
      }

      working[i] = { ...working[i], status: "applying" };
      commit();

      try {
        const result = await stigmer.manifest.apply(working[i].document);
        working[i] = { ...working[i], status: "applied", result };
      } catch (err) {
        working[i] = {
          ...working[i],
          status: "failed",
          errorMessage: toError(err).message,
        };
        allApplied = false;
      }
      commit();
    }

    commit();
    setIsApplying(false);
    return allApplied;
  }, [entries, stigmer]);

  const hasRedactedSecrets = useMemo(
    () => containsRedactedSecrets(content),
    [content],
  );

  return useMemo(
    () => ({
      content,
      setContent,
      readFile,
      entries,
      validationError,
      isValidating,
      hasRedactedSecrets,
      applyAll,
      isApplying,
      reset,
    }),
    [
      content,
      setContent,
      readFile,
      entries,
      validationError,
      isValidating,
      hasRedactedSecrets,
      applyAll,
      isApplying,
      reset,
    ],
  );
}
