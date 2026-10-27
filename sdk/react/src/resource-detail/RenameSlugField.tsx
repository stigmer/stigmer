"use client";

/**
 * The slug as an editable field with its own Rename action: the one place a
 * console page renames a resource (an organization, an agent, a vault, a
 * routine, a channel app, an OAuth app, a team or a federation
 * issuer).
 *
 * A rename changes the name in every link and file that names the
 * resource, so it is a deliberate act of its own, apart from any form's
 * Save; Enter in the field renames rather than submitting a surrounding
 * form. After a rename lands, `currentSlug` is the old slug until the page's
 * refetch returns, so the field stays settling (disabled) until
 * `currentSlug` moves: a second click cannot send the same rename again.
 *
 * {@link ResourceSlugField} is the field for a kind other than the
 * organization: it asks `can_delete` on the resource (whoever may delete it
 * may rename it), failing closed so the field never flashes for someone the
 * server would refuse, and renders its `fallback` otherwise.
 */
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import {
  type RenamableResourceKind,
  type RenamedResource,
  useRenameResource,
} from "./useRenameResource.js";

/** The help line every renamable kind but the organization shows under its slug. */
export const RESOURCE_RENAME_HINT =
  "The name in links and files. After a rename the old slug keeps working for reading for 30 days; a file that names it must change to the new one.";

/** Props for {@link RenameSlugField}. */
export interface RenameSlugFieldProps<T> {
  /** The slug the resource has now, as the page last read it. */
  readonly currentSlug: string;
  /** Sends the rename to `slug`; rejects with the server's refusal. */
  readonly rename: (slug: string) => Promise<T>;
  /** `true` while the rename request is in flight. */
  readonly isRenaming: boolean;
  /** The last failed rename's error, shown in place of the hint. */
  readonly error: Error | null;
  /** Clears `error` (on every edit). */
  readonly clearError: () => void;
  /** Fired with the renamed resource; the page refetches it. */
  readonly onRenamed: (renamed: T) => void;
  /** The help line under the field. */
  readonly hint: ReactNode;
  /** The field's label. Defaults to "Slug". */
  readonly label?: string;
  readonly className?: string;
}

/** The slug with a Rename action (see the module header). */
export function RenameSlugField<T>({
  currentSlug,
  rename,
  isRenaming,
  error,
  clearError,
  onRenamed,
  hint,
  label = "Slug",
  className,
}: RenameSlugFieldProps<T>) {
  const inputId = useId();
  const [slug, setSlug] = useState(currentSlug);
  // The slug a landed rename left behind, until the page shows another.
  const [renamedFrom, setRenamedFrom] = useState<string | null>(null);

  useEffect(() => {
    setSlug(currentSlug);
    setRenamedFrom(null);
  }, [currentSlug]);

  const settling = renamedFrom !== null;
  const busy = isRenaming || settling;
  const next = slug.trim();
  const canRename = next.length > 0 && next !== currentSlug && !busy;

  const submit = useCallback(async () => {
    if (!canRename) return;
    clearError();
    try {
      const renamed = await rename(next);
      setRenamedFrom(currentSlug);
      onRenamed(renamed);
    } catch {
      // error state is the caller's
    }
  }, [canRename, clearError, rename, next, currentSlug, onRenamed]);

  return (
    <div className={cn("stg:space-y-1", className)}>
      <label
        htmlFor={inputId}
        className="stg:text-2xs stg:font-medium stg:text-muted-foreground stg:uppercase stg:tracking-wider"
      >
        {label}
      </label>
      <div className="stg:flex stg:items-center stg:gap-2">
        <input
          id={inputId}
          type="text"
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            clearError();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:font-mono stg:text-xs stg:text-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canRename}
          className={cn(
            "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:border stg:border-input stg:text-foreground stg:hover:bg-accent-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {busy && <SpinnerIcon size={12} />}
          Rename
        </button>
      </div>
      {error ? (
        <p className="stg:text-destructive stg:text-2xs" role="alert">
          {getUserMessage(error)}
        </p>
      ) : (
        <p className="stg:text-2xs stg:text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Props for {@link ResourceSlugField}. */
export interface ResourceSlugFieldProps {
  readonly kind: RenamableResourceKind;
  /** The resource's id; `null` or empty while it loads. */
  readonly resourceId: string | null;
  readonly currentSlug: string;
  /** Fired with the renamed resource; the page refetches it or moves to its new address. */
  readonly onRenamed: (renamed: RenamedResource) => void;
  /** What a caller who may not rename sees instead (a read-only slug, or nothing). */
  readonly fallback?: ReactNode;
  readonly className?: string;
}

/**
 * A renamable kind's slug field, for whoever may delete the resource (the
 * check fails closed); everyone else sees `fallback`.
 */
export function ResourceSlugField({
  kind,
  resourceId,
  currentSlug,
  onRenamed,
  fallback = null,
  className,
}: ResourceSlugFieldProps) {
  const check = useCheckPermission(
    resourceId ? { kind, id: resourceId } : null,
    "can_delete",
    { fail: "closed" },
  );
  const { rename, isRenaming, error, clearError } = useRenameResource(kind);
  const renameThis = useCallback(
    (slug: string) => rename(resourceId ?? "", slug),
    [rename, resourceId],
  );
  if (!resourceId || !check.allowed) {
    return <>{fallback}</>;
  }
  return (
    <RenameSlugField
      currentSlug={currentSlug}
      rename={renameThis}
      isRenaming={isRenaming}
      error={error}
      clearError={clearError}
      onRenamed={onRenamed}
      hint={RESOURCE_RENAME_HINT}
      className={className}
    />
  );
}
