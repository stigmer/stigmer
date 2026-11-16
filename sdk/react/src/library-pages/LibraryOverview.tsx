"use client";

// The Library's landing: one row per kind (agents, skills, plugins, routines,
// environments, files) saying what it is for and how many there are, an Add
// menu of only what the person may create, and Apply YAML, which can create
// any kind and so recounts every row. The counts count the organization's
// rows, the same set every list page shows; a count that fails says so, and
// its row still opens.

import { Fragment, type MouseEvent, type ReactNode, useCallback, useReducer, useState } from "react";
import { AlertCircle, Blocks, Bot, Box, CalendarClock, ChevronDown, ChevronRight, Files, Plus, Server, Sparkles, Upload } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/design-tokens";
import { IconButton } from "../button/IconButton.js";
import { buttonClasses } from "../button/buttonClasses.js";
import type { RenderLink } from "../button/LinkButton.js";
import { List, ListRow } from "../internal/surface/List.js";
import { Tag } from "../internal/surface/Tag.js";
import { ApplyManifestDialog } from "../manifest/ApplyManifestDialog.js";
import { PageHeader } from "../page/PageHeader.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { useAgentCount } from "../agent/useAgentCount.js";
import { useCanCreateAgent } from "../agent/useCanCreateAgent.js";
import { useSkillCount } from "../skill/useSkillCount.js";
import { useCanCreateSkill } from "../skill/useCanCreateSkill.js";
import { useCanCreatePlugin } from "../plugin/useCanCreatePlugin.js";
import { useRoutineCount } from "../routine/useRoutineCount.js";
import { usePluginCount } from "../plugin/usePluginList.js";
import { useEnvironmentCount } from "../environment/useEnvironmentCount.js";
import { useCanCreateEnvironment } from "../environment/useCanCreateEnvironment.js";
import { useFileCount } from "../file/useFileCount.js";
import { useCanCreateFile } from "../file/useCanCreateFile.js";
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

const RESOURCE_ROWS = [
  { key: "agents", label: "Agents", purpose: "The jobs your organization hands off.", href: LIBRARY_HREFS.agents, icon: <Bot aria-hidden="true" /> },
  { key: "skills", label: "Skills", purpose: "Know-how an agent loads when a task needs it.", href: LIBRARY_HREFS.skills, icon: <Sparkles aria-hidden="true" /> },
  { key: "plugins", label: "Plugins", purpose: "Installed bundles of skills, agents and tools.", href: LIBRARY_HREFS.plugins, icon: <Blocks aria-hidden="true" /> },
  { key: "routines", label: "Routines", purpose: "Agents started on a schedule or from another system.", href: LIBRARY_HREFS.routines, icon: <CalendarClock aria-hidden="true" /> },
  { key: "environments", label: "Environments", purpose: "Packages and network for your agents' sandboxes.", href: LIBRARY_HREFS.environments, icon: <Box aria-hidden="true" /> },
  { key: "files", label: "Files", purpose: "Files you keep for your routines to use.", href: LIBRARY_HREFS.files, icon: <Files aria-hidden="true" /> },
] as const;

interface AddMenuItem {
  readonly label: string;
  readonly icon: ReactNode;
  readonly href: string;
  /** Items that install a plugin, drawn after a separator. */
  readonly group?: "plugins";
}

const ADD_MENU_ITEMS: readonly AddMenuItem[] = [
  { label: "Agent", icon: <Bot className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.newAgent },
  { label: "Skill", icon: <Sparkles className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.newSkill },
  { label: "Routine", icon: <CalendarClock className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.newRoutine },
  { label: "Environment", icon: <Box className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.newEnvironment },
  { label: "File", icon: <Files className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.files },
  { label: "Upload plugin", icon: <Upload className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.uploadPlugin, group: "plugins" },
  { label: "MCP server", icon: <Server className="stg:size-4" aria-hidden="true" />, href: LIBRARY_HREFS.addMcpServer, group: "plugins" },
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
 * The Library's landing: one row per kind with what it is for and its count, the Add menu and Apply YAML.
 *
 * @example
 * ```tsx
 * <LibraryOverview onNavigate={(path) => window.location.assign(path)} />
 * ```
 */
export function LibraryOverview({ onNavigate, toHref = identity }: LibraryOverviewProps) {
  const org = useActiveOrgId();
  // Apply YAML here can create any kind, so a bump recounts every card.
  const [refetchToken, refreshCounts] = useReducer((n: number) => n + 1, 0);
  const counts = useResourceCounts(org || null, refetchToken);
  const [applyYamlOpen, setApplyYamlOpen] = useState(false);

  // A row's link goes through the host's router on a plain click; a modified
  // click (a new tab) is the browser's, at the host's address for the path.
  const renderRowLink: RenderLink = useCallback(
    ({ href, className, children }) => (
      <a
        href={toHref(href)}
        className={className}
        onClick={(e) => {
          if (isPlainClick(e)) {
            e.preventDefault();
            onNavigate(href);
          }
        }}
      >
        {children}
      </a>
    ),
    [onNavigate, toHref],
  );

  return (
    <>
      <PageHeader
        className="stg:mb-6"
        headingLevel={1}
        title="Library"
        description="What your agents are made of: the agents, their skills and plugins, the routines that start them, their environments and files."
        actions={
          <>
            <IconButton
              variant="outline"
              label="Apply YAML"
              icon={<Upload className="stg:size-3.5" aria-hidden="true" />}
              onClick={() => setApplyYamlOpen(true)}
            />
            <AddResourceMenu onNavigate={onNavigate} toHref={toHref} />
          </>
        }
      />

      <List aria-label="What the Library holds">
        {RESOURCE_ROWS.map((row) => {
          const rowCount = counts[row.key];
          const countIsLowerBound = "isLowerBound" in rowCount && rowCount.isLowerBound;
          return (
            <ListRow
              key={row.key}
              leading={
                <span
                  aria-hidden="true"
                  className="stg:grid stg:size-8 stg:place-items-center stg:rounded-lg stg:border stg:border-border stg:bg-card stg:text-muted-foreground stg:[&_svg]:size-4"
                >
                  {row.icon}
                </span>
              }
              name={row.label}
              description={row.purpose}
              href={row.href}
              renderLink={renderRowLink}
              trailing={
                <>
                  {rowCount.error ? (
                    <span className="stg:inline-flex stg:items-center stg:gap-1 stg:text-xs stg:text-muted-foreground">
                      <AlertCircle className="stg:size-3.5 stg:text-status-failed" aria-hidden="true" />
                      Count didn&rsquo;t load
                    </span>
                  ) : rowCount.isLoading ? (
                    <span className="stg:h-5 stg:w-6 stg:animate-pulse stg:rounded stg:bg-muted" aria-hidden="true" />
                  ) : (
                    <Tag>{`${rowCount.count}${countIsLowerBound ? "+" : ""}`}</Tag>
                  )}
                  <ChevronRight className="stg:size-4 stg:text-muted-foreground-subtle" aria-hidden="true" />
                </>
              }
            />
          );
        })}
      </List>

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
  const { allowed: canCreateSkill } = useCanCreateSkill(org || null);
  const { allowed: canInstallPlugin } = useCanCreatePlugin(org || null);
  // Only what this person may add: each kind the server lets them create.
  const addMenuItems = ADD_MENU_ITEMS.filter(
    (item) =>
      (canCreateAgent || item.href !== LIBRARY_HREFS.newAgent) &&
      (canCreateSkill || item.href !== LIBRARY_HREFS.newSkill) &&
      (canCreateEnvironment || item.href !== LIBRARY_HREFS.newEnvironment) &&
      (canCreateFile || item.href !== LIBRARY_HREFS.files) &&
      (canInstallPlugin || item.group !== "plugins"),
  );
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* The page's primary act, drawn as the kit's button; it opens a menu of links. */}
      <Popover.Trigger className={buttonClasses("primary", "sm")} aria-label="Add a new resource">
        <Plus className="stg:size-3.5" aria-hidden="true" />
        Add
        <ChevronDown className="stg:size-3.5" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} align="end" className="stg:isolate stg:z-popover">
          <Popover.Popup
            className={cn(
              "stg:z-popover stg:min-w-[10rem] stg:overflow-hidden stg:rounded-lg",
              "stg:border stg:border-border stg:bg-popover stg:shadow-md stg:text-popover-foreground",
            )}
          >
            <div className="stg:py-1" role="menu">
              {addMenuItems.map((item, index) => (
                <Fragment key={item.label}>
                {item.group === "plugins" && addMenuItems[index - 1]?.group !== "plugins" && index > 0 && (
                  <div role="separator" className="stg:my-1 stg:h-px stg:bg-border-muted" />
                )}
                <a
                  href={toHref(item.href)}
                  role="menuitem"
                  onClick={(e) => {
                    setOpen(false);
                    if (isPlainClick(e)) {
                      e.preventDefault();
                      onNavigate(item.href);
                    }
                  }}
                  // A host's own stylesheet may not reset a link's underline (the web
                  // console's does), so the item says it draws none.
                  className={cn(
                    "stg:flex stg:w-full stg:items-center stg:gap-2.5 stg:px-3 stg:py-2 stg:text-sm",
                    "stg:text-foreground stg:no-underline stg:transition-colors stg:hover:bg-accent",
                  )}
                >
                  <span className="stg:shrink-0 stg:text-muted-foreground">{item.icon}</span>
                  <span>{item.label}</span>
                </a>
                </Fragment>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
