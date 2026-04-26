"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Building2,
  AlertCircle,
  RefreshCw,
  ChevronsUpDown,
  Plus,
  User,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { cn } from "@stigmer/theme";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../internal/menu";
import { useOrg } from "./OrgProvider";
import { CreateOrganizationForm } from "./CreateOrganizationForm";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link OrgSwitcher}. */
export interface OrgSwitcherProps {
  /**
   * Called when the user explicitly switches to a different organization
   * or creates a new one.
   *
   * This fires only on user-initiated changes — not on initial load,
   * background refresh, or programmatic context updates. Use it to
   * trigger side effects like navigation without fragile `useEffect`
   * guards on the active org.
   */
  readonly onOrgChanged?: (org: Organization) => void;
  /** Additional CSS class names merged onto the trigger (or root in error/loading states). */
  readonly className?: string;
}

/**
 * Organization switcher dropdown for sidebar navigation.
 *
 * Shows the active organization (name + slug), lists personal and team
 * organizations grouped with icons, and provides a "Create organization"
 * action that opens an inline dialog with {@link CreateOrganizationForm}.
 *
 * Designed for sidebar placement — the trigger uses `sidebar-*` design
 * tokens. The portaled dropdown and dialog use standard `popover-*` /
 * main-area tokens per theme-token-guidelines.
 *
 * Must be rendered inside an {@link OrgProvider}.
 *
 * @example
 * ```tsx
 * <OrgSwitcher onOrgChanged={(org) => navigate("/")} />
 * ```
 */
export function OrgSwitcher({ onOrgChanged, className }: OrgSwitcherProps) {
  const { orgs, activeOrg, setActiveOrg, isLoading, error, retry, refresh } =
    useOrg();
  const [createOpen, setCreateOpen] = useState(false);

  const handleOrgSwitch = useCallback(
    (slug: string) => {
      const org = orgs.find((o) => o.metadata?.slug === slug);
      if (org && org.metadata?.slug !== activeOrg?.metadata?.slug) {
        setActiveOrg(org);
        onOrgChanged?.(org);
      }
    },
    [orgs, activeOrg, setActiveOrg, onOrgChanged],
  );

  const handleCreated = useCallback(
    (org: Organization) => {
      setCreateOpen(false);
      refresh(org.metadata?.slug);
      onOrgChanged?.(org);
    },
    [refresh, onOrgChanged],
  );

  const personalOrgs = useMemo(
    () => orgs.filter((o) => o.spec?.isPersonal),
    [orgs],
  );
  const teamOrgs = useMemo(
    () => orgs.filter((o) => !o.spec?.isPersonal),
    [orgs],
  );

  if (isLoading) {
    return <OrgSwitcherSkeleton className={className} />;
  }

  if (error) {
    return (
      <div className={cn("flex items-center gap-2 px-2 py-1.5", className)}>
        <AlertCircle className="text-destructive size-4 shrink-0" />
        <span className="text-destructive truncate text-xs">{error}</span>
        <button
          onClick={retry}
          className="text-sidebar-muted-foreground hover:text-sidebar-foreground shrink-0 rounded p-0.5 transition-colors"
          aria-label="Retry loading organizations"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>
    );
  }

  const hasOrgs = orgs.length > 0 && activeOrg;
  const TriggerIcon = activeOrg?.spec?.isPersonal ? User : Building2;

  return (
    <>
      <Menu>
        <MenuTrigger
          aria-label="Organization menu"
          className={cn(
            "hover:bg-sidebar-accent flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors focus:outline-none",
            className,
          )}
        >
          <TriggerIcon className="text-sidebar-muted-foreground mt-0.5 size-4 shrink-0 self-start" />
          {hasOrgs ? (
            <OrgLabel
              org={activeOrg}
              slugClassName="text-sidebar-muted-foreground"
            />
          ) : (
            <span className="text-sidebar-muted-foreground truncate">
              No organizations
            </span>
          )}
          <ChevronsUpDown className="text-sidebar-muted-foreground ml-auto mt-0.5 size-3.5 shrink-0 self-start" />
        </MenuTrigger>

        <MenuContent align="start" side="bottom" sideOffset={4}>
          {hasOrgs && (
            <MenuRadioGroup
              value={activeOrg.metadata?.slug ?? ""}
              onValueChange={handleOrgSwitch}
            >
              {personalOrgs.map((org) => (
                <MenuRadioItem
                  key={org.metadata?.slug}
                  value={org.metadata?.slug ?? ""}
                  className="items-start"
                >
                  <User className="mt-0.5 size-3.5 shrink-0" />
                  <OrgLabel org={org} />
                </MenuRadioItem>
              ))}
              {personalOrgs.length > 0 && teamOrgs.length > 0 && (
                <MenuSeparator />
              )}
              {teamOrgs.map((org) => (
                <MenuRadioItem
                  key={org.metadata?.slug}
                  value={org.metadata?.slug ?? ""}
                  className="items-start"
                >
                  <Building2 className="mt-0.5 size-3.5 shrink-0" />
                  <OrgLabel org={org} />
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          )}

          {hasOrgs && <MenuSeparator />}

          <MenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Create organization
          </MenuItem>
        </MenuContent>
      </Menu>

      <DialogPrimitive.Root
        open={createOpen}
        onOpenChange={(open) => setCreateOpen(open)}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop
            className={cn(
              "fixed inset-0 z-50 bg-black/50",
              "data-open:animate-in data-open:fade-in-0",
              "data-closed:animate-out data-closed:fade-out-0",
              "duration-150",
            )}
          />
          {/* eslint-disable stigmer/no-main-tokens-in-sidebar -- The entire dialog is portaled outside the sidebar; main-area tokens are correct per DD-005. */}
          <DialogPrimitive.Popup
            className={cn(
              "bg-background text-foreground ring-border/20",
              "fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg p-6 shadow-lg ring-1 outline-none",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
              "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              "duration-150",
            )}
          >
            <DialogPrimitive.Title className="text-foreground text-sm font-semibold">
              Create organization
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-muted-foreground mt-1 mb-4 text-xs">
              Organizations are tenancy boundaries that own agents,
              environments, and other resources.
            </DialogPrimitive.Description>
            <CreateOrganizationForm
              onCreated={handleCreated}
              onCancel={() => setCreateOpen(false)}
            />
          </DialogPrimitive.Popup>
          {/* eslint-enable stigmer/no-main-tokens-in-sidebar */}
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

/**
 * Two-line org label: name (bold) + slug (muted). Used in the trigger
 * (sidebar context → pass `slugClassName="text-sidebar-muted-foreground"`)
 * and in dropdown radio items (popover context → default `text-muted-foreground`).
 */
function OrgLabel({
  org,
  slugClassName,
}: {
  org: Organization;
  slugClassName?: string;
}) {
  const name = org.metadata?.name || org.metadata?.slug;
  const slug = org.metadata?.slug;

  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium leading-tight">
        {name}
      </span>
      {slug && (
        <span
          className={cn(
            "block truncate text-xs leading-tight",
            // eslint-disable-next-line stigmer/no-main-tokens-in-sidebar -- OrgLabel renders inside portaled dropdown content (popover context)
            slugClassName ?? "text-muted-foreground",
          )}
        >
          {slug}
        </span>
      )}
    </span>
  );
}

function OrgSwitcherSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 px-2 py-1.5", className)}>
      <div className="bg-sidebar-muted size-4 animate-pulse rounded" />
      <div className="bg-sidebar-muted h-4 w-24 animate-pulse rounded" />
    </div>
  );
}
