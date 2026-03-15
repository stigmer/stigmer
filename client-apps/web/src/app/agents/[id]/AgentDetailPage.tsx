"use client";

import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ErrorMessage } from "@/components/ui/error-message";
import { TopBar } from "@/components/layout/TopBar";
import { useAgent } from "@/hooks/agents/useAgent";
import { AgentDetailView } from "@/components/agent/AgentDetailView";
import { AgentSessionHistory } from "@/components/agent/AgentSessionHistory";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, error, refetch } = useAgent(id);

  const name = agent?.metadata?.name ?? "Agent";

  return (
    <div className="space-y-6">
      <TopBar
        title={name}
        breadcrumbs={[{ label: "Agents", href: "/agents" }, { label: name }]}
      />

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      )}

      {error && <ErrorMessage error={error} retry={refetch} />}

      {agent && <AgentDetailView agent={agent} />}

      {agent && (
        <>
          <Separator />
          <AgentSessionHistory agentId={id} />
        </>
      )}
    </div>
  );
}
