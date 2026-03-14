"use client";

import { Building2, AlertCircle, RefreshCw, ChevronsUpDown } from "lucide-react";
import { useOrg } from "@/contexts/org-context";
import { cn } from "@/lib/utils";

export function OrgSwitcher() {
  const { orgs, activeOrg, setActiveOrg, isLoading, error, retry } = useOrg();

  if (isLoading) {
    return <OrgSwitcherSkeleton />;
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <AlertCircle className="size-4 shrink-0 text-destructive" />
        <span className="flex-1 truncate text-xs text-destructive">
          {error}
        </span>
        <button
          onClick={retry}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Retry loading organizations"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>
    );
  }

  if (orgs.length === 0 || !activeOrg) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Building2 className="size-4 shrink-0" />
        <span>No organizations</span>
      </div>
    );
  }

  if (orgs.length === 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <Building2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">
          {activeOrg.metadata?.name || activeOrg.metadata?.slug}
        </span>
      </div>
    );
  }

  return (
    <div className="relative px-3 py-2">
      <Building2 className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <ChevronsUpDown className="pointer-events-none absolute right-5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
      <select
        value={activeOrg.metadata?.slug ?? ""}
        onChange={(e) => {
          const org = orgs.find((o) => o.metadata?.slug === e.target.value);
          if (org) setActiveOrg(org);
        }}
        className={cn(
          "w-full cursor-pointer appearance-none rounded-md border bg-transparent py-1.5 pl-7 pr-7 text-sm font-medium",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
          "transition-colors hover:bg-accent/50",
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
      <div className="size-4 animate-pulse rounded bg-muted" />
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
    </div>
  );
}
