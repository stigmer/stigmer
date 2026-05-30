"use client";

import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import type { HarnessOption } from "../../models/harness";
import { HARNESS_META } from "../../models/harness";
import type { ExecutionTargetOption } from "../execution-target";
import type { UseSessionVariablesReturn } from "../../execution/useSessionVariables";

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
   * Interactive mutation callbacks. When provided, items render remove
   * buttons. When absent, sections are read-only (DD-011).
   */
  readonly mutations?: SetupTabMutationCallbacks;
}

/**
 * Persistent session configuration panel (Configure tab) — shows agent,
 * MCP servers, skills, run config, and session variables.
 *
 * Workspace management has moved to the dedicated Workspace tab.
 *
 * When mutation callbacks are provided via `mutations`, items render
 * inline remove/reconfigure affordances. When callbacks are absent,
 * sections render read-only (backward compatible, DD-011).
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
  mutations,
}: SetupTabProps) {
  const hasSessionVars = sessionVariables != null && !sessionVariables.isEmpty;

  return (
    <div className="flex flex-col gap-5">
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
