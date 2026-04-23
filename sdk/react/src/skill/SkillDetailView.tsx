"use client";

import { useEffect, useRef } from "react";
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
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Read-only detail view for a Skill knowledge package.
 *
 * Fetches the skill via {@link useSkill} internally and renders its
 * full content in structured sections: header, SKILL.md content
 * (rendered as formatted markdown), and version/provenance info.
 * Sections with no data are omitted entirely.
 *
 * The SKILL.md content is the primary value of this view — it IS the
 * skill. The markdown is rendered using the same styled component
 * overrides used across all SDK markdown surfaces.
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

  const spec = skill.spec;
  const status = skill.status;
  const specAudit = status?.audit?.specAudit;

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <Header
        skill={skill}
        createdAt={
          specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null
        }
        updatedAt={
          specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null
        }
        onVisibilityChange={onVisibilityChange}
        isVisibilityPending={isVisibilityPending}
      />

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
  );
}

// ---------------------------------------------------------------------------
// Internal section components
// ---------------------------------------------------------------------------

function Header({
  skill,
  createdAt,
  updatedAt,
  onVisibilityChange,
  isVisibilityPending,
}: {
  readonly skill: Skill;
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
  readonly onVisibilityChange?: (v: ApiResourceVisibility) => void;
  readonly isVisibilityPending?: boolean;
}) {
  const meta = skill.metadata;
  const spec = skill.spec;
  const status = skill.status;
  const displayName = meta?.name || meta?.slug || "Untitled";
  const isPublic =
    meta?.visibility === ApiResourceVisibility.visibility_public;

  return (
    <div className="flex items-start gap-3">
      <SkillIcon className="mt-1 size-6 shrink-0 text-muted-foreground" />
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
          {spec?.tag && (
            <>
              <Dot />
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium">
                {spec.tag}
              </span>
            </>
          )}
          {status && <SkillStateBadge state={status.state} />}
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

function SkillStateBadge({ state }: { readonly state: SkillState }) {
  switch (state) {
    case SkillState.READY:
      return (
        <>
          <Dot />
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="size-3" />
            Ready
          </span>
        </>
      );
    case SkillState.FAILED:
      return (
        <>
          <Dot />
          <span className="text-destructive">Failed</span>
        </>
      );
    case SkillState.UPLOADING:
      return (
        <>
          <Dot />
          <span className="text-amber-600 dark:text-amber-400">Uploading</span>
        </>
      );
    default:
      return null;
  }
}

function SkillContentSection({ content }: { readonly content: string }) {
  return (
    <Section title="Skill Content">
      <div className="p-4">
        <Markdown
          remarkPlugins={REMARK_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {stripFrontmatter(content)}
        </Markdown>
      </div>
    </Section>
  );
}

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

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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

function CheckIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 8.5 3.5 3.5 6.5-8" />
    </svg>
  );
}
