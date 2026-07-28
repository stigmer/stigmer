"use client";

import { type MouseEvent, useCallback, useReducer, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Database, FileCode2, Plus, Sparkles, Server, Workflow } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/theme";
import { getDraftSessionUrl } from "@/domain/session/draft-session";
import { readPersistedScope } from "@/domain/library/scope-persistence";
import {
  ApplyManifestDialog,
  useAgentCount,
  useDatastoreCount,
  useSkillCount,
  useMcpServerCount,
  useWorkflowCount,
  ResourceCountCard,
  useActiveOrgSlug,
} from "@stigmer/react";

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
    key: "workflows",
    label: "Workflows",
    href: "/library/workflows",
    icon: <Workflow className="size-5" aria-hidden="true" />,
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
  {
    key: "datastores",
    label: "Datastores",
    href: "/library/datastores",
    icon: <Database className="size-5" aria-hidden="true" />,
  },
] as const;

interface AddMenuItem {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly href: string;
}

const ADD_MENU_ITEMS: readonly AddMenuItem[] = [
  {
    label: "Agent",
    icon: <Bot className="size-4" aria-hidden="true" />,
    href: getDraftSessionUrl("agent"),
  },
  {
    label: "Workflow",
    icon: <Workflow className="size-4" aria-hidden="true" />,
    href: "/library/workflows/new",
  },
  {
    label: "Skill",
    icon: <Sparkles className="size-4" aria-hidden="true" />,
    href: getDraftSessionUrl("skill"),
  },
  {
    label: "MCP Server",
    icon: <Server className="size-4" aria-hidden="true" />,
    href: getDraftSessionUrl("mcp-server"),
  },
];

function useResourceCounts(org: string | null, refetchToken?: unknown) {
  const agentScope = readPersistedScope("agents");
  const workflowScope = readPersistedScope("workflows");
  const skillScope = readPersistedScope("skills");
  const mcpScope = readPersistedScope("mcp-servers");
  const datastoreScope = readPersistedScope("datastores");

  const agents = useAgentCount(org, { scope: agentScope, refetchToken });
  const workflows = useWorkflowCount(org, { scope: workflowScope, refetchToken });
  const skills = useSkillCount(org, { scope: skillScope, refetchToken });
  const mcpServers = useMcpServerCount(org, { scope: mcpScope, refetchToken });
  const datastores = useDatastoreCount(org, { scope: datastoreScope, refetchToken });

  return {
    agents,
    workflows,
    skills,
    "mcp-servers": mcpServers,
    datastores,
  } as const;
}

export function LibraryLanding() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  // Apply YAML here can create any kind, so a bump recounts every card.
  const [refetchToken, refreshCounts] = useReducer((n: number) => n + 1, 0);
  const counts = useResourceCounts(org || null, refetchToken);
  const [applyYamlOpen, setApplyYamlOpen] = useState(false);

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
        Browse and manage your agents, workflows, skills, and MCP servers.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <div className="mt-6 flex items-center gap-2">
        <AddResourceMenu />
        <button
          type="button"
          onClick={() => setApplyYamlOpen(true)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
            "text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <FileCode2 className="size-3.5" aria-hidden="true" />
          Apply YAML
        </button>
      </div>

      <ApplyManifestDialog
        open={applyYamlOpen}
        onOpenChange={setApplyYamlOpen}
        org={org ?? ""}
        onApplied={refreshCounts}
      />
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
                  key={item.label}
                  href={item.href}
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
