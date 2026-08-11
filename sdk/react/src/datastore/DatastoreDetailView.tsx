"use client";

import { useEffect, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Datastore } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell.js";
import type { DetailAction, ResourceHeaderMeta } from "../resource-detail/types.js";
import { CollectionRecordsBrowser } from "./CollectionRecordsBrowser.js";
import { CollectionSchemaView } from "./CollectionSchemaView.js";
import { DatastoreSyncReport } from "./DatastoreSyncReport.js";
import { useDatastore } from "./useDatastore.js";

/** The detail view's tabs. */
export type DatastoreDetailTab = "overview" | "records";

/** Props for {@link DatastoreDetailView}. */
export interface DatastoreDetailViewProps {
  /** Organization slug. */
  readonly org: string;
  /** Datastore slug. */
  readonly slug: string;
  /** Primary action rendered as a visible button. */
  readonly primaryAction?: DetailAction;
  /** Overflow actions (Edit YAML / Export / Delete — assembled at the page level). */
  readonly actions?: readonly DetailAction[];
  /** Called when the datastore loads or reloads (e.g. breadcrumb label sync). */
  readonly onResourceLoad?: (datastore: Datastore) => void;
  /** Initial tab for uncontrolled usage. @default "overview" */
  readonly defaultTab?: DatastoreDetailTab;
  /** Controlled active tab. Uncontrolled (internal state) when omitted. */
  readonly activeTab?: DatastoreDetailTab;
  /** Tab-change callback for controlled usage. */
  readonly onTabChange?: (tab: DatastoreDetailTab) => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Self-contained detail view for a Datastore — the Library-resource
 * home (DD-008 SD-1): an **Overview** tab (schema, authorization
 * summary, and the sync-report health strip — all from the loaded
 * resource, the authoritative source for structure and health) and a
 * **Records** tab (the browser, whose caller-effective verbs come from
 * `describeDatastore`). No version-history affordance —
 * `is_versioned: false` (DD-003).
 *
 * Handles loading, error, and not-found states automatically.
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function DatastoreDetailView({
  org,
  slug,
  primaryAction,
  actions,
  onResourceLoad,
  defaultTab = "overview",
  activeTab,
  onTabChange,
  className,
}: DatastoreDetailViewProps) {
  const { datastore, isLoading, error, refetch } = useDatastore(org, slug);

  const [internalTab, setInternalTab] = useState<DatastoreDetailTab>(defaultTab);
  const tab = activeTab ?? internalTab;
  const setTab = onTabChange ?? setInternalTab;

  useEffect(() => {
    if (datastore) onResourceLoad?.(datastore);
  }, [datastore, onResourceLoad]);

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error)
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!datastore) return <NotFoundState className={className} />;

  const meta = datastore.metadata;
  const spec = datastore.spec;
  const status = datastore.status;
  const specAudit = status?.audit?.specAudit;

  const headerMeta: ResourceHeaderMeta = {
    name: meta?.name || meta?.slug || "Untitled",
    id: meta?.id || "",
    org: meta?.org,
    slug: meta?.slug,
    description: spec?.description,
    icon: <DatastoreIcon className="stg:size-6 stg:text-muted-foreground" />,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
  };

  return (
    <ResourceDetailShell
      header={headerMeta}
      primaryAction={primaryAction}
      actions={actions}
      tabs={[
        { id: "overview", label: "Overview" },
        { id: "records", label: "Records" },
      ]}
      activeTab={tab}
      onTabChange={(id) => setTab(id as DatastoreDetailTab)}
      tabsAriaLabel="Datastore sections"
      className={className}
    >
      {tab === "overview" ? (
        <div className="stg:flex stg:flex-col stg:gap-6">
          {status && <DatastoreSyncReport status={status} />}
          {spec && <CollectionSchemaView spec={spec} />}
        </div>
      ) : (
        spec &&
        meta && (
          <CollectionRecordsBrowser
            org={meta.org}
            datastoreSlug={meta.slug}
            spec={spec}
          />
        )
      )}
    </ResourceDetailShell>
  );
}

// ---------------------------------------------------------------------------
// Non-happy states
// ---------------------------------------------------------------------------

function LoadingSkeleton({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn("stg:flex stg:flex-col stg:gap-6", className)}
      aria-busy="true"
      aria-label="Loading datastore details"
    >
      <div className="stg:flex stg:items-start stg:gap-3">
        <div className="stg:mt-1 stg:size-6 stg:shrink-0 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:flex-1 stg:space-y-2">
          <div className="stg:h-5 stg:w-48 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-3 stg:w-64 stg:animate-pulse stg:rounded stg:bg-muted" />
        </div>
      </div>
      <div className="stg:space-y-2">
        <div className="stg:h-3 stg:w-28 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div
          className="stg:animate-pulse stg:rounded-lg stg:border stg:border-border stg:bg-muted-faint"
          style={{ height: "160px" }}
        />
      </div>
      <div className="stg:space-y-2">
        <div className="stg:h-3 stg:w-20 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div
          className="stg:animate-pulse stg:rounded-lg stg:border stg:border-border stg:bg-muted-faint"
          style={{ height: "240px" }}
        />
      </div>
    </div>
  );
}

function NotFoundState({ className }: { readonly className?: string }) {
  return (
    <div
      role="status"
      className={cn("stg:flex stg:flex-col stg:items-center stg:gap-2 stg:py-12 stg:text-center", className)}
    >
      <DatastoreIcon className="stg:size-10 stg:text-muted-foreground-faint" />
      <p className="stg:text-sm stg:font-medium stg:text-muted-foreground">Datastore not found</p>
      <p className="stg:text-xs stg:text-muted-foreground-subtle">
        This datastore doesn&apos;t exist or you don&apos;t have access to it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon (inline SVG — no icon-library dependency)
// ---------------------------------------------------------------------------

/** Database-cylinder icon shared by the detail view's states. */
export function DatastoreIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  );
}
