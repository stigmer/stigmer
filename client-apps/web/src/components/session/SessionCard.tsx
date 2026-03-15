"use client";

import { useRouter } from "next/navigation";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCard as DomainSessionCard } from "@stigmer/session";

interface SessionCardProps {
  session: Session;
}

export function SessionCard({ session }: SessionCardProps) {
  const router = useRouter();

  return (
    <DomainSessionCard
      session={session}
      onNavigate={(id) => router.push(`/sessions/${id}`)}
    />
  );
}
