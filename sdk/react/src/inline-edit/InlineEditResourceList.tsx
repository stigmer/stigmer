"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@stigmer/theme";
import type { InlineEditBaseProps, ResourceRefRow } from "./types.js";

/** Props for {@link InlineEditResourceList}. */
export interface InlineEditResourceListProps extends InlineEditBaseProps {
  /** Current resource references. */
  readonly value: readonly ResourceRefRow[];
  /** Called with the updated list when a change is confirmed. */
  readonly onSave: (refs: ResourceRefRow[]) => Promise<boolean>;
  /**
   * Inline picker rendered when the user clicks "Add".
   * Receives `onSelect` to call when a resource is chosen.
   * The consumer provides the appropriate domain-specific picker.
   */
  readonly renderPicker?: (onSelect: (ref: ResourceRefRow) => void) => React.ReactNode;
  /** Click handler for navigating to a referenced resource. */
  readonly onItemClick?: (ref: ResourceRefRow) => void;
  /** Icon rendered next to each item. */
  readonly itemIcon?: React.ReactNode;
  /** Label for the resource type (e.g. "MCP Server", "Skill"). */
  readonly resourceLabel?: string;
  /** Controlled editing state. When provided, component is in controlled mode. */
  readonly editing?: boolean;
  /** Called when editing state changes (controlled mode). */
  readonly onEditingChange?: (editing: boolean) => void;
  /** Default org to pre-fill in the generic add form. */
  readonly defaultOrg?: string;
}

/**
 * Inline editor for a list of resource references.
 *
 * Read mode shows clickable reference items. Edit mode adds a remove
 * button per item and an "Add" button that reveals the domain picker.
 */
export function InlineEditResourceList({
  value,
  onSave,
  renderPicker,
  onItemClick,
  itemIcon,
  resourceLabel = "resource",
  editing: controlledEditing,
  onEditingChange,
  defaultOrg = "",
  disabled,
  isSaving,
  error,
  className,
}: InlineEditResourceListProps) {
  const [internalEditing, setInternalEditing] = useState(false);
  const isEditing = controlledEditing ?? internalEditing;
  const setIsEditing = useCallback(
    (v: boolean) => {
      setInternalEditing(v);
      onEditingChange?.(v);
    },
    [onEditingChange],
  );

  useEffect(() => {
    if (controlledEditing !== undefined) setInternalEditing(controlledEditing);
  }, [controlledEditing]);

  const [draft, setDraft] = useState<ResourceRefRow[]>([...value]);
  const [showPicker, setShowPicker] = useState(false);
  const [showGenericAdd, setShowGenericAdd] = useState(false);
  const [addSlug, setAddSlug] = useState("");
  const [addOrg, setAddOrg] = useState(defaultOrg);

  const handleEdit = useCallback(() => {
    setDraft([...value]);
    setIsEditing(true);
    setShowPicker(false);
    setShowGenericAdd(false);
  }, [value, setIsEditing]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setDraft([...value]);
    setShowPicker(false);
    setShowGenericAdd(false);
  }, [value, setIsEditing]);

  const handleSave = useCallback(async () => {
    const ok = await onSave(draft);
    if (ok) {
      setIsEditing(false);
      setShowPicker(false);
      setShowGenericAdd(false);
    }
  }, [draft, onSave, setIsEditing]);

  const removeItem = useCallback((index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addItem = useCallback((ref: ResourceRefRow) => {
    setDraft((prev) => {
      const exists = prev.some((r) => r.org === ref.org && r.slug === ref.slug);
      if (exists) return prev;
      return [...prev, ref];
    });
    setShowPicker(false);
  }, []);

  if (disabled || !isEditing) {
    return (
      <div className={cn("stg:flex stg:flex-col", className)}>
        {value.length > 0 ? (
          <div className="stg:flex stg:flex-col stg:divide-y stg:divide-border">
            {value.map((ref, index) => {
              const label = ref.label ?? ref.slug;
              const row = (
                <div className="stg:flex stg:items-center stg:gap-3">
                  {itemIcon && <span className="stg:size-4 stg:shrink-0 stg:text-muted-foreground">{itemIcon}</span>}
                  <span className="stg:text-sm stg:font-medium stg:text-foreground">{label}</span>
                </div>
              );

              return onItemClick ? (
                <button
                  key={`${ref.org}/${ref.slug}` || index}
                  type="button"
                  onClick={() => onItemClick(ref)}
                  className={cn(
                    "stg:w-full stg:px-3 stg:py-2.5 stg:text-left stg:transition-colors",
                    "stg:hover:bg-accent-hover",
                    "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
                  )}
                >
                  {row}
                </button>
              ) : (
                <div key={`${ref.org}/${ref.slug}` || index} className="stg:px-3 stg:py-2.5">
                  {row}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="stg:px-3 stg:py-3 stg:text-xs stg:text-muted-foreground stg:italic">
            No {resourceLabel}s configured
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-2", className)}>
      {draft.length > 0 && (
        <div className="stg:flex stg:flex-col stg:divide-y stg:divide-border stg:rounded-md stg:border stg:border-border">
          {draft.map((ref, i) => (
            <div key={`${ref.org}/${ref.slug}`} className="stg:flex stg:items-center stg:gap-2 stg:px-3 stg:py-1.5">
              {itemIcon && <span className="stg:size-4 stg:shrink-0 stg:text-muted-foreground">{itemIcon}</span>}
              <span className="stg:flex-1 stg:text-sm stg:font-medium stg:text-foreground">
                {ref.label ?? ref.slug}
              </span>
              <button
                type="button"
                onClick={() => removeItem(i)}
                aria-label={`Remove ${ref.label ?? ref.slug}`}
                className={cn(
                  "stg:inline-flex stg:size-6 stg:items-center stg:justify-center stg:rounded-md stg:text-muted-foreground",
                  "stg:hover:bg-destructive-subtle stg:hover:text-destructive",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              >
                <XIcon className="stg:size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showPicker && renderPicker ? (
        <div className="stg:rounded-md stg:border stg:border-border stg:bg-muted-faint stg:p-2">
          {renderPicker(addItem)}
        </div>
      ) : showGenericAdd ? (
        <div className="stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:border stg:border-border stg:bg-muted-faint stg:p-2">
          <input
            type="text"
            value={addOrg}
            onChange={(e) => setAddOrg(e.target.value)}
            placeholder="org"
            className={cn(
              "stg:w-24 stg:rounded-md stg:border stg:border-border stg:bg-input-bg stg:px-2 stg:py-1 stg:text-xs stg:text-foreground",
              "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
            )}
          />
          <span className="stg:text-xs stg:text-muted-foreground">/</span>
          <input
            type="text"
            value={addSlug}
            onChange={(e) => setAddSlug(e.target.value)}
            placeholder="slug"
            onKeyDown={(e) => {
              if (e.key === "Enter" && addSlug.trim()) {
                addItem({ org: addOrg.trim() || defaultOrg, slug: addSlug.trim(), label: addSlug.trim() });
                setAddSlug("");
                setShowGenericAdd(false);
              } else if (e.key === "Escape") {
                setShowGenericAdd(false);
                setAddSlug("");
              }
            }}
            className={cn(
              "stg:flex-1 stg:rounded-md stg:border stg:border-border stg:bg-input-bg stg:px-2 stg:py-1 stg:text-xs stg:text-foreground",
              "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
            )}
          />
          <button
            type="button"
            onClick={() => {
              if (addSlug.trim()) {
                addItem({ org: addOrg.trim() || defaultOrg, slug: addSlug.trim(), label: addSlug.trim() });
                setAddSlug("");
                setShowGenericAdd(false);
              }
            }}
            disabled={!addSlug.trim()}
            className={cn(
              "stg:inline-flex stg:size-6 stg:items-center stg:justify-center stg:rounded-md",
              "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
              "stg:disabled:opacity-50",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            <PlusIcon className="stg:size-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => renderPicker ? setShowPicker(true) : setShowGenericAdd(true)}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:border stg:border-dashed stg:border-border stg:text-muted-foreground",
            "stg:hover:border-muted-foreground stg:hover:text-foreground stg:hover:bg-muted-subtle",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:transition-colors",
          )}
        >
          <PlusIcon className="stg:size-3" />
          Add {resourceLabel}
        </button>
      )}

      <div className="stg:flex stg:items-center stg:justify-end stg:gap-1.5">
        <button
          type="button"
          onClick={handleCancel}
          disabled={isSaving}
          className={cn(
            "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
            "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent",
            "stg:disabled:opacity-50",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:opacity-50",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          {isSaving && <Spinner />}
          Save changes
        </button>
      </div>

      {error && (
        <p className="stg:px-1 stg:text-xs stg:text-destructive" role="alert">{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function PencilIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.5 1.5a2.121 2.121 0 0 1 3 3L5 14l-4 1 1-4Z" />
    </svg>
  );
}

function PlusIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function XIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="stg:animate-spin" aria-hidden="true">
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
