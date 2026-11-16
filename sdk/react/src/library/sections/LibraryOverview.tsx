"use client";

// The Library's landing: one count card per kind (agents, skills, routines,
// plugins, environments, files), an Add menu of what the person may create,
// and Apply YAML, which can create any kind and so recounts every card. The
// cards count the organization's rows, the same set every list page shows.

import { type MouseEvent, type ReactNode, useCallback, useReducer, useState } from "react";
import { Blocks, Bot, Box, CalendarClock, FileCode2, Files, Plus, Server, Sparkles } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/design-tokens";
import { Button } from "../../button/Button.js";
import { ApplyManifestDialog } from "../../manifest/ApplyManifestDialog.js";
import { PageHeader } from "../../page/PageHeader.js";
import { ResourceCountCard } from "../ResourceCountCard.js";
import { useActiveOrgId } from "../../organization/OrgProvider.js";
import { useAgentCount } from "../../agent/useAgentCount.js";
import { useCanCreateAgent } from "../../agent/useCanCreateAgent.js";
import { useSkillCount } from "../../skill/useSkillCount.js";
import { useRoutineCount } from "../../routine/useRoutineCount.js";
import { usePluginCount } from "../../plugin/usePluginList.js";
import { useEnvironmentCount } from "../../environment/useEnvironmentCount.js";
import { useCanCreateEnvironment } from "../../environment/useCanCreateEnvironment.js";
import { useFileCount } from "../../file/useFileCount.js";
import { useCanCreateFile } from "../../file/useCanCreateFile.js";
import { LIBRARY_HREFS } from "./navigation.js";

/** Props for {@link LibraryOverview}. */
export interface LibraryOverviewProps {
  /** Goes to a console address with the host's router (a card, an Add menu item). */
  readonly onNavigate: (path: string) => void;
  /**
   * The address a link writes for a console path, for a modified click (a new
   * tab); a hash-routed host prefixes `#`. @default the path itself
   */
  readonly toHref?: (path: string) => string;
}

function isPlainClick(e: MouseEvent): boolean {
  return !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0;
}

const identity = (path: string) => path;

const RESOURCE_CARDS = [
  { key: "agents", label: "Agents", href: LIBRARY_HREFS.agents, icon: <Bot className="stg:size-5" aria-hidden="true" /> },
  { key: "skills", label: "Skills", href: LIBRARY_HREFS.skills, icon: <Sparkles className="stg:size-5" aria-hidden="true" /> },
  { key: "routines", label: "Routines", href: LIBRARY_HREFS.routines, icon: <CalendarClock className="stg:size-5" aria-hidden="true" /> },
  { key: "plugins", label: "Plugins", href: LIBRARY_HREFS.plugins, icon: <Blocks className="stg:size-5" aria-hidden="true" /> },
  { key: "environments", label: "Environments", href: LIBRARY_HREFS.environments, icon: <Box className="stg:size-5" aria-hidden="true" /> },
  { key: "files", label: "Files", href: LIBRARY_HREFS.files, icon: <Files className="stg:size-5" aria-hidden="true" /> },
] as const;

interface AddMenuItem {
  readonly label: string;
  readonly icon: ReactNode;
  readonly href: string;
}

const ADD_MENU_ITEMS: readonly AddMenuItem[] = [
  { label: "Agent", icon: <Bot className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.newAgent },
  { label: "Skill", icon: <Sparkles className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.newSkill },
  { label: "MCP server", icon: <Server className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.addMcpServer },
  { label: "Routine", icon: <CalendarClock className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.newRoutine },
  { label: "Upload plugin", icon: <Blocks className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.uploadPlugin },
  { label: "Environment", icon: <Box className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.newEnvironment },
  // A File has no create page: the Files page's header uploads.
  { label: "File", icon: <Files className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.files },
];

// Cards count the organization's rows: the landing presents "your
// organization's library", the same set every list page shows.
function useResourceCounts(org: string | null, refetchToken: number) {
  const agents = useAgentCount(org, { refetchToken });
  const skills = useSkillCount(org, { refetchToken });
  const routines = useRoutineCount(org, { refetchToken });
  const plugins = usePluginCount(org, { refetchToken });
  const environments = useEnvironmentCount(org, { refetchToken });
  const files = useFileCount(org, { refetchToken });
  return { agents, skills, routines, plugins, environments, files } as const;
}

/**
 * The Library's landing: a count card per kind, the Add menu and Apply YAML.
 *
 * @example
 * ```tsx
 * <LibraryOverview onNavigate={(path) => router.push(path)} />
 * ```
 */
export function LibraryOverview({ onNavigate, toHref = identity }: LibraryOverviewProps) {
  const org = useActiveOrgId();
  // Apply YAML here can create any kind, so a bump recounts every card.
  const [refetchToken, refreshCounts] = useReducer((n: number) => n + 1, 0);
  const counts = useResourceCounts(org || null, refetchToken);
  const [applyYamlOpen, setApplyYamlOpen] = useState(false);

  const handleCardClick = useCallback(
    (href: string) => (e: MouseEvent) => {
      if (isPlainClick(e)) {
        e.preventDefault();
        onNavigate(href);
      }
    },
    [onNavigate],
  );

  return (
    <>
      <PageHeader
        className="stg:mb-6"
        headingLevel={1}
        title="Library"
        description="Browse and manage your agents, skills, plugins, environments, and files."
        actions={
          <>
            <AddResourceMenu onNavigate={onNavigate} toHref={toHref} />
            <Button variant="ghost" icon={<FileCode2 className="stg:size-3.5" aria-hidden="true" />} onClick={() => setApplyYamlOpen(true)}>
              Apply YAML
            </Button>
          </>
        }
      />

      <div className="stg:grid stg:grid-cols-1 stg:gap-4 stg:sm:grid-cols-2 stg:lg:grid-cols-3">
        {RESOURCE_CARDS.map((card) => {
          const cardCount = counts[card.key];
          const { count, isLoading } = cardCount;
          // Routines, environments and files have no search count: their cards
          // count a first page and read "100+" when more follow.
          const countIsLowerBound = "isLowerBound" in cardCount && cardCount.isLowerBound;
          return (
            <ResourceCountCard
              key={card.key}
              icon={card.icon}
              label={card.label}
              count={count}
              countIsLowerBound={countIsLowerBound}
              isLoading={isLoading}
              href={toHref(card.href)}
              onClick={handleCardClick(card.href)}
            />
          );
        })}
      </div>

      <ApplyManifestDialog open={applyYamlOpen} onOpenChange={setApplyYamlOpen} org={org ?? ""} onApplied={refreshCounts} />
    </>
  );
}

// One "+ Add" button with a dropdown of the kinds the person may create,
// each going to that kind's create page.
function AddResourceMenu({ onNavigate, toHref }: Required<LibraryOverviewProps>) {
  const org = useActiveOrgId();
  // "Agent" is offered only to someone the server lets create one: admins,
  // and members while the organization lets members create agents.
  const { allowed: canCreateAgent } = useCanCreateAgent(org || null);
  // "Environment" is offered only to the organization's admins, and not
  // until the server has said so, so a member never sees it flash.
  const { allowed: canCreateEnvironment } = useCanCreateEnvironment(org || null);
  // "File" is offered to whoever may upload one: members and guests.
  const { allowed: canCreateFile } = useCanCreateFile(org || null);
  const addMenuItems = ADD_MENU_ITEMS.filter(
    (item) =>
      (canCreateAgent || item.href !== LIBRARY_HREFS.newAgent) &&
      (canCreateEnvironment || item.href !== LIBRARY_HREFS.newEnvironment) &&
      (canCreateFile || item.href !== LIBRARY_HREFS.files),
  );
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn(
          "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm",
          "stg:text-muted-foreground stg:transition-colors",
          "stg:hover:bg-accent stg:hover:text-accent-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        )}
        aria-label="Add a new resource"
      >
        <Plus className="stg:size-3.5" aria-hidden="true" />
        Add
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="start">
          <Popover.Popup
            className={cn(
              "stg:z-popover stg:min-w-[10rem] stg:overflow-hidden stg:rounded-lg",
              "stg:border stg:border-border stg:bg-popover stg:shadow-md stg:text-popover-foreground",
            )}
          >
            <div className="stg:py-1" role="menu">
              {addMenuItems.map((item) => (
                <a
                  key={item.label}
                  href={toHref(item.href)}
                  role="menuitem"
                  onClick={(e) => {
                    setOpen(false);
                    if (isPlainClick(e)) {
                      e.preventDefault();
                      onNavigate(item.href);
                    }
                  }}
                  className={cn(
                    "stg:flex stg:w-full stg:items-center stg:gap-2.5 stg:px-3 stg:py-2 stg:text-sm",
                    "stg:text-foreground stg:transition-colors stg:hover:bg-accent",
                  )}
                >
                  <span className="stg:shrink-0 stg:text-muted-foreground">{item.icon}</span>
                  <span>{item.label}</span>
                </a>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
