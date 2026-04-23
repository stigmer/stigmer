"use client";

import { type MouseEvent, useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Plus, Sparkles, Server } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/theme";
import { getDraftSessionUrl } from "@/domain/session/draft-session";
import type { DraftResourceType } from "@/domain/session/draft-session";
import {
  useAgentCount,
  useSkillCount,
  useMcpServerCount,
  ResourceCountCard,
} from "@stigmer/react";
import { useActiveOrgSlug } from "@/domain/_shared/org/org-context";

function isPlainClick(e: MouseEvent): boolean {
  return !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0;
}

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

const ADD_MENU_ITEMS: readonly {
  readonly type: DraftResourceType;
  readonly label: string;
  readonly icon: React.ReactNode;
}[] = [
  {
    type: "agent",
    label: "Agent",
    icon: <Bot className="size-4" aria-hidden="true" />,
  },
  {
    type: "skill",
    label: "Skill",
    icon: <Sparkles className="size-4" aria-hidden="true" />,
  },
  {
    type: "mcp-server",
    label: "MCP Server",
    icon: <Server className="size-4" aria-hidden="true" />,
  },
];

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

  const handleCardClick = useCallback(
    (href: string) => (e: MouseEvent) => {
      if (isPlainClick(e)) {
        e.preventDefault();
        router.push(href);
      }
    },
    [router],
  );

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
              onClick={handleCardClick(card.href)}
            />
          );
        })}
      </div>

      <div className="mt-6">
        <AddResourceMenu />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AddResourceMenu — single "+ Add" button with a dropdown of
// resource types, each linking to the corresponding draft session.
// ---------------------------------------------------------------------------

function AddResourceMenu() {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
          "text-muted-foreground transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label="Add a new resource"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        Add
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start">
          <Popover.Popup
            className={cn(
              "z-popover min-w-[10rem] overflow-hidden rounded-lg",
              "border border-border bg-popover shadow-md text-popover-foreground",
            )}
          >
            <div className="py-1" role="menu">
              {ADD_MENU_ITEMS.map((item) => (
                <Link
                  key={item.type}
                  href={getDraftSessionUrl(item.type)}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-sm",
                    "text-foreground transition-colors hover:bg-accent",
                  )}
                >
                  <span className="shrink-0 text-muted-foreground">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
