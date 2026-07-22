import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Datastore } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import {
  DatastoreDetailView,
  DeleteDatastoreDialog,
  EditResourceYamlDialog,
  useDatastore,
  useCopyResource,
  useExportResource,
  useBreadcrumbOverride,
  type DetailAction,
} from "@stigmer/react";

export default function DatastoreDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { datastore, refetch: refetchDatastore } = useDatastore(
    org ?? "",
    slug ?? "",
  );
  const { copyYaml, copyJson, downloadYaml } = useExportResource({
    kind: "Datastore",
    resource: datastore,
  });
  const [editYamlOpen, setEditYamlOpen] = useState(false);
  // Datastore delete is the platform's only record-destroying resource
  // action — it uses the domain's guarded dialog, not the generic
  // one-shot confirm (DD-008 SD-6).
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => () => setLabel(null), [setLabel]);

  const handleResourceLoad = useCallback(
    (loaded: Datastore) => {
      const name =
        loaded.metadata?.name || loaded.metadata?.slug || "Datastore";
      setLabel(name);
      setResourceId(loaded.metadata?.id ?? null);
    },
    [setLabel],
  );

  const actions: DetailAction[] = useMemo(
    () => [
      {
        id: "copy-id",
        label: "Copy ID",
        group: "clipboard",
        onAction: () => {
          if (resourceId) copyId(resourceId);
        },
        disabled: !resourceId,
      },
      {
        id: "copy-slug",
        label: "Copy slug",
        group: "clipboard",
        onAction: () => copyQualifiedSlug(org ?? "", slug ?? ""),
      },
      {
        id: "edit-yaml",
        label: "Edit YAML",
        group: "export",
        onAction: () => setEditYamlOpen(true),
        disabled: !datastore,
      },
      {
        id: "export-yaml",
        label: "Export YAML",
        group: "export",
        onAction: copyYaml,
        disabled: !datastore,
      },
      {
        id: "export-json",
        label: "Export JSON",
        group: "export",
        onAction: copyJson,
        disabled: !datastore,
      },
      {
        id: "download-yaml",
        label: "Download YAML",
        group: "export",
        onAction: downloadYaml,
        disabled: !datastore,
      },
      {
        id: "delete",
        label: "Delete",
        variant: "destructive" as const,
        group: "danger",
        onAction: () => setDeleteOpen(true),
        disabled: !datastore,
      },
    ],
    [
      resourceId,
      copyId,
      copyQualifiedSlug,
      org,
      slug,
      copyYaml,
      copyJson,
      downloadYaml,
      datastore,
    ],
  );

  if (!org || !slug) return null;

  return (
    <>
      <DatastoreDetailView
        org={org}
        slug={slug}
        onResourceLoad={handleResourceLoad}
        actions={actions}
      />
      <EditResourceYamlDialog
        open={editYamlOpen}
        onOpenChange={setEditYamlOpen}
        resource={datastore}
        onApplied={refetchDatastore}
      />
      <DeleteDatastoreDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        datastore={datastore}
        onDeleted={() => navigate("/library/datastores")}
      />
    </>
  );
}
