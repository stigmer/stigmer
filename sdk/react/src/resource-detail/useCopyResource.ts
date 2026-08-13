"use client";

import { useCallback, useMemo } from "react";
import { toast } from "../feedback/toast.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";

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
 * Wraps the shared copy behavior (`useCopyFeedback`) with toast feedback so
 * every copy action is confirmed visually (Nielsen heuristic #1 — visibility
 * of system status). A rejected write (insecure context, denied permission)
 * toasts an error instead of claiming a copy that didn't happen.
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
  const { copy: copyText } = useCopyFeedback();

  const copy = useCallback(
    async (text: string, label: string) => {
      if (await copyText(text)) {
        toast.success(`${label} copied`);
      } else {
        toast.error(`Couldn't copy ${label}`);
      }
    },
    [copyText],
  );

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
