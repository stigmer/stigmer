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
import { useStigmerPortalContainer } from "../portal-container.js";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../internal/menu.js";
import { useOrg } from "./OrgProvider.js";
import { CreateOrganizationForm } from "./CreateOrganizationForm.js";

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
  const portalContainer = useStigmerPortalContainer();

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
      <div className={cn("stg:flex stg:items-center stg:gap-2 stg:px-2 stg:py-1.5", className)}>
        <AlertCircle className="stg:text-destructive stg:size-4 stg:shrink-0" />
        <span className="stg:text-destructive stg:truncate stg:text-xs">{error}</span>
        <button
          onClick={retry}
          className="stg:text-sidebar-muted-foreground stg:hover:text-sidebar-foreground stg:shrink-0 stg:rounded stg:p-0.5 stg:transition-colors"
          aria-label="Retry loading organizations"
        >
          <RefreshCw className="stg:size-3" />
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
            "stg:hover:bg-sidebar-accent stg:flex stg:w-full stg:cursor-pointer stg:items-center stg:gap-2 stg:rounded-lg stg:px-2 stg:py-1.5 stg:text-sm stg:transition-colors stg:focus:outline-none",
            className,
          )}
        >
          <TriggerIcon className="stg:text-sidebar-muted-foreground stg:mt-0.5 stg:size-4 stg:shrink-0 stg:self-start" />
          {hasOrgs ? (
            <OrgLabel
              org={activeOrg}
              slugClassName="stg:text-sidebar-muted-foreground"
            />
          ) : (
            <span className="stg:text-sidebar-muted-foreground stg:truncate">
              No organizations
            </span>
          )}
          <ChevronsUpDown className="stg:text-sidebar-muted-foreground stg:ml-auto stg:mt-0.5 stg:size-3.5 stg:shrink-0 stg:self-start" />
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
                  className="stg:items-start"
                >
                  <User className="stg:mt-0.5 stg:size-3.5 stg:shrink-0" />
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
                  className="stg:items-start"
                >
                  <Building2 className="stg:mt-0.5 stg:size-3.5 stg:shrink-0" />
                  <OrgLabel org={org} />
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          )}

          {hasOrgs && <MenuSeparator />}

          <MenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="stg:size-4" />
            Create organization
          </MenuItem>
        </MenuContent>
      </Menu>

      <DialogPrimitive.Root
        open={createOpen}
        onOpenChange={(open) => setCreateOpen(open)}
      >
        <DialogPrimitive.Portal container={portalContainer}>
          <DialogPrimitive.Backdrop
            className={cn(
              "stg:fixed stg:inset-0 stg:z-50 stg:bg-black/50",
              "stg:data-open:animate-in stg:data-open:fade-in-0",
              "stg:data-closed:animate-out stg:data-closed:fade-out-0",
              "stg:duration-150",
            )}
          />
          {/* eslint-disable stigmer/no-main-tokens-in-sidebar -- The entire dialog is portaled outside the sidebar; main-area tokens are correct per DD-005. */}
          <DialogPrimitive.Popup
            className={cn(
              "stg:bg-background stg:text-foreground stg:ring-border/20",
              "stg:fixed stg:top-1/2 stg:left-1/2 stg:z-50 stg:w-full stg:max-w-md stg:-translate-x-1/2 stg:-translate-y-1/2 stg:rounded-lg stg:p-6 stg:shadow-lg stg:ring-1 stg:outline-none",
              "stg:data-open:animate-in stg:data-open:fade-in-0 stg:data-open:zoom-in-95",
              "stg:data-closed:animate-out stg:data-closed:fade-out-0 stg:data-closed:zoom-out-95",
              "stg:duration-150",
            )}
          >
            <DialogPrimitive.Title className="stg:text-foreground stg:text-sm stg:font-semibold">
              Create organization
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="stg:text-muted-foreground stg:mt-1 stg:mb-4 stg:text-xs">
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
    <span className="stg:min-w-0 stg:flex-1">
      <span className="stg:block stg:truncate stg:text-sm stg:font-medium stg:leading-tight">
        {name}
      </span>
      {slug && (
        <span
          className={cn(
            "stg:block stg:truncate stg:text-xs stg:leading-tight",
            // eslint-disable-next-line stigmer/no-main-tokens-in-sidebar -- OrgLabel renders inside portaled dropdown content (popover context)
            slugClassName ?? "stg:text-muted-foreground",
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
    <div className={cn("stg:flex stg:items-center stg:gap-2 stg:px-2 stg:py-1.5", className)}>
      <div className="stg:bg-sidebar-muted stg:size-4 stg:animate-pulse stg:rounded" />
      <div className="stg:bg-sidebar-muted stg:h-4 stg:w-24 stg:animate-pulse stg:rounded" />
    </div>
  );
}
