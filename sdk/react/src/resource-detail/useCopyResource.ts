"use client";

import { useCallback, useMemo } from "react";
import { toast } from "../feedback/toast.js";

export interface UseCopyResourceReturn {
  /** Copy arbitrary text to the clipboard with toast feedback. */
  readonly copy: (text: string, label: string) => Promise<void>;
  /** Shortcut: copies `id` and toasts "ID copied". */
  readonly copyId: (id: string) => Promise<void>;
  /** Shortcut: copies `slug` and toasts "Slug copied". */
  readonly copySlug: (slug: string) => Promise<void>;
  /** Shortcut: copies the qualified slug (`org/slug`) and toasts. */
  readonly copyQualifiedSlug: (org: string, slug: string) => Promise<void>;
}

/**
 * Clipboard helper for resource detail pages.
 *
 * Wraps `navigator.clipboard.writeText` with toast feedback so every
 * copy action is confirmed visually (Nielsen heuristic #1 — visibility
 * of system status). Falls back to a hidden textarea for older browsers.
 *
 * @example
 * ```tsx
 * const { copyId, copySlug, copy } = useCopyResource();
 *
 * <ActionMenu.Item onSelect={() => copyId(resource.id)}>
 *   Copy ID
 * </ActionMenu.Item>
 * ```
 */
export function useCopyResource(): UseCopyResourceReturn {
  const copy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      fallbackCopy(text);
      toast.success(`${label} copied`);
    }
  }, []);

  const copyId = useCallback(
    (id: string) => copy(id, "ID"),
    [copy],
  );

  const copySlug = useCallback(
    (slug: string) => copy(slug, "Slug"),
    [copy],
  );

  const copyQualifiedSlug = useCallback(
    (org: string, slug: string) => copy(`${org}/${slug}`, "Qualified slug"),
    [copy],
  );

  return useMemo(
    () => ({ copy, copyId, copySlug, copyQualifiedSlug }),
    [copy, copyId, copySlug, copyQualifiedSlug],
  );
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
