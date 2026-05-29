"use client";

import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import type { HarnessOption } from "../../models/harness";
import { HARNESS_META } from "../../models/harness";
import type { ExecutionTargetOption } from "../execution-target";
import type { UseSessionVariablesReturn } from "../../execution/useSessionVariables";
import type { UseWorkspaceEntriesReturn } from "../../workspace/useWorkspaceEntries";
import type { UseGitHubConnectionReturn } from "../../github/useGitHubConnection";

// ---------------------------------------------------------------------------
// Workspace action callbacks — kept optional so the tab renders read-only
// when callbacks are absent (DD-011 backward compatibility).
// ---------------------------------------------------------------------------

/** Interactive mutation callbacks for workspace actions in SetupTab. */
export interface SetupTabWorkspaceActions {
  /** Workspace state from {@link useWorkspaceEntries}. */
  readonly workspace: UseWorkspaceEntriesReturn;
  /** Whether to enable the GitHub repo source action. */
  readonly enableGitHub?: boolean;
  /** Whether to enable the local folder source action. */
  readonly enableLocal?: boolean;
  /** GitHub connection state for the repo picker drill-in. */
  readonly gitHubConnection?: UseGitHubConnectionReturn;
  /** Native folder picker callback for desktop environments. */
  readonly onBrowseLocalFolder?: () => Promise<string | null>;
}

/** Interactive mutation callbacks for config items in SetupTab. */
export interface SetupTabMutationCallbacks {
  /** Remove the current agent. Absent = non-removable (e.g. default agent). */
  readonly onRemoveAgent?: () => void;
  /** Remove an MCP server by its org/slug ref. */
  readonly onRemoveMcp?: (ref: ResourceRef) => void;
  /** Remove a skill by its org/slug ref. */
  readonly onRemoveSkill?: (ref: ResourceRef) => void;
}

/** Props for {@link SetupTab}. */
export interface SetupTabProps {
  readonly agentRef: ResourceRef | null;
  readonly isDefaultAgent: boolean;
  readonly mcpServerUsages: readonly McpServerUsageInput[];
  readonly skillRefs: readonly ResourceRef[];
  readonly sessionVariables: UseSessionVariablesReturn | null;
  readonly harness: HarnessOption;
  readonly executionTarget: ExecutionTargetOption | undefined;
  readonly modelId: string | undefined;
  /**
   * Interactive workspace actions. When provided, the Workspace section
   * renders add/remove affordances. When absent, workspace entries are
   * not shown (backward compatible with the read-only Setup tab).
   */
  readonly workspaceActions?: SetupTabWorkspaceActions;
  /**
   * Interactive mutation callbacks. When provided, items render remove
   * buttons. When absent, sections are read-only (DD-011).
   */
  readonly mutations?: SetupTabMutationCallbacks;
}

/**
 * Persistent session configuration panel — the canonical source of
 * truth for what agent, MCP servers, skills, workspace, and run
 * config are active.
 *
 * When mutation callbacks are provided via `mutations` and
 * `workspaceActions`, items render inline remove/reconfigure
 * affordances. When callbacks are absent, sections render read-only
 * (backward compatible, DD-011).
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function SetupTab({
  agentRef,
  isDefaultAgent,
  mcpServerUsages,
  skillRefs,
  sessionVariables,
  harness,
  executionTarget,
  modelId,
  workspaceActions,
  mutations,
}: SetupTabProps) {
  const hasSessionVars = sessionVariables != null && !sessionVariables.isEmpty;

  return (
    <div className="flex flex-col gap-5">
      {workspaceActions && (
        <WorkspaceSection actions={workspaceActions} />
      )}

      <RunConfigSection
        harness={harness}
        executionTarget={executionTarget}
        modelId={modelId}
      />

      <AgentSection
        agentRef={agentRef}
        isDefaultAgent={isDefaultAgent}
        onRemove={mutations?.onRemoveAgent}
      />

      <McpSection
        mcpServerUsages={mcpServerUsages}
        onRemove={mutations?.onRemoveMcp}
      />

      <SkillsSection
        skillRefs={skillRefs}
        onRemove={mutations?.onRemoveSkill}
      />

      {hasSessionVars && (
        <SessionVarsSection entries={sessionVariables.entries} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared section primitives
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground/70">{children}</p>
  );
}

function ItemPill({ children, className: cls }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-md bg-muted-subtle px-2 py-1 text-xs text-foreground",
      cls,
    )}>
      {children}
    </span>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
      aria-label={label}
    >
      <XIcon />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Workspace section
// ---------------------------------------------------------------------------

function WorkspaceSection({ actions }: { actions: SetupTabWorkspaceActions }) {
  const { workspace, enableGitHub = true, enableLocal = false, onBrowseLocalFolder } = actions;
  const canBrowse = enableLocal && onBrowseLocalFolder;

  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeading>
        Workspace
        {workspace.entries.length > 0 && (
          <span className="ml-1 text-muted-foreground/60">({workspace.entries.length})</span>
        )}
      </SectionHeading>

      {workspace.entries.length > 0 && (
        <div className="flex flex-col gap-1">
          {workspace.entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-2 rounded-md border border-border bg-muted-faint px-2.5 py-1.5 text-xs"
            >
              {entry.type === "git" ? (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                  GitHub
                </span>
              ) : (
                <span className="shrink-0 text-muted-foreground">
                  <FolderIcon />
                </span>
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-foreground",
                  entry.type === "local" && "[direction:rtl] text-left",
                )}
                title={entry.name}
              >
                <bdi>{entry.name}</bdi>
              </span>
              <RemoveButton
                onClick={() => workspace.remove(entry.id)}
                label={`Remove ${entry.name}`}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {canBrowse && (
          <button
            type="button"
            onClick={async () => {
              const path = await onBrowseLocalFolder();
              if (path) workspace.addLocalPath(path);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs text-foreground transition-colors hover:bg-accent-hover"
          >
            <FolderIcon />
            <span className="flex-1 text-left">Browse Folder</span>
          </button>
        )}
        {enableGitHub && (
          <button
            type="button"
            onClick={() => {
              /* GitHub picker is handled via the composer's Configure menu.
                 This button is a placeholder affordance that can be wired
                 to a drill-in panel in the future. For now, it provides
                 visual parity with the WorkspaceEditor. */
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs text-foreground transition-colors hover:bg-accent-hover"
          >
            <GitHubIcon />
            <span className="flex-1 text-left">Connect GitHub</span>
          </button>
        )}
      </div>

      {workspace.entries.length === 0 && !canBrowse && !enableGitHub && (
        <EmptyHint>No workspace attached.</EmptyHint>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Run config
// ---------------------------------------------------------------------------

function RunConfigSection({
  harness,
  executionTarget,
  modelId,
}: {
  harness: HarnessOption;
  executionTarget: ExecutionTargetOption | undefined;
  modelId: string | undefined;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeading>Run Config</SectionHeading>
      <div className="flex flex-wrap gap-1.5">
        <ItemPill>
          <span className="text-muted-foreground">Harness</span>
          {HARNESS_META[harness]?.label ?? harness}
        </ItemPill>
        {modelId && (
          <ItemPill>
            <span className="text-muted-foreground">Model</span>
            {modelId}
          </ItemPill>
        )}
        {executionTarget && (
          <ItemPill>
            <span className="text-muted-foreground">Target</span>
            {executionTarget === "local" ? "Local" : "Cloud"}
          </ItemPill>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

function AgentSection({
  agentRef,
  isDefaultAgent,
  onRemove,
}: {
  agentRef: ResourceRef | null;
  isDefaultAgent: boolean;
  onRemove?: () => void;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeading>Agent</SectionHeading>
      {agentRef ? (
        <div className="flex items-center gap-1.5">
          <ItemPill>
            {agentRef.slug}
            {onRemove && !isDefaultAgent && (
              <RemoveButton onClick={onRemove} label={`Remove agent ${agentRef.slug}`} />
            )}
          </ItemPill>
          {isDefaultAgent && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.6rem] font-medium text-primary">
              default
            </span>
          )}
        </div>
      ) : (
        <EmptyHint>No agent selected — using platform default.</EmptyHint>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// MCP Servers
// ---------------------------------------------------------------------------

function McpSection({
  mcpServerUsages,
  onRemove,
}: {
  mcpServerUsages: readonly McpServerUsageInput[];
  onRemove?: (ref: ResourceRef) => void;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeading>
        MCP Servers
        {mcpServerUsages.length > 0 && (
          <span className="ml-1 text-muted-foreground/60">({mcpServerUsages.length})</span>
        )}
      </SectionHeading>
      {mcpServerUsages.length > 0 ? (
        <div className="flex flex-col gap-1">
          {mcpServerUsages.map((usage) => {
            const slug = usage.mcpServerRef.slug;
            const enabledCount = usage.enabledTools?.length;
            return (
              <ItemPill key={`${usage.mcpServerRef.org}/${slug}`}>
                <span>{slug}</span>
                {enabledCount != null && enabledCount > 0 && (
                  <span className="text-muted-foreground">
                    {enabledCount} tool{enabledCount !== 1 ? "s" : ""}
                  </span>
                )}
                {onRemove && (
                  <RemoveButton
                    onClick={() => onRemove(usage.mcpServerRef)}
                    label={`Remove MCP server ${slug}`}
                  />
                )}
              </ItemPill>
            );
          })}
        </div>
      ) : (
        <EmptyHint>No MCP servers attached.</EmptyHint>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function SkillsSection({
  skillRefs,
  onRemove,
}: {
  skillRefs: readonly ResourceRef[];
  onRemove?: (ref: ResourceRef) => void;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeading>
        Skills
        {skillRefs.length > 0 && (
          <span className="ml-1 text-muted-foreground/60">({skillRefs.length})</span>
        )}
      </SectionHeading>
      {skillRefs.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {skillRefs.map((ref) => (
            <ItemPill key={`${ref.org}/${ref.slug}`}>
              {ref.slug}
              {onRemove && (
                <RemoveButton
                  onClick={() => onRemove(ref)}
                  label={`Remove skill ${ref.slug}`}
                />
              )}
            </ItemPill>
          ))}
        </div>
      ) : (
        <EmptyHint>No skills attached.</EmptyHint>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Session Variables (ephemeral, only shown when entries exist)
// ---------------------------------------------------------------------------

function SessionVarsSection({
  entries,
}: {
  entries: UseSessionVariablesReturn["entries"];
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeading>
        Session Variables
        <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/60">
          (next message only)
        </span>
      </SectionHeading>
      <div className="flex flex-col gap-1">
        {entries.map((entry) => (
          <ItemPill key={entry.id}>
            <span className="font-medium">{entry.key || "(unnamed)"}</span>
            {entry.isSecret ? (
              <span className="text-muted-foreground">********</span>
            ) : (
              <span className="max-w-[140px] truncate text-muted-foreground">{entry.value}</span>
            )}
          </ItemPill>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 3.5V11a1 1 0 001 1h9a1 1 0 001-1V5.5a1 1 0 00-1-1H7L5.5 3H2.5a1 1 0 00-1 .5z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
