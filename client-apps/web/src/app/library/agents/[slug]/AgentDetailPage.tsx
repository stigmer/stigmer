"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { AgentDetailView } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { getEditSessionUrl } from "@/utils/draft-session";

export function AgentDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const org = useActiveOrgSlug();
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link
          href={getEditSessionUrl("agent", org, slug)}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          Edit
        </Link>
      </div>

      <AgentDetailView
        org={org}
        slug={slug}
        onMcpServerClick={({ slug: s }) =>
          router.push(`/library/mcp-servers/${s}`)
        }
        onSkillClick={({ slug: s }) => router.push(`/library/skills/${s}`)}
      />
    </div>
  );
}
