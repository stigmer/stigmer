"use client";

import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import type { HarnessOption } from "../../models/harness";
import { HARNESS_META } from "../../models/harness";
import type { ExecutionTargetOption } from "../execution-target";
import type { UseSessionVariablesReturn } from "../../execution/useSessionVariables";

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
}

/**
 * Read-only summary of the session's active configuration.
 *
 * Complements the interactive composer chips — this tab gives the user
 * a persistent, at-a-glance view of what agent, MCP servers, skills,
 * harness, model, and ephemeral session variables are in play.
 *
 * Renders grouped sections with empty-state copy per group.
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
}: SetupTabProps) {
  const hasSessionVars = sessionVariables != null && !sessionVariables.isEmpty;

  return (
    <div className="flex flex-col gap-5">
      <RunConfigSection
        harness={harness}
        executionTarget={executionTarget}
        modelId={modelId}
      />

      <AgentSection agentRef={agentRef} isDefaultAgent={isDefaultAgent} />

      <McpSection mcpServerUsages={mcpServerUsages} />

      <SkillsSection skillRefs={skillRefs} />

      {hasSessionVars && (
        <SessionVarsSection entries={sessionVariables.entries} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section components
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
}: {
  agentRef: ResourceRef | null;
  isDefaultAgent: boolean;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeading>Agent</SectionHeading>
      {agentRef ? (
        <div className="flex items-center gap-1.5">
          <ItemPill>
            {agentRef.slug}
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
}: {
  mcpServerUsages: readonly McpServerUsageInput[];
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
}: {
  skillRefs: readonly ResourceRef[];
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
            <ItemPill key={`${ref.org}/${ref.slug}`}>{ref.slug}</ItemPill>
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
