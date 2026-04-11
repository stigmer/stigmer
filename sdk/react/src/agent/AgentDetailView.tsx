"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type {
  McpServerUsage,
  SubAgent,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useAgent } from "./useAgent";
import { ErrorMessage } from "../error/ErrorMessage";
import { VisibilityToggle } from "../library/VisibilityToggle";

const INSTRUCTIONS_COLLAPSED_LINES = 8;

/** Props for {@link AgentDetailView}. */
export interface AgentDetailViewProps {
  /** Organization slug that owns the agent. */
  readonly org: string;
  /** Agent slug (URL-friendly identifier unique within the org). */
  readonly slug: string;
  /**
   * Called when an MCP server reference is clicked.
   * Provides `org` and `slug` of the referenced MCP server so the
   * consumer can wire navigation. When the reference has no explicit
   * org, the agent's own org is used as fallback.
   */
  readonly onMcpServerClick?: (ref: { org: string; slug: string }) => void;
  /**
   * Called when a skill reference is clicked.
   * Provides `org` and `slug` of the referenced skill.
   */
  readonly onSkillClick?: (ref: { org: string; slug: string }) => void;
  /**
   * Called once when the agent resource has been fetched successfully.
   * Provides the resource display name for use cases like breadcrumbs,
   * document titles, or analytics — without requiring the consumer to
   * also call {@link useAgent}.
   *
   * Not called on error or not-found states.
   */
  readonly onResourceLoad?: (meta: { name: string; id: string }) => void;
  /**
   * Called when the user toggles visibility via the inline control.
   * When provided, the header renders an interactive
   * {@link VisibilityToggle} instead of a read-only badge.
   * When omitted, visibility is displayed as a static "Public" pill.
   */
  readonly onVisibilityChange?: (v: ApiResourceVisibility) => void;
  /** `true` while a visibility update RPC is in flight. */
  readonly isVisibilityPending?: boolean;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Read-only detail view for an Agent blueprint.
 *
 * Fetches the agent via {@link useAgent} internally and renders its
 * full configuration in structured sections: header, instructions,
 * MCP server usages, skills, sub-agents, and environment variables.
 * Sections with no data are omitted entirely — reducing visual noise
 * per the aesthetic-minimalist design heuristic (Nielsen #8).
 *
 * Handles loading, error, and not-found states automatically.
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * // Minimal — self-contained, fetches its own data
 * <AgentDetailView org="acme" slug="pr-review-agent" />
 * ```
 *
 * @example
 * ```tsx
 * // With cross-resource linking in a Console page
 * <AgentDetailView
 *   org={org}
 *   slug={slug}
 *   onMcpServerClick={({ org, slug }) => router.push(`/library/mcp-servers/${org}/${slug}`)}
 *   onSkillClick={({ org, slug }) => router.push(`/library/skills/${org}/${slug}`)}
 * />
 * ```
 */
export function AgentDetailView({
  org,
  slug,
  onMcpServerClick,
  onSkillClick,
  onResourceLoad,
  onVisibilityChange,
  isVisibilityPending,
  className,
}: AgentDetailViewProps) {
  const { agent, isLoading, error, refetch } = useAgent(org, slug);

  const onResourceLoadRef = useRef(onResourceLoad);
  onResourceLoadRef.current = onResourceLoad;

  useEffect(() => {
    if (agent?.metadata?.name) {
      onResourceLoadRef.current?.({ name: agent.metadata.name, id: agent.metadata.id });
    }
  }, [agent]);

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error)
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!agent) return <NotFoundState className={className} />;

  const spec = agent.spec;
  const specAudit = agent.status?.audit?.specAudit;
  const agentOrg = agent.metadata?.org || org;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <Header
        agent={agent}
        createdAt={
          specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null
        }
        updatedAt={
          specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null
        }
        onVisibilityChange={onVisibilityChange}
        isVisibilityPending={isVisibilityPending}
      />

      {spec?.instructions && (
        <InstructionsSection text={spec.instructions} />
      )}

      {spec && spec.mcpServerUsages.length > 0 && (
        <McpUsagesSection
          usages={spec.mcpServerUsages}
          defaultOrg={agentOrg}
          onMcpServerClick={onMcpServerClick}
        />
      )}

      {spec && spec.skillRefs.length > 0 && (
        <SkillsSection
          refs={spec.skillRefs}
          defaultOrg={agentOrg}
          onSkillClick={onSkillClick}
        />
      )}

      {spec && spec.subAgents.length > 0 && (
        <SubAgentsSection subAgents={spec.subAgents} />
      )}

      {spec?.env && Object.keys(spec.env).length > 0 && (
        <EnvSection data={spec.env} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal section components
// ---------------------------------------------------------------------------

function Header({
  agent,
  createdAt,
  updatedAt,
  onVisibilityChange,
  isVisibilityPending,
}: {
  readonly agent: Agent;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
  readonly onVisibilityChange?: (v: ApiResourceVisibility) => void;
  readonly isVisibilityPending?: boolean;
}) {
  const meta = agent.metadata;
  const spec = agent.spec;
  const displayName = meta?.name || meta?.slug || "Untitled";
  const isPublic =
    meta?.visibility === ApiResourceVisibility.visibility_public;

  return (
    <div className="flex items-start gap-3">
      {spec?.iconUrl ? (
        <img
          src={spec.iconUrl}
          alt=""
          className="mt-0.5 size-8 shrink-0 rounded object-cover"
        />
      ) : (
        <AgentIcon className="mt-1 size-6 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-lg font-semibold text-foreground">
            {displayName}
          </h2>
          {onVisibilityChange && meta ? (
            <VisibilityToggle
              visibility={meta.visibility}
              onVisibilityChange={onVisibilityChange}
              isPending={isVisibilityPending}
            />
          ) : (
            isPublic && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Public
              </span>
            )
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {meta?.org && <span>{meta.org}</span>}
          {createdAt && (
            <>
              <Dot />
              <span>Created {formatDate(createdAt)}</span>
            </>
          )}
          {updatedAt && (
            <>
              <Dot />
              <span>Updated {formatDate(updatedAt)}</span>
            </>
          )}
        </div>
        {spec?.description && (
          <p className="mt-2 text-sm text-muted-foreground">
            {spec.description}
          </p>
        )}
      </div>
    </div>
  );
}

function InstructionsSection({ text }: { readonly text: string }) {
  const lines = text.split("\n");
  const needsCollapse = lines.length > INSTRUCTIONS_COLLAPSED_LINES;
  const [expanded, setExpanded] = useState(false);

  const displayText =
    needsCollapse && !expanded
      ? lines.slice(0, INSTRUCTIONS_COLLAPSED_LINES).join("\n")
      : text;

  return (
    <Section title="Instructions">
      <div className="p-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-sm text-foreground">
          {displayText}
          {needsCollapse && !expanded && "\u2026"}
        </pre>
        {needsCollapse && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </Section>
  );
}

function McpUsagesSection({
  usages,
  defaultOrg,
  onMcpServerClick,
}: {
  readonly usages: readonly McpServerUsage[];
  readonly defaultOrg: string;
  readonly onMcpServerClick?: (ref: { org: string; slug: string }) => void;
}) {
  return (
    <Section title={`MCP Servers (${usages.length})`}>
      <div className="flex flex-col">
        {usages.map((usage, index) => {
          const ref = usage.mcpServerRef;
          if (!ref) return null;

          const refOrg = ref.org || defaultOrg;
          const label =
            ref.org && ref.org !== defaultOrg
              ? `${ref.org}/${ref.slug}`
              : ref.slug;
          const toolCount = usage.enabledTools.length;
          const approvalCount = usage.toolApprovalOverrides.length;

          const summary = [
            toolCount > 0
              ? `${toolCount} ${toolCount === 1 ? "tool" : "tools"}`
              : "all tools",
            approvalCount > 0
              ? `${approvalCount} approval ${approvalCount === 1 ? "override" : "overrides"}`
              : "",
          ]
            .filter(Boolean)
            .join(" \u00B7 ");

          const row = (
            <div className="flex items-center gap-3">
              <McpServerIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {label}
              </span>
              <span className="text-xs text-muted-foreground">{summary}</span>
            </div>
          );

          return onMcpServerClick ? (
            <button
              key={ref.slug || index}
              type="button"
              onClick={() =>
                onMcpServerClick({ org: refOrg, slug: ref.slug })
              }
              className={cn(
                "w-full rounded-md px-3 py-2 text-left transition-colors",
                "hover:bg-accent/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              )}
            >
              {row}
            </button>
          ) : (
            <div key={ref.slug || index} className="px-3 py-2">
              {row}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SkillsSection({
  refs,
  defaultOrg,
  onSkillClick,
}: {
  readonly refs: readonly ApiResourceReference[];
  readonly defaultOrg: string;
  readonly onSkillClick?: (ref: { org: string; slug: string }) => void;
}) {
  return (
    <Section title={`Skills (${refs.length})`}>
      <div className="flex flex-col">
        {refs.map((ref, index) => {
          const refOrg = ref.org || defaultOrg;
          const label =
            ref.org && ref.org !== defaultOrg
              ? `${ref.org}/${ref.slug}`
              : ref.slug;

          const row = (
            <div className="flex items-center gap-3">
              <SkillIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {label}
              </span>
            </div>
          );

          return onSkillClick ? (
            <button
              key={ref.slug || index}
              type="button"
              onClick={() => onSkillClick({ org: refOrg, slug: ref.slug })}
              className={cn(
                "w-full rounded-md px-3 py-2 text-left transition-colors",
                "hover:bg-accent/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              )}
            >
              {row}
            </button>
          ) : (
            <div key={ref.slug || index} className="px-3 py-2">
              {row}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SubAgentsSection({
  subAgents,
}: {
  readonly subAgents: readonly SubAgent[];
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <Section title={`Sub-Agents (${subAgents.length})`}>
      <div className="flex flex-col">
        {subAgents.map((sa, index) => {
          const isOpen = expanded.has(index);

          return (
            <div key={sa.name || index}>
              <button
                type="button"
                onClick={() => toggle(index)}
                aria-expanded={isOpen}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors",
                  "hover:bg-accent/50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                )}
              >
                <ChevronRightIcon
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                    isOpen && "rotate-90",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">
                    {sa.name}
                  </span>
                  {sa.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {sa.description}
                    </p>
                  )}
                </div>
              </button>

              {isOpen && (
                <SubAgentDetails subAgent={sa} />
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SubAgentDetails({
  subAgent: sa,
}: {
  readonly subAgent: SubAgent;
}) {
  return (
    <div className="mb-1 ml-7 space-y-3 border-l border-border pl-4 pt-1">
      {sa.instructions && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Instructions
          </h4>
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-xs text-foreground">
            {sa.instructions}
          </pre>
        </div>
      )}

      {sa.mcpAccess.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            MCP Access
          </h4>
          <div className="space-y-1">
            {sa.mcpAccess.map((access) => (
              <div
                key={access.mcpServer}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <McpServerIcon className="size-3 shrink-0 text-muted-foreground" />
                <span className="font-medium">{access.mcpServer}</span>
                <span className="text-muted-foreground">
                  {access.enabledTools.length > 0
                    ? `${access.enabledTools.length} ${access.enabledTools.length === 1 ? "tool" : "tools"}`
                    : "all tools"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sa.skillRefs.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Skills
          </h4>
          <div className="space-y-1">
            {sa.skillRefs.map((ref) => (
              <div
                key={ref.slug}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <SkillIcon className="size-3 shrink-0 text-muted-foreground" />
                <span>
                  {ref.org ? `${ref.org}/${ref.slug}` : ref.slug}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sa.modelOverride && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Model Override
          </h4>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            {sa.modelOverride}
          </span>
        </div>
      )}
    </div>
  );
}

function EnvSection({
  data,
}: {
  readonly data: { [key: string]: EnvVarDeclaration };
}) {
  const entries = Object.entries(data).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <Section title={`Environment Variables (${entries.length})`}>
      <div className="flex flex-col divide-y divide-border">
        {entries.map(([name, env]) => (
          <div key={name} className="flex items-start gap-3 px-3 py-2">
            <code className="shrink-0 font-mono text-sm font-medium text-foreground">
              {name}
            </code>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {env.isSecret ? "secret" : "config"}
            </span>
            {env.description && (
              <span className="text-xs text-muted-foreground">
                {env.description}
              </span>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Shared layout primitives
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-hidden rounded-lg border border-border">
        {children}
      </div>
    </section>
  );
}

function Dot() {
  return (
    <span className="shrink-0" aria-hidden="true">
      {"\u00B7"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Non-happy states
// ---------------------------------------------------------------------------

function LoadingSkeleton({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn("flex flex-col gap-6", className)}
      aria-busy="true"
      aria-label="Loading agent details"
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 size-6 shrink-0 animate-pulse rounded bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="h-3 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full max-w-md animate-pulse rounded bg-muted" />
        </div>
      </div>
      {[40, 24, 16].map((h) => (
        <div key={h} className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div
            className="animate-pulse rounded-lg border border-border bg-muted/30"
            style={{ height: `${h * 4}px` }}
          />
        </div>
      ))}
    </div>
  );
}

function NotFoundState({ className }: { readonly className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-2 py-12 text-center",
        className,
      )}
    >
      <AgentIcon className="size-10 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">
        Agent not found
      </p>
      <p className="text-xs text-muted-foreground/60">
        This agent doesn&apos;t exist or you don&apos;t have access to it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs following the SDK pattern (no icon library dependency)
// ---------------------------------------------------------------------------

function AgentIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="10" height="8" rx="1.5" />
      <path d="M6 9h.01M10 9h.01" strokeWidth="2" />
      <path d="M8 2v3" />
    </svg>
  );
}

function McpServerIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="12" height="5" rx="1" />
      <rect x="2" y="9" width="12" height="5" rx="1" />
      <circle cx="5" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SkillIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 1.5 4 9h4l-1 5.5L12 7H8l1-5.5Z" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}
