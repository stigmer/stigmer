"use client";

import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import type { HarnessOption } from "../../models/harness.js";
import { HARNESS_META } from "../../models/harness.js";
import type { ExecutionTargetOption } from "../execution-target.js";
import type { UseSessionVariablesReturn } from "../../execution/useSessionVariables.js";

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
  /**
   * Host-injected access management control (e.g. the Console's
   * `ManageAccessButton`) rendered as the facet's final section. A slot keeps
   * the SDK auth-agnostic (DD-004); the injected control owns its own
   * visibility (permission gating), so this section renders no chrome of its
   * own — an empty heading over a denied control would read as breakage.
   */
  readonly accessSlot?: React.ReactNode;
}

/**
 * Persistent session configuration panel (Configure tab) — shows agent,
 * MCP servers, skills, run config, session variables, and the host's
 * access management control (via `accessSlot`).
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
  accessSlot,
}: SetupTabProps) {
  const hasSessionVars = sessionVariables != null && !sessionVariables.isEmpty;

  return (
    <div className="stg:flex stg:flex-col stg:gap-5">
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

      {accessSlot && <section>{accessSlot}</section>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared section primitives
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="stg:text-[0.65rem] stg:font-semibold stg:uppercase stg:tracking-wider stg:text-muted-foreground">
      {children}
    </h3>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="stg:text-xs stg:text-muted-foreground/70">{children}</p>
  );
}

function ItemPill({ children, className: cls }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:bg-muted-subtle stg:px-2 stg:py-1 stg:text-xs stg:text-foreground",
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
      className="stg:shrink-0 stg:text-muted-foreground stg:hover:text-destructive stg:transition-colors"
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
    <section className="stg:flex stg:flex-col stg:gap-1.5">
      <SectionHeading>Run Config</SectionHeading>
      <div className="stg:flex stg:flex-wrap stg:gap-1.5">
        <ItemPill>
          <span className="stg:text-muted-foreground">Harness</span>
          {HARNESS_META[harness]?.label ?? harness}
        </ItemPill>
        {modelId && (
          <ItemPill>
            <span className="stg:text-muted-foreground">Model</span>
            {modelId}
          </ItemPill>
        )}
        {executionTarget && (
          <ItemPill>
            <span className="stg:text-muted-foreground">Target</span>
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
    <section className="stg:flex stg:flex-col stg:gap-1.5">
      <SectionHeading>Agent</SectionHeading>
      {agentRef ? (
        <div className="stg:flex stg:items-center stg:gap-1.5">
          <ItemPill>
            {agentRef.slug}
            {onRemove && !isDefaultAgent && (
              <RemoveButton onClick={onRemove} label={`Remove agent ${agentRef.slug}`} />
            )}
          </ItemPill>
          {isDefaultAgent && (
            <span className="stg:rounded stg:bg-primary/10 stg:px-1.5 stg:py-0.5 stg:text-[0.6rem] stg:font-medium stg:text-primary">
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
    <section className="stg:flex stg:flex-col stg:gap-1.5">
      <SectionHeading>
        MCP Servers
        {mcpServerUsages.length > 0 && (
          <span className="stg:ml-1 stg:text-muted-foreground/60">({mcpServerUsages.length})</span>
        )}
      </SectionHeading>
      {mcpServerUsages.length > 0 ? (
        <div className="stg:flex stg:flex-col stg:gap-1">
          {mcpServerUsages.map((usage) => {
            const slug = usage.mcpServerRef.slug;
            const enabledCount = usage.enabledTools?.length;
            return (
              <ItemPill key={`${usage.mcpServerRef.org}/${slug}`}>
                <span>{slug}</span>
                {enabledCount != null && enabledCount > 0 && (
                  <span className="stg:text-muted-foreground">
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
    <section className="stg:flex stg:flex-col stg:gap-1.5">
      <SectionHeading>
        Skills
        {skillRefs.length > 0 && (
          <span className="stg:ml-1 stg:text-muted-foreground/60">({skillRefs.length})</span>
        )}
      </SectionHeading>
      {skillRefs.length > 0 ? (
        <div className="stg:flex stg:flex-wrap stg:gap-1.5">
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
    <section className="stg:flex stg:flex-col stg:gap-1.5">
      <SectionHeading>
        Session Variables
        <span className="stg:ml-1 stg:font-normal stg:normal-case stg:tracking-normal stg:text-muted-foreground/60">
          (next message only)
        </span>
      </SectionHeading>
      <div className="stg:flex stg:flex-col stg:gap-1">
        {entries.map((entry) => (
          <ItemPill key={entry.id}>
            <span className="stg:font-medium">{entry.key || "(unnamed)"}</span>
            {entry.isSecret ? (
              <span className="stg:text-muted-foreground">********</span>
            ) : (
              <span className="stg:max-w-[140px] stg:truncate stg:text-muted-foreground">{entry.value}</span>
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
