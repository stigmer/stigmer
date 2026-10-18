"use client";

/**
 * An Environment's page: what it is for, the network it allows, and the
 * packages it installs, each edited in place by whoever may edit it.
 *
 * The shape is the routine's and the plugin's: the Environment fetched
 * inside, rendered in `ResourceDetailShell` with Manage access (owner and
 * viewer, and its general access) folded into the kebab, the slug field
 * that renames it for whoever may delete it, and navigation left to the
 * host through callbacks. Each section saves by mask
 * (`useUpdateEnvironment`), so an edit of the packages never overwrites a
 * teammate's edit of the network, and the server's refusal (a host it does
 * not admit, a policy this server's sandboxes cannot honour) shows under
 * the section's editor. Delete is refused while an agent, a routine or an
 * organization's default names the Environment; the refusal's sentence,
 * which names each of them, is the toast's description.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useManageAccess } from "../access/useManageAccess.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { useExportResource } from "../library/useExportResource.js";
import { VisibilityBadge } from "../library/VisibilitySelector.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { ResourceSlugField } from "../resource-detail/RenameSlugField.js";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell.js";
import { Section } from "../resource-detail/Section.js";
import type { DetailAction, ResourceHeaderMeta } from "../resource-detail/types.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { useCopyResource } from "../resource-detail/useCopyResource.js";
import { useDeleteResource } from "../resource-detail/useDeleteResource.js";
import {
  NetworkingFields,
  PACKAGE_MANAGERS,
  PACKAGE_MANAGER_HINTS,
  PackagesFields,
  networkingDraftOf,
  networkingInputOf,
  packageCountOf,
  packagesDraftOf,
  packagesInputOf,
} from "./EnvironmentFields.js";
import { EnvironmentsNotOnServerNotice } from "./EnvironmentsNotOnServerNotice.js";
import { useEnvironment } from "./useEnvironment.js";
import { useUpdateEnvironment, type EnvironmentEdit } from "./useUpdateEnvironment.js";

/** Props for {@link EnvironmentDetailView}. */
export interface EnvironmentDetailViewProps {
  /** Organization id (a slug is also accepted). */
  readonly org: string;
  /** Environment slug. */
  readonly slug: string;
  /** Called when the Environment loads or reloads (e.g. breadcrumb label sync). */
  readonly onResourceLoad?: (environment: Environment) => void;
  /** Fired with the renamed Environment after a rename from the slug field; a host whose address names the slug moves it. */
  readonly onRenamed?: (environment: Environment) => void;
  /** Called after a successful delete (navigate back to the list). */
  readonly onDeleted?: () => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/** The sections a person edits, one at a time. */
type EditingSection = "description" | "network" | "packages";

/**
 * Detail view for one Environment: its description, network and packages,
 * edited in place by its editors; rename, access, export and delete.
 *
 * @example
 * ```tsx
 * <EnvironmentDetailView
 *   org="acme"
 *   slug="data-science"
 *   onDeleted={() => router.push("/library/environments")}
 * />
 * ```
 */
export function EnvironmentDetailView({
  org,
  slug,
  onResourceLoad,
  onRenamed,
  onDeleted,
  className,
}: EnvironmentDetailViewProps) {
  const { environment, isLoading, error, refetch } = useEnvironment(org, slug);
  const loadedId = environment?.metadata?.id ?? null;

  // Pencils show only to those the server lets edit. Nothing renders while
  // the check is in flight, so a member never sees one flash.
  const editCheck = useCheckPermission(loadedId ? { kind: "environment", id: loadedId } : null, "can_edit");
  const canEdit = !editCheck.isLoading && editCheck.allowed;

  const access = useManageAccess({
    resource: environment?.metadata
      ? {
          kind: ApiResourceKind.environment,
          kindString: "environment",
          id: environment.metadata.id,
          org: environment.metadata.org,
          name: environment.metadata.name,
        }
      : null,
    visibility: environment?.metadata
      ? {
          kind: "environment",
          current: environment.metadata.visibility,
          org: environment.metadata.org,
          onChanged: refetch,
        }
      : undefined,
  });

  const { deleteResource, isDeleting } = useDeleteResource("environment", loadedId, environment?.metadata?.name);
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { copyYaml, downloadYaml } = useExportResource({ resource: environment });

  const onResourceLoadRef = useRef(onResourceLoad);
  onResourceLoadRef.current = onResourceLoad;
  useEffect(() => {
    if (environment) {
      onResourceLoadRef.current?.(environment);
    }
  }, [environment]);

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error) return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!environment) return <NotFoundState className={className} />;

  const meta = environment.metadata;
  const specAudit = environment.status?.audit?.specAudit;
  const name = meta?.name || meta?.slug || slug;

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Delete this environment?",
      description:
        `"${name}" will be permanently removed. An environment an agent, a routine or the organization's ` +
        "default still names cannot be deleted until they stop naming it. This cannot be undone.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      await deleteResource();
    } catch {
      // The toast carries the server's sentence: what still names it.
      return;
    }
    onDeleted?.();
  };

  const actions: DetailAction[] = [
    ...(access.action ? [access.action] : []),
    { id: "copy-id", label: "Copy ID", onAction: () => void copyId(meta?.id ?? ""), group: "clipboard" },
    {
      id: "copy-slug",
      label: "Copy slug",
      onAction: () => void copyQualifiedSlug(org, meta?.slug ?? slug),
      group: "clipboard",
    },
    { id: "copy-yaml", label: "Copy YAML", onAction: () => void copyYaml(), group: "export" },
    { id: "download-yaml", label: "Download YAML", onAction: downloadYaml, group: "export" },
    {
      id: "delete",
      label: "Delete",
      variant: "destructive",
      onAction: () => void handleDelete(),
      disabled: isDeleting,
      group: "danger",
    },
  ];

  const headerMeta: ResourceHeaderMeta = {
    name,
    id: meta?.id ?? "",
    org: meta?.org,
    slug: meta?.slug,
    icon: <EnvironmentIcon className="stg:size-6 stg:text-muted-foreground" />,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
  };

  const visibilityControl = meta ? (
    <VisibilityBadge visibility={meta.visibility} onClick={access.action ? access.open : undefined} />
  ) : undefined;

  return (
    <>
      <ResourceDetailShell
        header={headerMeta}
        visibilityControl={visibilityControl}
        actions={actions}
        className={className}
      >
        <EnvironmentOverview
          environment={environment}
          canEdit={canEdit}
          onSaved={refetch}
          onRenamed={(renamed) => {
            onRenamed?.(renamed);
            refetch();
          }}
        />
      </ResourceDetailShell>
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
      {access.dialog}
    </>
  );
}

function EnvironmentOverview({
  environment,
  canEdit,
  onSaved,
  onRenamed,
}: {
  readonly environment: Environment;
  readonly canEdit: boolean;
  readonly onSaved: () => void;
  readonly onRenamed: (renamed: Environment) => void;
}) {
  const meta = environment.metadata;
  const spec = environment.spec;
  const [editing, setEditing] = useState<EditingSection | null>(null);
  const { update, isUpdating, error, clearError } = useUpdateEnvironment();

  const open = useCallback(
    (section: EditingSection) => {
      clearError();
      setEditing(section);
    },
    [clearError],
  );
  const close = useCallback(() => {
    clearError();
    setEditing(null);
  }, [clearError]);

  const save = useCallback(
    async (edit: EnvironmentEdit) => {
      try {
        await update(environment, edit);
      } catch {
        // The editor stays open with the refusal under it.
        return;
      }
      setEditing(null);
      onSaved();
    },
    [update, environment, onSaved],
  );

  const limited = spec?.networking?.type === NetworkingType.limited;
  const hosts = spec?.networking?.allowedHosts ?? [];
  const packageCount = packageCountOf(spec?.packages);

  return (
    <div className="stg:flex stg:flex-col stg:gap-6">
      <EnvironmentsNotOnServerNotice />

      <ResourceSlugField
        kind="environment"
        resourceId={meta?.id || null}
        currentSlug={meta?.slug ?? ""}
        onRenamed={(renamed) => onRenamed(renamed as Environment)}
        className="stg:max-w-md"
      />

      <Section title="Description" onEdit={canEdit && editing === null ? () => open("description") : undefined}>
        {editing === "description" ? (
          <DescriptionEditor
            initial={spec?.description ?? ""}
            isSaving={isUpdating}
            error={error}
            onSave={(description) => void save({ description })}
            onCancel={close}
          />
        ) : (
          <p className="stg:px-3 stg:py-2.5 stg:text-sm stg:text-foreground">
            {spec?.description || <span className="stg:text-muted-foreground">No description</span>}
          </p>
        )}
      </Section>

      <Section title="Network" onEdit={canEdit && editing === null ? () => open("network") : undefined}>
        {editing === "network" ? (
          <NetworkEditor
            environment={environment}
            isSaving={isUpdating}
            error={error}
            onSave={(networking) => void save({ networking })}
            onCancel={close}
          />
        ) : (
          <div className="stg:flex stg:flex-col stg:gap-1.5 stg:px-3 stg:py-2.5 stg:text-sm">
            <p className="stg:text-foreground">{limited ? "Limited to listed websites" : "Unrestricted"}</p>
            {limited && (
              <>
                {hosts.length > 0 ? (
                  <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-wrap stg:gap-1.5")} aria-label="Allowed websites">
                    {hosts.map((host) => (
                      <li key={host} className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-xs stg:text-foreground">
                        {host}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="stg:text-xs stg:text-muted-foreground">No websites listed.</p>
                )}
                <p className="stg:text-xs stg:text-muted-foreground">
                  {spec?.networking?.allowPackageManagers
                    ? "Package registries and code hosts are allowed."
                    : "Package registries and code hosts are not allowed."}{" "}
                  {spec?.networking?.allowMcpServers
                    ? "The agent's MCP servers are allowed."
                    : "The agent's MCP servers are not allowed."}
                </p>
              </>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Packages"
        count={packageCount}
        onEdit={canEdit && editing === null ? () => open("packages") : undefined}
      >
        {editing === "packages" ? (
          <PackagesEditor
            environment={environment}
            isSaving={isUpdating}
            error={error}
            onSave={(packages) => void save({ packages })}
            onCancel={close}
          />
        ) : packageCount === 0 ? (
          <p className="stg:px-3 stg:py-2.5 stg:text-sm stg:text-muted-foreground">No packages.</p>
        ) : (
          <dl className="stg:divide-y stg:divide-border">
            {PACKAGE_MANAGERS.filter((manager) => (spec?.packages?.[manager].length ?? 0) > 0).map((manager) => (
              <div key={manager} className="stg:flex stg:flex-col stg:gap-1 stg:px-3 stg:py-2">
                <dt className="stg:text-xs stg:text-muted-foreground">{PACKAGE_MANAGER_HINTS[manager].label}</dt>
                <dd className="stg:flex stg:flex-wrap stg:gap-1.5">
                  {spec?.packages?.[manager].map((entry) => (
                    <code key={entry} className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-xs stg:text-foreground">
                      {entry}
                    </code>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>
    </div>
  );
}

function DescriptionEditor({
  initial,
  isSaving,
  error,
  onSave,
  onCancel,
}: {
  readonly initial: string;
  readonly isSaving: boolean;
  readonly error: string | null;
  readonly onSave: (description: string) => void;
  readonly onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <EditorFrame isSaving={isSaving} error={error} onSave={() => onSave(value.trim())} onCancel={onCancel}>
      <label className="stg:sr-only" htmlFor="environment-description-editor">
        Description
      </label>
      <textarea
        id="environment-description-editor"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        maxLength={500}
        disabled={isSaving}
        className={inputClasses}
      />
    </EditorFrame>
  );
}

function NetworkEditor({
  environment,
  isSaving,
  error,
  onSave,
  onCancel,
}: {
  readonly environment: Environment;
  readonly isSaving: boolean;
  readonly error: string | null;
  readonly onSave: (networking: ReturnType<typeof networkingInputOf>) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => networkingDraftOf(environment.spec?.networking));
  return (
    <EditorFrame isSaving={isSaving} error={error} onSave={() => onSave(networkingInputOf(draft))} onCancel={onCancel}>
      <NetworkingFields value={draft} onChange={setDraft} disabled={isSaving} />
    </EditorFrame>
  );
}

function PackagesEditor({
  environment,
  isSaving,
  error,
  onSave,
  onCancel,
}: {
  readonly environment: Environment;
  readonly isSaving: boolean;
  readonly error: string | null;
  readonly onSave: (packages: ReturnType<typeof packagesInputOf>) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => packagesDraftOf(environment.spec?.packages));
  return (
    <EditorFrame isSaving={isSaving} error={error} onSave={() => onSave(packagesInputOf(draft))} onCancel={onCancel}>
      <PackagesFields value={draft} onChange={setDraft} disabled={isSaving} />
    </EditorFrame>
  );
}

/** An inline editor's frame: its fields, the save's refusal, and Save and Cancel. */
function EditorFrame({
  children,
  isSaving,
  error,
  onSave,
  onCancel,
}: {
  readonly children: React.ReactNode;
  readonly isSaving: boolean;
  readonly error: string | null;
  readonly onSave: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-3 stg:px-3 stg:py-3">
      {children}
      {error && (
        <p className="stg:text-xs stg:text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isSaving && <SpinnerIcon size={12} />}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
            "stg:text-muted-foreground stg:hover:bg-accent-hover stg:hover:text-foreground",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The Environment kind's icon: a box, what a sandbox is given. */
export function EnvironmentIcon({ className }: { readonly className?: string }) {
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
      <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  );
}

function LoadingSkeleton({ className }: { readonly className?: string }) {
  return (
    <LoadingRegion className={cn("stg:flex stg:flex-col stg:gap-6", className)} label="Loading environment details">
      <div className="stg:flex stg:items-start stg:gap-3">
        <div className="stg:mt-1 stg:size-6 stg:shrink-0 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:flex-1 stg:space-y-2">
          <div className="stg:h-5 stg:w-48 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-3 stg:w-64 stg:animate-pulse stg:rounded stg:bg-muted" />
        </div>
      </div>
      <div className="stg:h-24 stg:animate-pulse stg:rounded-lg stg:bg-muted" />
    </LoadingRegion>
  );
}

function NotFoundState({ className }: { readonly className?: string }) {
  return (
    <div role="status" className={cn("stg:flex stg:flex-col stg:items-center stg:gap-2 stg:py-12 stg:text-center", className)}>
      <EnvironmentIcon className="stg:size-10 stg:text-muted-foreground-faint" />
      <p className="stg:text-sm stg:font-medium stg:text-muted-foreground">Environment not found</p>
      <p className="stg:text-xs stg:text-muted-foreground">
        No environment with this name exists in the organization, or you may not view it.
      </p>
    </div>
  );
}

const inputClasses = cn(
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);
