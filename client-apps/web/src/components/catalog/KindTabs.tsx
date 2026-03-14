"use client";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { Bot, FileCode2, Server, LayoutGrid } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KindTab {
  kind: ApiResourceKind | null;
  label: string;
  icon: LucideIcon;
  countKey: string | null;
}

const TABS: KindTab[] = [
  { kind: null, label: "All", icon: LayoutGrid, countKey: null },
  { kind: ApiResourceKind.agent, label: "Agents", icon: Bot, countKey: "agent" },
  {
    kind: ApiResourceKind.skill,
    label: "Skills",
    icon: FileCode2,
    countKey: "skill",
  },
  {
    kind: ApiResourceKind.mcp_server,
    label: "MCP Servers",
    icon: Server,
    countKey: "mcp_server",
  },
];

interface KindTabsProps {
  activeKind: ApiResourceKind | null;
  onKindChange: (kind: ApiResourceKind | null) => void;
  countsByKind: Record<string, number>;
  totalCount: number;
}

export function KindTabs({
  activeKind,
  onKindChange,
  countsByKind,
  totalCount,
}: KindTabsProps) {
  return (
    <div role="tablist" className="flex gap-1.5 overflow-x-auto">
      {TABS.map((tab) => {
        const isActive = activeKind === tab.kind;
        const count =
          tab.countKey != null ? (countsByKind[tab.countKey] ?? 0) : totalCount;
        const Icon = tab.icon;

        return (
          <button
            key={tab.label}
            role="tab"
            aria-selected={isActive}
            onClick={() => onKindChange(tab.kind)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {tab.label}
            {count > 0 && (
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                  isActive
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted-foreground/10 text-muted-foreground",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
