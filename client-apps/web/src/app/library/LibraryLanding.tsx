"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Plus, Sparkles, Server } from "lucide-react";
import {
  useAgentCount,
  useSkillCount,
  useMcpServerCount,
  ResourceCountCard,
} from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";

const RESOURCE_CARDS = [
  {
    key: "agents",
    label: "Agents",
    href: "/library/agents",
    icon: <Bot className="size-5" aria-hidden="true" />,
  },
  {
    key: "skills",
    label: "Skills",
    href: "/library/skills",
    icon: <Sparkles className="size-5" aria-hidden="true" />,
  },
  {
    key: "mcp-servers",
    label: "MCP Servers",
    href: "/library/mcp-servers",
    icon: <Server className="size-5" aria-hidden="true" />,
  },
] as const;

const CREATE_SHORTCUTS = [
  { label: "Create Agent", href: "/" },
  { label: "Create Skill", href: "/" },
  { label: "Create MCP Server", href: "/" },
] as const;

function useResourceCounts(org: string | null) {
  const agents = useAgentCount(org);
  const skills = useSkillCount(org);
  const mcpServers = useMcpServerCount(org);

  return { agents, skills, "mcp-servers": mcpServers } as const;
}

export function LibraryLanding() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  const counts = useResourceCounts(org || null);

  return (
    <>
      <h1 className="text-foreground mb-1 text-xl font-semibold">Library</h1>
      <p className="text-muted-foreground mb-8 text-sm">
        Browse and manage your agents, skills, and MCP servers.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {RESOURCE_CARDS.map((card) => {
          const { count, isLoading } = counts[card.key];

          return (
            <ResourceCountCard
              key={card.key}
              icon={card.icon}
              label={card.label}
              count={count}
              isLoading={isLoading}
              href={card.href}
              onClick={(e) => {
                e.preventDefault();
                router.push(card.href);
              }}
            />
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {CREATE_SHORTCUTS.map((shortcut) => (
          <Link
            key={shortcut.label}
            href={shortcut.href}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {shortcut.label}
          </Link>
        ))}
      </div>
    </>
  );
}
