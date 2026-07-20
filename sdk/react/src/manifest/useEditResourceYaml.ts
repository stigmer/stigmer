"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "@bufbuild/protobuf";
import {
  containsRedactedSecrets,
  parseManifest,
  serializeManifest,
  type AppliedManifest,
  type ManifestDocument,
} from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/**
 * Result of validating the edited YAML against the source resource.
 *
 * Discriminated on `status` so consumers can render exactly one of:
 * a disabled state (`empty`), an inline error (`invalid`), or the
 * apply affordance (`valid`).
 */
export type EditYamlValidation =
  | { readonly status: "empty" }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "valid"; readonly document: ManifestDocument };

/**
 * What applying the current content will do — resolved against live
 * server state so renames surface as "create" before the user commits.
 */
export type EditYamlTarget =
  | { readonly action: "update"; readonly slug: string }
  | { readonly action: "create"; readonly slug: string }
  /** Existence lookup failed (offline, permissions) — wording degrades. */
  | { readonly action: "unknown"; readonly slug: string };

/** Options for {@link useEditResourceYaml}. */
export interface UseEditResourceYamlOptions {
  /**
   * The resource to edit, as returned by the server (e.g. from `useAgent`
   * or a list panel row). `null` while the resource is loading — the hook
   * seeds the editor when it arrives.
   */
  readonly resource: Message | null;
}

/** Return value of {@link useEditResourceYaml}. */
export interface UseEditResourceYamlReturn {
  /** Current editor content. */
  readonly yaml: string;
  /** Update the editor content (wire to the YAML editor's `onChange`). */
  readonly setYaml: (value: string) => void;
  /** `true` when the content differs from the seeded serialization. */
  readonly isDirty: boolean;
  /** Live validation of the current content. */
  readonly validation: EditYamlValidation;
  /**
   * Create-vs-update preview for the current content, or `null` while
   * validation fails or the existence check is in flight.
   */
  readonly target: EditYamlTarget | null;
  /** `true` when the content contains `***REDACTED***` secret markers. */
  readonly hasRedactedSecrets: boolean;
  /**
   * Apply the edited YAML. Resolves with the applied resource, or `null`
   * when the content is not currently valid (check `validation`).
   */
  readonly apply: () => Promise<AppliedManifest | null>;
  /** `true` while the apply RPC is in flight. */
  readonly isApplying: boolean;
  /** Error from the last failed apply, or `null` when healthy. */
  readonly error: Error | null;
  /** Clear the apply error (e.g. when the user edits again). */
  readonly clearError: () => void;
  /** Discard edits and reseed from the resource. */
  readonly reset: () => void;
}

// Existence checks run against live server state; wait for a typing pause.
const TARGET_CHECK_DEBOUNCE_MS = 400;

/**
 * Behavior hook for editing an existing resource as YAML and applying the
 * result — the console's kind-agnostic "Edit YAML" flow.
 *
 * Seeds the editor from {@link serializeManifest} (full fidelity minus
 * system-managed state), validates every edit against the kind's generated
 * proto schema via {@link parseManifest} (strict — unknown fields fail
 * loudly), previews create-vs-update by resolving the edited document's
 * reference against the server, and applies through
 * `stigmer.manifest.apply()`.
 *
 * Guardrails beyond the raw engine:
 * - the edited document must stay the same kind as the source resource
 *   (pasting an Environment into an Agent editor is an error, not an apply)
 * - the edited manifest must contain exactly one document
 *
 * @example
 * ```tsx
 * const edit = useEditResourceYaml({ resource: agent });
 *
 * <YamlEditor value={edit.yaml} onChange={edit.setYaml} />
 * {edit.validation.status === "invalid" && <p>{edit.validation.message}</p>}
 * <button disabled={edit.validation.status !== "valid"} onClick={edit.apply}>
 *   {edit.target?.action === "create" ? "Create" : "Apply changes"}
 * </button>
 * ```
 *
 * @see {@link EditResourceYamlDialog} for the styled component composing this hook
 * @see {@link useApplyManifest} for the paste/upload counterpart
 */
export function useEditResourceYaml({
  resource,
}: UseEditResourceYamlOptions): UseEditResourceYamlReturn {
  const stigmer = useStigmer();

  // The serialized source of truth. Recomputed when the resource changes;
  // only reseeds the editor while the user hasn't started editing.
  const seeded = useMemo(
    () => (resource ? serializeManifest(resource) : ""),
    [resource],
  );

  const [yaml, setYamlState] = useState(seeded);
  const [isDirty, setIsDirty] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [target, setTarget] = useState<EditYamlTarget | null>(null);

  useEffect(() => {
    if (!isDirty) setYamlState(seeded);
  }, [seeded, isDirty]);

  const setYaml = useCallback(
    (value: string) => {
      setYamlState(value);
      setIsDirty(value !== seeded);
    },
    [seeded],
  );

  const reset = useCallback(() => {
    setYamlState(seeded);
    setIsDirty(false);
    setError(null);
  }, [seeded]);

  const clearError = useCallback(() => setError(null), []);

  const sourceKind = useMemo(() => {
    if (!resource) return null;
    // The seeded YAML's kind is authoritative for the source resource; a
    // parse of our own serialization cannot fail.
    return seeded ? parseManifest(seeded)[0].handler.yamlKind : null;
  }, [resource, seeded]);

  const validation = useMemo<EditYamlValidation>(() => {
    if (!yaml.trim()) return { status: "empty" };

    let documents: ManifestDocument[];
    try {
      documents = parseManifest(yaml);
    } catch (err) {
      return { status: "invalid", message: toError(err).message };
    }

    if (documents.length > 1) {
      return {
        status: "invalid",
        message:
          "This editor applies a single resource. Remove the extra " +
          "documents, or use Apply YAML in the Library for multi-document manifests.",
      };
    }

    const document = documents[0];
    if (sourceKind !== null && document.handler.yamlKind !== sourceKind) {
      return {
        status: "invalid",
        message:
          `The document's kind changed from ${sourceKind} to ` +
          `${document.handler.yamlKind}. To apply a different resource kind, ` +
          "use Apply YAML in the Library instead.",
      };
    }

    return { status: "valid", document };
  }, [yaml, sourceKind]);

  // Resolve create-vs-update against live state whenever the content
  // becomes valid, debounced across keystrokes and cancellation-safe.
  const checkSeq = useRef(0);
  useEffect(() => {
    if (validation.status !== "valid") {
      setTarget(null);
      return;
    }

    const { document } = validation;
    const seq = ++checkSeq.current;
    setTarget(null);

    const timer = setTimeout(async () => {
      let action: EditYamlTarget["action"];
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
      if (checkSeq.current === seq) {
        setTarget({ action, slug: document.slug });
      }
    }, TARGET_CHECK_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [validation, stigmer]);

  const apply = useCallback(async (): Promise<AppliedManifest | null> => {
    if (validation.status !== "valid") return null;

    setIsApplying(true);
    setError(null);
    try {
      const applied = await stigmer.manifest.apply(validation.document);
      setIsDirty(false);
      return applied;
    } catch (err) {
      setError(toError(err));
      throw err;
    } finally {
      setIsApplying(false);
    }
  }, [validation, stigmer]);

  const hasRedactedSecrets = useMemo(
    () => containsRedactedSecrets(yaml),
    [yaml],
  );

  return useMemo(
    () => ({
      yaml,
      setYaml,
      isDirty,
      validation,
      target,
      hasRedactedSecrets,
      apply,
      isApplying,
      error,
      clearError,
      reset,
    }),
    [
      yaml,
      setYaml,
      isDirty,
      validation,
      target,
      hasRedactedSecrets,
      apply,
      isApplying,
      error,
      clearError,
      reset,
    ],
  );
}
