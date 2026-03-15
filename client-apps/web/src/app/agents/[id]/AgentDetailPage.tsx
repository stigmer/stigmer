"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useAgentDetail } from "@/hooks/useAgentDetail";
import { AgentDetailView } from "@/components/agent/AgentDetailView";
import { AgentSessionHistory } from "@/components/agent/AgentSessionHistory";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { agent, isLoading, error } = useAgentDetail(id);

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

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border p-4 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Blueprint */}
      {agent && <AgentDetailView agent={agent} />}

      {/* Runtime — sessions for this agent */}
      {agent && (
        <>
          <Separator />
          <AgentSessionHistory agentId={id} />
        </>
      )}
    </div>
  );
}
