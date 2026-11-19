"use client";

import { ChoiceGroup } from "../internal/form/index.js";
import { CodeBlock } from "../internal/CodeBlock.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { Upload } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import type { GitProvenance } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/status_pb";
import { SkillState } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useSkill } from "./useSkill.js";
import { SkillFileBrowser } from "./SkillFileBrowser.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { VisibilityBadge } from "../library/VisibilitySelector.js";
import { useManageAccess } from "../access/useManageAccess.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { MARKDOWN_COMPONENTS, REMARK_PLUGINS, stripFrontmatter } from "../internal/markdown-components.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell.js";
import { Section } from "../resource-detail/Section.js";
import { useDetailTabs } from "../resource-detail/useDetailTabs.js";
import type { AdditionalTab, DetailAction, ResourceHeaderMeta } from "../resource-detail/types.js";
import { InlineEditText } from "../inline-edit/InlineEditText.js";
import { InlineEditTextarea } from "../inline-edit/InlineEditTextarea.js";
import type { TabItem } from "../tabs/Tabs.js";
import type { StatusPhase } from "../resource-workbench/types.js";
import { useSkillVersions } from "./useSkillVersions.js";
import { useCanCreateSkill } from "./useCanCreateSkill.js";
import { VersionTimeline } from "../version-history/VersionTimeline.js";
import { SkillDiffDialog, type SkillDiffDialogState } from "./SkillDiffDialog.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { LoadMoreFooter } from "../internal/LoadMoreFooter.js";

const CONTENT_TAB: TabItem = { id: "content", label: "Content" };
const VERSIONS_TAB: TabItem = { id: "versions", label: "Versions" };

/** Props for {@link SkillDetailView}. */
export interface SkillDetailViewProps {
  /** Id of the organization that owns the skill (a slug is also accepted). */
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
   * Called when the person chooses "Upload a new version"; the host owns the
   * route to its Upload skill page, where a skill of the same name is a new
   * version. Given, the header offers the act to someone the server lets
   * upload to the organization (`can_create_skill`, asked fail closed), and
   * only when no `primaryAction` is passed.
   */
  readonly onUploadNewVersion?: () => void;
  /**
   * When `true`, this host allows editing: metadata fields (description,
   * tag) become click-to-edit for a person the server lets edit the skill
   * (`can_edit`, asked by the view; a reader sees a read-only page from the
   * first frame). Skill content (SKILL.md / artifact) is NOT editable
   * inline — use the upload flow.
   * @default false
   */
  readonly editable?: boolean;
  /**
   * Called after a successful inline field save with the updated skill.
   * Consumers can use this to refresh breadcrumbs, sync URL state, etc.
   */
  readonly onResourceUpdated?: (skill: Skill) => void;
  /**
   * The level of the page's title: 1 where the view is the page's main
   * content (the console's and the desktop app's detail pages), 2 (the
   * default) where it sits under a heading of the host's.
   */
  readonly headingLevel?: 1 | 2;
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
  onUploadNewVersion,
  editable: editableProp = false,
  onResourceUpdated,
  className,
  headingLevel,
}: SkillDetailViewProps) {
  const { skill, isLoading, error, refetch } = useSkill(org, slug, version);
  // The resource the header's acts and the inline edits are checked on.
  const skillId = skill?.metadata?.id ?? "";
  const resourceRef = useMemo(() => (skillId !== "" ? { kind: "skill", id: skillId } : null), [skillId]);
  // Edits are offered only on the server's yes: a reader sees a read-only
  // page from the first frame, never a pencil while the check is in flight.
  const editCheck = useCheckPermission(editableProp ? resourceRef : null, "can_edit", { fail: "closed" });
  const editable = editableProp && editCheck.allowed;
  // A new version is a fresh upload of the same name, which the server allows
  // only to who may upload to the organization.
  const uploadCheck = useCanCreateSkill(onUploadNewVersion ? org : null);
  const headerPrimary = useMemo<DetailAction | undefined>(() => {
    if (primaryAction) return primaryAction;
    if (!onUploadNewVersion || !uploadCheck.allowed) return undefined;
    return {
      id: "upload-new-version",
      label: "Upload a new version",
      icon: <Upload className="stg:size-3.5" aria-hidden="true" />,
      buttonVariant: "outline",
      onAction: onUploadNewVersion,
    };
  }, [primaryAction, onUploadNewVersion, uploadCheck.allowed]);
  const versionPages = useSkillVersions(org, slug);
  const { versions, isEmpty: noVersions, getArtifactKey } = versionPages;
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
    icon: <SkillIcon className="stg:size-6 stg:text-muted-foreground" />,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
    status: status ? skillStateToPhase(status.state) : undefined,
    statusLabel: status ? skillStateLabel(status.state) : undefined,
  };

  // Inline visibility is at-a-glance AND a shortcut into the Manage access
  // dialog — the single writer for both access axes. The chip is navigation
  // only; it stays a static badge for users who cannot view access.
  const visibilityControl = meta ? (
    <VisibilityBadge
      visibility={meta.visibility}
      onClick={access.action ? access.open : undefined}
    />
  ) : undefined;

  const mergedActions = access.action
    ? [...(actions ?? []), access.action]
    : actions;

  let tabContent: React.ReactNode;
  if (activeAdditionalTab) {
    tabContent = activeAdditionalTab.content;
  } else if (effectiveActiveTab === "versions" && versions.length > 0) {
    tabContent = (
      <>
        <VersionTimeline
          entries={versions}
          onEntrySelect={handleVersionSelect}
          onCompare={handleCompare}
        />
        <LoadMoreFooter hasMore={versionPages.hasMore} loadMore={versionPages.loadMore} isLoadingMore={versionPages.isLoadingMore} loadMoreError={versionPages.loadMoreError} />
      </>
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
        headingLevel={headingLevel}
        visibilityControl={visibilityControl}
        primaryAction={headerPrimary}
        actions={mergedActions}
        resource={resourceRef}
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
    <div className="stg:flex stg:flex-col stg:gap-6">
      {(editable || spec?.description) && (
        <Section title="Description">
          {editable ? (
            <div className="stg:max-h-20 stg:overflow-y-auto stg:p-3">
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
            <div className="stg:p-3">
              <pre className="stg:whitespace-pre-wrap stg:break-words stg:text-sm stg:text-foreground stg:font-sans">
                {spec?.description}
              </pre>
            </div>
          )}
        </Section>
      )}

      {(editable || spec?.tag) && (
        <Section title="Tag">
          {editable ? (
            <div className="stg:p-3">
              <InlineEditText
                value={spec?.tag || ""}
                onSave={async () => false}
                isSaving={false}
                placeholder="Add a tag (e.g. stable, latest)"
                disabled
              />
            </div>
          ) : (
            <div className="stg:flex stg:items-center stg:gap-2 stg:px-3 stg:py-2.5">
              <span className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-xs stg:font-medium stg:text-foreground">
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
        <div className="stg:p-4">
          <Markdown
            remarkPlugins={REMARK_PLUGINS}
            components={MARKDOWN_COMPONENTS}
          >
            {stripFrontmatter(content)}
          </Markdown>
        </div>
      ) : (
        <CodeBlock size="sm" className="stg:p-4">
          {content}
        </CodeBlock>
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
    <ChoiceGroup
      aria-label="Content view mode"
      size="xs"
      value={value}
      onChange={onChange}
      options={[
        { value: "rendered", label: "Preview" },
        { value: "source", label: "Source" },
      ]}
    />
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
      <div className="stg:flex stg:flex-col stg:gap-3 stg:p-3">
        {truncatedHash && (
          <div className="stg:flex stg:items-baseline stg:gap-2">
            <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">
              Hash
            </span>
            <Tooltip>
              <TooltipTrigger
                render={<code className="stg:font-mono stg:text-xs stg:text-foreground" />}
              >
                {truncatedHash}
              </TooltipTrigger>
              <TooltipContent side="top" className="stg:break-all">
                {versionHash}
              </TooltipContent>
            </Tooltip>
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
    <div className="stg:flex stg:flex-col stg:gap-1.5">
      <div className="stg:flex stg:items-baseline stg:gap-2">
        <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">Git</span>
        <div className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-1.5 stg:text-xs stg:text-foreground">
          {repoUrl ? (
            <a
              href={repoUrl}
              className="stg:text-primary stg:underline stg:underline-offset-2 stg:hover:text-primary-muted"
              target="_blank"
              rel="noopener noreferrer"
            >
              {formatRepoName(repoUrl)}
            </a>
          ) : (
            <span className="stg:font-mono">{provenance.remoteUrl}</span>
          )}
          {provenance.ref && (
            <>
              <span className="stg:text-muted-foreground">@</span>
              <span>{provenance.ref}</span>
            </>
          )}
          {truncatedCommit && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <code className="stg:rounded stg:bg-muted stg:px-1 stg:py-0.5 stg:font-mono stg:text-2xs" />
                }
              >
                {truncatedCommit}
              </TooltipTrigger>
              <TooltipContent side="top" className="stg:break-all">
                {provenance.commit}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      {provenance.subdir && (
        <div className="stg:flex stg:items-baseline stg:gap-2">
          <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">
            Path
          </span>
          <code className="stg:font-mono stg:text-xs stg:text-foreground">
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
  // The detail page's own section card, so its title takes the page's level.
  return (
    <Section title={title} headerActions={trailing}>
      {children}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Non-happy states
// ---------------------------------------------------------------------------

function LoadingSkeleton({ className }: { readonly className?: string }) {
  return (
    <LoadingRegion
      className={cn("stg:flex stg:flex-col stg:gap-6", className)}
      label="Loading skill details"
    >
      <div className="stg:flex stg:items-start stg:gap-3">
        <div className="stg:mt-1 stg:size-6 stg:shrink-0 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:flex-1 stg:space-y-2">
          <div className="stg:h-5 stg:w-48 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-3 stg:w-64 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-4 stg:w-full stg:max-w-md stg:animate-pulse stg:rounded stg:bg-muted" />
        </div>
      </div>
      <div className="stg:space-y-2">
        <div className="stg:h-3 stg:w-28 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div
          className="stg:animate-pulse stg:rounded-lg stg:border stg:border-border stg:bg-muted-faint"
          style={{ height: "240px" }}
        />
      </div>
      <div className="stg:space-y-2">
        <div className="stg:h-3 stg:w-20 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div
          className="stg:animate-pulse stg:rounded-lg stg:border stg:border-border stg:bg-muted-faint"
          style={{ height: "64px" }}
        />
      </div>
    </LoadingRegion>
  );
}

function NotFoundState({ className }: { readonly className?: string }) {
  return (
    <EmptyState
      variant="first-use"
      icon={<SkillIcon />}
      title="This skill isn't here"
      description="It may have been deleted, or it belongs to an organization you're not in."
      className={className}
    />
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
