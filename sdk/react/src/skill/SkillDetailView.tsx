"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { GitProvenance } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/status_pb";
import { SkillState } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useSkill } from "./useSkill";
import { ErrorMessage } from "../error/ErrorMessage";
import { VisibilityToggle } from "../library/VisibilityToggle";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS, stripFrontmatter } from "../internal/markdown-components";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell";
import type { DetailAction, ResourceHeaderMeta } from "../resource-detail/types";
import type { StatusPhase } from "../resource-workbench/types";

/** Props for {@link SkillDetailView}. */
export interface SkillDetailViewProps {
  /** Organization slug that owns the skill. */
  readonly org: string;
  /** Skill slug (URL-friendly identifier unique within the org). */
  readonly slug: string;
  /** Optional version tag or content hash to pin to a specific version. */
  readonly version?: string;
  /**
   * Called once when the skill resource has been fetched successfully.
   * Provides the resource display name for use cases like breadcrumbs,
   * document titles, or analytics — without requiring the consumer to
   * also call {@link useSkill}.
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
  /**
   * Primary action rendered as a visible button in the header area.
   */
  readonly primaryAction?: DetailAction;
  /**
   * Secondary actions rendered in the kebab overflow menu.
   */
  readonly actions?: readonly DetailAction[];
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Operational detail hub for a Skill knowledge package.
 *
 * Fetches the skill via {@link useSkill} internally and renders its
 * content inside a {@link ResourceDetailShell}: a standardized header
 * with action bar, the SKILL.md content with a source/rendered toggle,
 * and version/provenance information.
 *
 * The SKILL.md content is the primary value of this view — it IS the
 * skill. Users can toggle between rendered markdown and raw source
 * (like GitHub's Preview/Code toggle).
 *
 * Handles loading, error, and not-found states automatically.
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * // Minimal — self-contained, fetches its own data
 * <SkillDetailView org="acme" slug="code-style-guide" />
 * ```
 *
 * @example
 * ```tsx
 * // Pinned to a specific version tag
 * <SkillDetailView org="acme" slug="code-style-guide" version="stable" />
 * ```
 */
export function SkillDetailView({
  org,
  slug,
  version,
  onResourceLoad,
  onVisibilityChange,
  isVisibilityPending,
  primaryAction,
  actions,
  className,
}: SkillDetailViewProps) {
  const { skill, isLoading, error, refetch } = useSkill(org, slug, version);

  const onResourceLoadRef = useRef(onResourceLoad);
  onResourceLoadRef.current = onResourceLoad;

  useEffect(() => {
    if (skill?.metadata?.name) {
      onResourceLoadRef.current?.({ name: skill.metadata.name, id: skill.metadata.id });
    }
  }, [skill]);

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error)
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!skill) return <NotFoundState className={className} />;

  const meta = skill.metadata;
  const spec = skill.spec;
  const status = skill.status;
  const specAudit = status?.audit?.specAudit;

  const headerMeta: ResourceHeaderMeta = {
    name: meta?.name || meta?.slug || "Untitled",
    id: meta?.id || "",
    org: meta?.org,
    slug: meta?.slug,
    description: spec?.description,
    icon: <SkillIcon className="size-6 text-muted-foreground" />,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
    status: status ? skillStateToPhase(status.state) : undefined,
    statusLabel: status ? skillStateLabel(status.state) : undefined,
  };

  const isPublic = meta?.visibility === ApiResourceVisibility.visibility_public;
  const visibilityControl =
    onVisibilityChange && meta ? (
      <VisibilityToggle
        visibility={meta.visibility}
        onVisibilityChange={onVisibilityChange}
        isPending={isVisibilityPending}
      />
    ) : isPublic ? (
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        Public
      </span>
    ) : undefined;

  return (
    <ResourceDetailShell
      header={headerMeta}
      visibilityControl={visibilityControl}
      primaryAction={primaryAction}
      actions={actions}
      className={className}
    >
      <div className="flex flex-col gap-6 pt-2">
        {spec?.tag && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Tag</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium">
              {spec.tag}
            </span>
          </div>
        )}

        {spec?.skillMd && (
          <SkillContentSection content={spec.skillMd} />
        )}

        {status && (status.versionHash || status.gitProvenance) && (
          <VersionSection
            versionHash={status.versionHash}
            gitProvenance={status.gitProvenance}
          />
        )}
      </div>
    </ResourceDetailShell>
  );
}

// ---------------------------------------------------------------------------
// Skill state → StatusPhase mapping
// ---------------------------------------------------------------------------

function skillStateToPhase(state: SkillState): StatusPhase | undefined {
  switch (state) {
    case SkillState.READY:
      return "ready";
    case SkillState.FAILED:
      return "failed";
    case SkillState.UPLOADING:
      return "pending";
    default:
      return undefined;
  }
}

function skillStateLabel(state: SkillState): string | undefined {
  switch (state) {
    case SkillState.READY:
      return "Ready";
    case SkillState.FAILED:
      return "Failed";
    case SkillState.UPLOADING:
      return "Uploading";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Content section with source/rendered toggle
// ---------------------------------------------------------------------------

type ContentViewMode = "rendered" | "source";

function SkillContentSection({ content }: { readonly content: string }) {
  const [viewMode, setViewMode] = useState<ContentViewMode>("rendered");

  return (
    <Section
      title="Skill Content"
      trailing={
        <ContentViewToggle value={viewMode} onChange={setViewMode} />
      }
    >
      {viewMode === "rendered" ? (
        <div className="p-4">
          <Markdown
            remarkPlugins={REMARK_PLUGINS}
            components={MARKDOWN_COMPONENTS}
          >
            {stripFrontmatter(content)}
          </Markdown>
        </div>
      ) : (
        <pre className="overflow-x-auto p-4 font-mono text-sm leading-relaxed text-foreground">
          {content}
        </pre>
      )}
    </Section>
  );
}

function ContentViewToggle({
  value,
  onChange,
}: {
  readonly value: ContentViewMode;
  readonly onChange: (mode: ContentViewMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Content view mode"
      className="inline-flex rounded-md border border-input text-[11px]"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === "rendered"}
        onClick={() => onChange("rendered")}
        className={cn(
          "rounded-l-md px-2 py-0.5 font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          value === "rendered"
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Preview
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "source"}
        onClick={() => onChange("source")}
        className={cn(
          "rounded-r-md border-l border-input px-2 py-0.5 font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          value === "source"
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Source
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version section
// ---------------------------------------------------------------------------

function VersionSection({
  versionHash,
  gitProvenance,
}: {
  readonly versionHash: string;
  readonly gitProvenance?: GitProvenance;
}) {
  const truncatedHash = versionHash ? versionHash.slice(0, 12) : null;

  return (
    <Section title="Version">
      <div className="flex flex-col gap-3 p-3">
        {truncatedHash && (
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Hash
            </span>
            <code
              className="font-mono text-xs text-foreground"
              title={versionHash}
            >
              {truncatedHash}
            </code>
          </div>
        )}

        {gitProvenance && <GitProvenanceDisplay provenance={gitProvenance} />}
      </div>
    </Section>
  );
}

function GitProvenanceDisplay({
  provenance,
}: {
  readonly provenance: GitProvenance;
}) {
  const repoUrl = normalizeGitUrl(provenance.remoteUrl);
  const truncatedCommit = provenance.commit
    ? provenance.commit.slice(0, 7)
    : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium text-muted-foreground">Git</span>
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-foreground">
          {repoUrl ? (
            <a
              href={repoUrl}
              className="text-primary underline underline-offset-2 hover:text-primary-muted"
              target="_blank"
              rel="noopener noreferrer"
            >
              {formatRepoName(repoUrl)}
            </a>
          ) : (
            <span className="font-mono">{provenance.remoteUrl}</span>
          )}
          {provenance.ref && (
            <>
              <span className="text-muted-foreground">@</span>
              <span>{provenance.ref}</span>
            </>
          )}
          {truncatedCommit && (
            <code
              className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]"
              title={provenance.commit}
            >
              {truncatedCommit}
            </code>
          )}
        </div>
      </div>
      {provenance.subdir && (
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Path
          </span>
          <code className="font-mono text-xs text-foreground">
            {provenance.subdir}
          </code>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared layout primitives
// ---------------------------------------------------------------------------

function Section({
  title,
  trailing,
  children,
}: {
  readonly title: string;
  readonly trailing?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {trailing}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        {children}
      </div>
    </section>
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
      aria-label="Loading skill details"
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 size-6 shrink-0 animate-pulse rounded bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="h-3 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full max-w-md animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div
          className="animate-pulse rounded-lg border border-border bg-muted-faint"
          style={{ height: "240px" }}
        />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        <div
          className="animate-pulse rounded-lg border border-border bg-muted-faint"
          style={{ height: "64px" }}
        />
      </div>
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
      <SkillIcon className="size-10 text-muted-foreground-faint" />
      <p className="text-sm font-medium text-muted-foreground">
        Skill not found
      </p>
      <p className="text-xs text-muted-foreground-subtle">
        This skill doesn&apos;t exist or you don&apos;t have access to it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function normalizeGitUrl(url: string): string | null {
  if (!url) return null;
  const cleaned = url.replace(/\.git$/, "");
  if (cleaned.startsWith("https://") || cleaned.startsWith("http://")) {
    return cleaned;
  }
  const sshMatch = cleaned.match(/^(?:git@|ssh:\/\/)([^:/]+)[:/](.+)$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }
  return null;
}

function formatRepoName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, "").replace(/\.git$/, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs following the SDK pattern (no icon library dependency)
// ---------------------------------------------------------------------------

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
