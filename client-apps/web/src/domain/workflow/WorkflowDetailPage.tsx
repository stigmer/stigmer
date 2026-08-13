"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  WorkflowDetailView,
  WorkflowEditorView,
  WorkflowRunDialog,
  CreateWorkflowInstanceDialog,
  useWorkflow,
  useWorkflowYaml,
  useWorkflowInstances,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  useExportResource,
  useElkLayoutEngine,
  ConfirmDialog,
  useBreadcrumbOverride,
  useActiveOrgSlug,
  type DetailAction,
  type AdditionalTab,
} from "@stigmer/react";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { useExecutionNavigation } from "@/domain/workflow/execution-navigation";

const elkWorkerFactory = () =>
  new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url));

interface WorkflowDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

export function WorkflowDetailPageInner({
  org,
  slug,
}: WorkflowDetailPageInnerProps) {
  const router = useRouter();
  const { navigateToExecution } = useExecutionNavigation();
  const elkEngine = useElkLayoutEngine({ workerFactory: elkWorkerFactory });
  const { setLabel } = useBreadcrumbOverride();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string>("Workflow");
  const [activeTab, setActiveTab] = useState<string>("overview");
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();
  const { deleteResource, isDeleting } = useDeleteResource(
    "workflow",
    resourceId,
    resourceName,
  );
  const { yaml: initialYaml } = useWorkflowYaml(org, slug);
  const { workflow } = useWorkflow(org, slug);
  const viewerOrg = useActiveOrgSlug();
  // Scoped to the active org so the run dialog's instance picker offers
  // the same rows as the Instances tab (falls back to the workflow's org
  // when no org context is active).
  // `refetch` matters: this list feeds the Run dialog's instance picker,
  // and without refetching after a create, a user's new instance cannot be
  // targeted by Run until a full page reload (oss#571). The Instances tab
  // has its own list keyed by `instancesRefreshKey` — both must refresh.
  const { instances, refetch: refetchInstances } = useWorkflowInstances(
    workflow?.metadata?.id,
    viewerOrg || org,
  );
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [showCreateInstanceDialog, setShowCreateInstanceDialog] = useState(false);
  const [instancesRefreshKey, setInstancesRefreshKey] = useState(0);
  const { copyYaml, copyJson, downloadYaml } = useExportResource({
    kind: "Workflow",
    resource: workflow,
  });

  useEffect(() => () => setLabel(null), [setLabel]);

  const handleResourceLoad = useCallback(
    ({ name, id }: { name: string; id: string }) => {
      setLabel(name);
      setResourceId(id);
      setResourceName(name);
    },
    [setLabel],
  );

  const handleRunSuccess = useCallback(
    (executionId: string) => {
      toast.success("Workflow execution started");
      navigateToExecution(executionId);
    },
    [navigateToExecution],
  );

  const handleRunError = useCallback((message: string) => {
    toast.error(message);
  }, []);

  const primaryAction: DetailAction | undefined = useMemo(
    () =>
      workflow
        ? {
            id: "run",
            label: "Run",
            onAction: () => setShowRunDialog(true),
          }
        : undefined,
    [workflow],
  );

  const handleSaveSuccess = useCallback(() => {
    toast.success("Workflow saved successfully");
  }, []);

  const handleSaveError = useCallback((error: Error) => {
    toast.error(error.message);
  }, []);

  const handleOpenInEditor = useCallback((_taskName: string) => {
    setActiveTab("editor");
  }, []);

  const handleViewLatestRun = useCallback(
    (executionId: string) => {
      navigateToExecution(executionId);
    },
    [navigateToExecution],
  );

  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: `Delete ${resourceName}?`,
      description:
        "This action cannot be undone. The workflow and its configuration will be permanently removed.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (confirmed) {
      try {
        await deleteResource();
        router.push("/library/workflows");
      } catch {
        // error toast handled by useDeleteResource
      }
    }
  }, [confirm, deleteResource, router, resourceName]);

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
        onAction: () => copyQualifiedSlug(org, slug),
      },
      // Workflows edit YAML in the dedicated Editor tab (graph preview,
      // validation, version messages) — one YAML surface per workflow, so
      // this routes there instead of opening the generic manifest dialog.
      {
        id: "edit-yaml",
        label: "Edit YAML",
        group: "export",
        onAction: () => setActiveTab("editor"),
        disabled: !initialYaml,
      },
      {
        id: "export-yaml",
        label: "Export YAML",
        group: "export",
        onAction: copyYaml,
        disabled: !workflow,
      },
      {
        id: "export-json",
        label: "Export JSON",
        group: "export",
        onAction: copyJson,
        disabled: !workflow,
      },
      {
        id: "download-yaml",
        label: "Download YAML",
        group: "export",
        onAction: downloadYaml,
        disabled: !workflow,
      },
      {
        id: "delete",
        label: "Delete",
        variant: "destructive" as const,
        group: "danger",
        onAction: handleDelete,
        disabled: isDeleting,
      },
    ],
    [resourceId, copyId, copyQualifiedSlug, org, slug, copyYaml, copyJson, downloadYaml, workflow, initialYaml, handleDelete, isDeleting],
  );

  const additionalTabs: AdditionalTab[] = useMemo(
    () =>
      initialYaml
        ? [
            {
              id: "editor",
              label: "Editor",
              content: (
                <div className="h-[calc(100vh-16rem)]">
                  <WorkflowEditorView
                    initialYaml={initialYaml}
                    org={org}
                    layoutEngine={elkEngine}
                    onSaveSuccess={handleSaveSuccess}
                    onSaveError={handleSaveError}
                  />
                </div>
              ),
            },
          ]
        : [],
    [initialYaml, org, elkEngine, handleSaveSuccess, handleSaveError],
  );

  return (
    <>
      <div className="relative">
        <WorkflowDetailView
          org={org}
          slug={slug}
          viewerOrg={viewerOrg}
          onResourceLoad={handleResourceLoad}
          editable
          primaryAction={primaryAction}
          actions={actions}
          additionalTabs={additionalTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onExecutionClick={(id) => navigateToExecution(id)}
          onCreateInstanceClick={() => setShowCreateInstanceDialog(true)}
          onOpenInEditor={handleOpenInEditor}
          onViewLatestRun={handleViewLatestRun}
          instancesRefreshKey={instancesRefreshKey}
        />
      </div>
      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
      {workflow && (
        <WorkflowRunDialog
          open={showRunDialog}
          onOpenChange={setShowRunDialog}
          org={org}
          workflow={workflow}
          instances={instances}
          defaultInstanceId={workflow.status?.defaultInstanceId}
          onSuccess={handleRunSuccess}
          onError={handleRunError}
        />
      )}
      {workflow?.metadata?.id && (
        <CreateWorkflowInstanceDialog
          open={showCreateInstanceDialog}
          onOpenChange={setShowCreateInstanceDialog}
          org={org}
          workflowId={workflow.metadata.id}
          onCreated={() => {
            toast.success("Instance created");
            setInstancesRefreshKey((k) => k + 1);
            refetchInstances();
          }}
        />
      )}
    </>
  );
}

export function WorkflowDetailPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (!org || !slug) return null;

  return <WorkflowDetailPageInner org={org} slug={slug} />;
}
