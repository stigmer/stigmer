"use client";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { cn } from "@stigmer/theme";
import type { ShareFlowResource } from "./useShareFlow.js";
import { PeopleWithAccess } from "./PeopleWithAccess.js";

/** Props for {@link SharePanel}. */
export interface SharePanelProps {
  /** The resource to share. */
  readonly resource: ShareFlowResource;
  /** Resource kind string for the API ref (e.g. "agent", "session"). */
  readonly resourceKindString: string;
  /** ApiResourceKind enum value for grantable-role lookup. */
  readonly resourceKind: ApiResourceKind;
  /**
   * Organization the resource belongs to (`metadata.org`). Drives the
   * org-member typeahead in the grant form.
   */
  readonly orgId: string;
  /** Fired when the user closes the panel. */
  readonly onClose?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained sharing panel that displays who has access to a
 * resource and allows granting/revoking access.
 *
 * A thin header-and-close wrapper around {@link PeopleWithAccess} — the same
 * "people with access" body the unified Manage access dialog renders — so the
 * two surfaces stay byte-for-byte consistent. Suitable for embedding in a
 * popover or sidebar; for the full visibility + people experience use the
 * Manage access dialog instead.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <SharePanel
 *   resource={{ kind: "session", id: sessionId, resourceKind: ApiResourceKind.session }}
 *   resourceKindString="session"
 *   resourceKind={ApiResourceKind.session}
 *   orgId={orgId}
 *   onClose={() => setOpen(false)}
 * />
 * ```
 */
export function SharePanel({
  resource,
  resourceKindString,
  resourceKind,
  orgId,
  onClose,
  className,
}: SharePanelProps) {
  return (
    <div
      className={cn("flex flex-col gap-4 p-4", className)}
      role="region"
      aria-label="Resource access management"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Share access
        </h3>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share panel"
            className={cn(
              "rounded-md p-1 text-muted-foreground",
              "hover:text-foreground hover:bg-accent-hover",
            )}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <PeopleWithAccess
        resource={resource}
        resourceKindString={resourceKindString}
        resourceKind={resourceKind}
        orgId={orgId}
      />
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
