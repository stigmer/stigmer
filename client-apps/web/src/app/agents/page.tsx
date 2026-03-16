"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { ResourceList } from "@/components/resource-list";
import { ResourceSearchCard } from "@stigmer/react/catalog";
import { useAgentList } from "@/hooks/agents/useAgentList";

export default function AgentsPage() {
  const data = useAgentList();

  return (
    <>
      <TopBar
        title="Agents"
        description="Browse and search the agent catalog"
        actions={
          <Link
            href="/run"
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
          >
            <Play className="size-3.5" />
            Run Agent
          </Link>
        }
      />
      <ResourceList
        kindLabel="agents"
        data={data}
        layout="grid"
        renderItem={(result) => (
          <Link href={`/agents/${result.id}`} className="block">
            <ResourceSearchCard result={result} />
          </Link>
        )}
      />
    </>
  );
}
