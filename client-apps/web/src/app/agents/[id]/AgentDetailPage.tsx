"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { Loader2, Play } from "lucide-react";
import { AgentOverview } from "@stigmer/agent";
import { AgentSessionHistory } from "@stigmer/session";
import { Separator } from "@/components/ui/separator";
import { ErrorMessage } from "@/components/ui/error-message";
import { TopBar } from "@/components/layout/TopBar";
import { useAgent } from "@/hooks/agents/useAgent";
import { useDynamicRouteId } from "@/hooks/useDynamicRouteId";

export default function AgentDetailPage() {
  const id = useDynamicRouteId();
  const router = useRouter();
  const { data: agent, isLoading, error, refetch } = useAgent(id);

  const name = agent?.metadata?.name ?? "Agent";
  const handleSessionSelect = useCallback(
    (sessionId: string) => router.push(`/sessions/${sessionId}`),
    [router],
  );

  return (
    <div className="space-y-6">
      <TopBar
        title={name}
        breadcrumbs={[{ label: "Agents", href: "/agents" }, { label: name }]}
        actions={
          agent && (
            <Link
              href={`/run?agentId=${agent.metadata?.id ?? ""}`}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
            >
              <Play className="size-3.5" />
              Run Agent
            </Link>
          )
        }
      />

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      )}

      {error && <ErrorMessage error={error} retry={refetch} />}

      {agent && <AgentOverview agent={agent} />}

      {agent && (
        <>
          <Separator />
          <AgentSessionHistory agentId={id} onSessionSelect={handleSessionSelect} />
        </>
      )}
    </div>
  );
}
