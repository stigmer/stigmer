"use client";

import { useParams, useRouter } from "next/navigation";
import { AgentDetailView } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";

export function AgentDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const org = useActiveOrgSlug();
  const router = useRouter();

  return (
    <AgentDetailView
      org={org}
      slug={slug}
      onMcpServerClick={({ slug: s }) =>
        router.push(`/library/mcp-servers/${s}`)
      }
      onSkillClick={({ slug: s }) => router.push(`/library/skills/${s}`)}
    />
  );
}
