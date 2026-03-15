"use client";

import Link from "next/link";
import { Bot, FileCode2, Server, type LucideIcon } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import {
  useDashboardCounts,
  type ResourceCount,
} from "@/hooks/dashboard/useDashboardCounts";

interface StatCardProps {
  label: string;
  href: string;
  icon: LucideIcon;
  stat: ResourceCount;
}

function StatCard({ label, href, icon: Icon, stat }: StatCardProps) {
  return (
    <Link href={href}>
      <Card size="sm" className="hover:bg-muted/50 h-full transition-colors">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="bg-primary/10 flex size-8 shrink-0 items-center justify-center rounded-lg">
                <Icon className="text-primary size-4" />
              </div>
              <span className="text-muted-foreground text-sm font-medium">
                {label}
              </span>
            </div>
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {stat.isLoading ? (
                <span className="bg-muted/60 inline-block h-7 w-8 animate-pulse rounded" />
              ) : stat.error ? (
                <span className="text-muted-foreground/50">&mdash;</span>
              ) : (
                stat.count
              )}
            </span>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}

const RESOURCE_STATS = [
  { label: "Agents", href: "/agents", icon: Bot },
  { label: "Skills", href: "/skills", icon: FileCode2 },
  { label: "MCP Servers", href: "/mcp-servers", icon: Server },
] as const;

export function ResourceOverview() {
  const counts = useDashboardCounts();

  const countByLabel: Record<string, ResourceCount> = {
    Agents: counts.agents,
    Skills: counts.skills,
    "MCP Servers": counts.mcpServers,
  };

  return (
    <section aria-label="Resource overview">
      <div className="grid gap-4 sm:grid-cols-3">
        {RESOURCE_STATS.map((item) => (
          <StatCard
            key={item.href}
            label={item.label}
            href={item.href}
            icon={item.icon}
            stat={countByLabel[item.label]}
          />
        ))}
      </div>
    </section>
  );
}
