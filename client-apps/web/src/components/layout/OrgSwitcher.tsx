"use client";

import {
  Building2,
  AlertCircle,
  RefreshCw,
  ChevronsUpDown,
} from "lucide-react";
import { useOrg } from "@/contexts/org-context";
import { cn } from "@stigmer/theme";

export function OrgSwitcher() {
  const { orgs, activeOrg, setActiveOrg, isLoading, error, retry } = useOrg();

  if (isLoading) {
    return <OrgSwitcherSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <AlertCircle className="text-destructive size-4 shrink-0" />
        <span className="text-destructive flex-1 truncate text-xs">
          {error}
        </span>
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
      <div className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-xs">
        <Building2 className="size-4 shrink-0" />
        <span>No organizations</span>
      </div>
    );
  }

  if (orgs.length === 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <Building2 className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate text-sm font-medium">
          {activeOrg.metadata?.name || activeOrg.metadata?.slug}
        </span>
      </div>
    );
  }

  return (
    <div className="relative px-3 py-2">
      <Building2 className="text-muted-foreground pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2" />
      <ChevronsUpDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-5 size-3 -translate-y-1/2" />
      <select
        value={activeOrg.metadata?.slug ?? ""}
        onChange={(e) => {
          const org = orgs.find((o) => o.metadata?.slug === e.target.value);
          if (org) setActiveOrg(org);
        }}
        className={cn(
          "w-full cursor-pointer appearance-none rounded-md border bg-transparent py-1.5 pr-7 pl-7 text-sm font-medium",
          "focus:ring-ring focus:ring-2 focus:ring-offset-1 focus:outline-none",
          "hover:bg-accent/50 transition-colors",
        )}
      >
        {orgs.map((org) => (
          <option key={org.metadata?.slug} value={org.metadata?.slug ?? ""}>
            {org.metadata?.name || org.metadata?.slug}
          </option>
        ))}
      </select>
    </div>
  );
}

function OrgSwitcherSkeleton() {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="bg-muted size-4 animate-pulse rounded" />
      <div className="bg-muted h-4 w-24 animate-pulse rounded" />
    </div>
  );
}
