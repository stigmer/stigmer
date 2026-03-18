"use client";

import {
  Building2,
  AlertCircle,
  RefreshCw,
  ChevronsUpDown,
} from "lucide-react";
import { useOrg } from "@/contexts/org-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function OrgSwitcher() {
  const { orgs, activeOrg, setActiveOrg, isLoading, error, retry } = useOrg();

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
          className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5 transition-colors"
          aria-label="Retry loading organizations"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>
    );
  }

  if (orgs.length === 0 || !activeOrg) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-sm">
        <Building2 className="size-4 shrink-0" />
        <span>No organizations</span>
      </div>
    );
  }

  const orgLabel = activeOrg.metadata?.name || activeOrg.metadata?.slug;

  if (orgs.length === 1) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-sm font-medium">
        <Building2 className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate">{orgLabel}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch organization"
        className="hover:bg-sidebar-accent flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors focus:outline-none"
      >
        <Building2 className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate">{orgLabel}</span>
        <ChevronsUpDown className="text-muted-foreground ml-auto size-3.5 shrink-0" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="bottom" sideOffset={4}>
        <DropdownMenuRadioGroup
          value={activeOrg.metadata?.slug ?? ""}
          onValueChange={(val) => {
            const org = orgs.find((o) => o.metadata?.slug === val);
            if (org) setActiveOrg(org);
          }}
        >
          {orgs.map((org) => (
            <DropdownMenuRadioItem
              key={org.metadata?.slug}
              value={org.metadata?.slug ?? ""}
            >
              {org.metadata?.name || org.metadata?.slug}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OrgSwitcherSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="bg-muted size-4 animate-pulse rounded" />
      <div className="bg-muted h-4 w-24 animate-pulse rounded" />
    </div>
  );
}
