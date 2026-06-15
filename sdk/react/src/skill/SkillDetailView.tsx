"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { GitProvenance } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/status_pb";
import { SkillState } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useSkill } from "./useSkill";
import { SkillFileBrowser } from "./SkillFileBrowser";
import { ErrorMessage } from "../error/ErrorMessage";
import { VisibilityBadge } from "../library/VisibilitySelector";
import { useManageAccess } from "../access/useManageAccess";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS, stripFrontmatter } from "../internal/markdown-components";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell";
import { Section } from "../resource-detail/Section";
import { useDetailTabs } from "../resource-detail/useDetailTabs";
import type { AdditionalTab, DetailAction, ResourceHeaderMeta } from "../resource-detail/types";
import { InlineEditText } from "../inline-edit/InlineEditText";
import { InlineEditTextarea } from "../inline-edit/InlineEditTextarea";
import type { TabItem } from "../tabs/Tabs";
import type { StatusPhase } from "../resource-workbench/types";
import { useSkillVersions } from "./useSkillVersions";
import { VersionTimeline } from "../version-history/VersionTimeline";
import { SkillDiffDialog, type SkillDiffDialogState } from "./SkillDiffDialog";

const CONTENT_TAB: TabItem = { id: "content", label: "Content" };
const VERSIONS_TAB: TabItem = { id: "versions", label: "Versions" };

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
   * Primary action rendered as a visible button in the header area.
   */
  readonly primaryAction?: DetailAction;
  /**
   * Secondary actions rendered in the kebab overflow menu.
   */
  readonly actions?: readonly DetailAction[];
  /**
   * Additional tabs to render alongside the built-in "Content" tab.
   * When provided (with at least one entry), a tab bar appears.
   * When omitted or empty, no tab bar is shown (single-tab suppression).
   *
   * Each entry provides both the tab metadata and the content to render.
   * The SDK manages the tab switching logic internally.
   *
   * @example
   * ```tsx
   * <SkillDetailView
   *   org="acme"
   *   slug="code-style-guide"
   *   additionalTabs={[
   *     { id: "versions", label: "Versions", content: <VersionTimeline /> },
   *   ]}
   * />
   * ```
   */
  readonly additionalTabs?: readonly AdditionalTab[];
  /**
   * Controlled active tab ID. When provided together with `onTabChange`,
   * the component operates in controlled mode — the consumer owns tab state.
   * When omitted, the component manages its own internal tab state.
   */
  readonly activeTab?: string;
  /**
   * Controlled tab change handler. When provided together with `activeTab`,
   * the component operates in controlled mode.
   */
  readonly onTabChange?: (tabId: string) => void;
  /**
   * Default active tab ID when in uncontrolled mode.
   * @default "content"
   */
  readonly defaultTab?: string;
  /**
   * Called when the user selects a version in the Versions tab timeline.
   * Provides the version hash for use cases like navigation to a
   * version-specific detail view or triggering a diff comparison.
   */
  readonly onVersionSelect?: (versionHash: string) => void;
  /**
   * When `true`, metadata fields (description, tag) become click-to-edit.
   * Skill content (SKILL.md / artifact) is NOT editable inline — use the upload flow.
   * @default false
   */
  readonly editable?: boolean;
  /**
   * Called after a successful inline field save with the updated skill.
   * Consumers can use this to refresh breadcrumbs, sync URL state, etc.
   */
  readonly onResourceUpdated?: (skill: Skill) => void;
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
  primaryAction,
  actions,
  additionalTabs,
  activeTab,
  onTabChange,
  defaultTab,
  onVersionSelect,
  editable = false,
  onResourceUpdated,
  className,
}: SkillDetailViewProps) {
  const { skill, isLoading, error, refetch } = useSkill(org, slug, version);
  const { versions, isEmpty: noVersions, getArtifactKey } = useSkillVersions(org, slug);
  const [diffState, setDiffState] = useState<SkillDiffDialogState | null>(null);

  const builtInTabs = useMemo<readonly TabItem[]>(
    () => (noVersions ? [CONTENT_TAB] : [CONTENT_TAB, VERSIONS_TAB]),
    [noVersions],
  );

  const {
    effectiveTabs,
    effectiveActiveTab,
    effectiveOnTabChange,
    activeAdditionalTab,
  } = useDetailTabs({
    builtInTabs,
    additionalTabs,
    activeTab,
    onTabChange,
    defaultTab,
  });

  const handleVersionSelect = useCallback(
    (id: string) => onVersionSelect?.(id),
    [onVersionSelect],
  );

  const handleCompare = useCallback(
    (fromId: string, toId: string) => {
      const fromKey = getArtifactKey(fromId);
      const toKey = getArtifactKey(toId);
      if (!fromKey || !toKey) return;

      setDiffState({
        fromArtifactKey: fromKey,
        toArtifactKey: toKey,
        fromLabel: fromId.slice(0, 12),
        toLabel: toId.slice(0, 12),
      });
    },
    [getArtifactKey],
  );

  const closeDiff = useCallback(() => setDiffState(null), []);

  const onResourceLoadRef = useRef(onResourceLoad);
  onResourceLoadRef.current = onResourceLoad;

  useEffect(() => {
    if (skill?.metadata?.name) {
      onResourceLoadRef.current?.({ name: skill.metadata.name, id: skill.metadata.id });
    }
  }, [skill]);

  // Unified Manage access — visibility (General access) over explicit grants
  // (People), opened from the kebab. Closes the blueprint share gap for skills.
  const access = useManageAccess({
    resource: skill?.metadata
      ? {
          kind: ApiResourceKind.skill,
          kindString: "skill",
          id: skill.metadata.id,
          org: skill.metadata.org,
          name: skill.metadata.name,
        }
      : null,
    visibility: skill?.metadata
      ? {
          kind: "skill",
          current: skill.metadata.visibility,
          org: skill.metadata.org,
          onChanged: refetch,
        }
      : undefined,
  });

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
    description: undefined,
    icon: <SkillIcon className="size-6 text-muted-foreground" />,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
    status: status ? skillStateToPhase(status.state) : undefined,
    statusLabel: status ? skillStateLabel(status.state) : undefined,
  };

  // Inline visibility is read-only (at-a-glance); editing lives in the
  // Manage access dialog, the single writer for both access axes.
  const visibilityControl = meta ? (
    <VisibilityBadge visibility={meta.visibility} />
  ) : undefined;

  const mergedActions = access.action
    ? [...(actions ?? []), access.action]
    : actions;

  let tabContent: React.ReactNode;
  if (activeAdditionalTab) {
    tabContent = activeAdditionalTab.content;
  } else if (effectiveActiveTab === "versions" && versions.length > 0) {
    tabContent = (
      <VersionTimeline
        entries={versions}
        onEntrySelect={handleVersionSelect}
        onCompare={handleCompare}
      />
    );
  } else {
    tabContent = (
      <SkillOverview
        spec={spec}
        status={status}
        editable={editable}
      />
    );
  }

  return (
    <>
      <ResourceDetailShell
        header={headerMeta}
        visibilityControl={visibilityControl}
        primaryAction={primaryAction}
        actions={mergedActions}
        tabs={effectiveTabs}
        activeTab={effectiveTabs ? effectiveActiveTab : undefined}
        onTabChange={effectiveTabs ? effectiveOnTabChange : undefined}
        tabsAriaLabel="Skill detail sections"
        className={className}
      >
        {tabContent}
      </ResourceDetailShell>
      {access.dialog}
      <SkillDiffDialog state={diffState} onClose={closeDiff} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview content — the skill's built-in "Content" tab
// ---------------------------------------------------------------------------

function SkillOverview({
  spec,
  status,
  editable,
}: {
  readonly spec: NonNullable<Skill["spec"]> | undefined;
  readonly status: Skill["status"] | undefined;
  readonly editable?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {(editable || spec?.description) && (
        <Section title="Description">
          {editable ? (
            <div className="max-h-20 overflow-y-auto p-3">
              <InlineEditTextarea
                value={spec?.description || ""}
                onSave={async () => false}
                isSaving={false}
                placeholder="Add a description"
                minRows={2}
                disabled
              />
            </div>
          ) : (
            <div className="p-3">
              <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-sans">
                {spec?.description}
              </pre>
            </div>
          )}
        </Section>
      )}

      {(editable || spec?.tag) && (
        <Section title="Tag">
          {editable ? (
            <div className="p-3">
              <InlineEditText
                value={spec?.tag || ""}
                onSave={async () => false}
                isSaving={false}
                placeholder="Add a tag (e.g. stable, latest)"
                disabled
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
                {spec?.tag}
              </span>
            </div>
          )}
        </Section>
      )}

      {status?.artifactStorageKey ? (
        <SkillFileBrowser artifactStorageKey={status.artifactStorageKey} />
      ) : spec?.skillMd ? (
        <SkillContentSection content={spec.skillMd} />
      ) : null}

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
    <SkillSection
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
    </SkillSection>
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

function SkillSection({
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
