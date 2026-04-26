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
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { CreateOrganizationForm, useOrg } from "@stigmer/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/domain/_shared/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/domain/_shared/ui/dialog";

export function OrgSwitcher() {
  const { orgs, activeOrg, setActiveOrg, isLoading, error, retry, refresh } =
    useOrg();
  const [createOpen, setCreateOpen] = useState(false);

  const handleCreated = useCallback(
    (org: Organization) => {
      setCreateOpen(false);
      refresh(org.metadata?.slug);
    },
    [refresh],
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
    return <OrgSwitcherSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
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
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Organization menu"
          className="hover:bg-sidebar-accent flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors focus:outline-none"
        >
          <TriggerIcon className="text-sidebar-muted-foreground size-4 shrink-0 self-start mt-0.5" />
          {hasOrgs ? (
            <OrgLabel org={activeOrg} />
          ) : (
            <span className="text-sidebar-muted-foreground truncate">
              No organizations
            </span>
          )}
          <ChevronsUpDown className="text-sidebar-muted-foreground ml-auto size-3.5 shrink-0 self-start mt-0.5" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="bottom" sideOffset={4}>
          {hasOrgs && (
            <DropdownMenuRadioGroup
              value={activeOrg.metadata?.slug ?? ""}
              onValueChange={(val) => {
                const org = orgs.find((o) => o.metadata?.slug === val);
                if (org) setActiveOrg(org);
              }}
            >
              {personalOrgs.map((org) => (
                <DropdownMenuRadioItem
                  key={org.metadata?.slug}
                  value={org.metadata?.slug ?? ""}
                  className="items-start"
                >
                  <User className="size-3.5 shrink-0 mt-0.5" />
                  <OrgLabel org={org} />
                </DropdownMenuRadioItem>
              ))}
              {personalOrgs.length > 0 && teamOrgs.length > 0 && (
                <DropdownMenuSeparator />
              )}
              {teamOrgs.map((org) => (
                <DropdownMenuRadioItem
                  key={org.metadata?.slug}
                  value={org.metadata?.slug ?? ""}
                  className="items-start"
                >
                  <Building2 className="size-3.5 shrink-0 mt-0.5" />
                  <OrgLabel org={org} />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}

          {hasOrgs && <DropdownMenuSeparator />}

          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Create organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={(open) => setCreateOpen(open)}>
        <DialogContent>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription className="mt-1 mb-4">
            Organizations are tenancy boundaries that own agents, environments,
            and other resources.
          </DialogDescription>
          <CreateOrganizationForm
            onCreated={handleCreated}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrgLabel({ org }: { org: Organization }) {
  const name = org.metadata?.name || org.metadata?.slug;
  const slug = org.metadata?.slug;

  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium leading-tight">
        {name}
      </span>
      {slug && (
        <span className="text-sidebar-muted-foreground block truncate text-xs leading-tight">
          {slug}
        </span>
      )}
    </span>
  );
}

function OrgSwitcherSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="bg-sidebar-muted size-4 animate-pulse rounded" />
      <div className="bg-sidebar-muted h-4 w-24 animate-pulse rounded" />
    </div>
  );
}
