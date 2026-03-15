"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ErrorMessage } from "@/components/ui/error-message";
import { useAgent } from "@/hooks/agents/useAgent";
import { AgentDetailView } from "@/components/agent/AgentDetailView";
import { AgentSessionHistory } from "@/components/agent/AgentSessionHistory";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading, error, refetch } = useAgent(id);

  return (
    <div className="space-y-6">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-3">
        <Link
          href="/agents"
          aria-label="Back to agents"
          className="hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">
          {agent?.metadata?.name ?? "Agent"}
        </h1>
      </div>

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
