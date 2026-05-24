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
  useUpdateVisibility,
  useElkLayoutEngine,
  PermissionGate,
  SharePanel,
  ConfirmDialog,
  useBreadcrumbOverride,
  type DetailAction,
  type AdditionalTab,
} from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

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
  const { instances } = useWorkflowInstances(workflow?.metadata?.id);
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [showCreateInstanceDialog, setShowCreateInstanceDialog] = useState(false);
  const [instancesRefreshKey, setInstancesRefreshKey] = useState(0);
  const { copyYaml, copyJson, downloadYaml } = useExportResource({
    kind: "Workflow",
    resource: workflow,
  });
  const { updateVisibility, isPending: isVisibilityPending } = useUpdateVisibility(
    "workflow",
    resourceId,
  );
  const [showSharePanel, setShowSharePanel] = useState(false);

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
      router.push(`/executions/${executionId}`);
    },
    [router],
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
      router.push(`/executions/${executionId}`);
    },
    [router],
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
        id: "share",
        label: "Share",
        group: "sharing",
        onAction: () => setShowSharePanel((v) => !v),
        disabled: !resourceId,
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
    [resourceId, copyId, copyQualifiedSlug, org, slug, copyYaml, copyJson, downloadYaml, workflow, handleDelete, isDeleting],
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
          onResourceLoad={handleResourceLoad}
          onVisibilityChange={updateVisibility}
          isVisibilityPending={isVisibilityPending}
          editable
          primaryAction={primaryAction}
          actions={actions}
          additionalTabs={additionalTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onExecutionClick={(id) => router.push(`/executions/${id}`)}
          onCreateInstanceClick={() => setShowCreateInstanceDialog(true)}
          onOpenInEditor={handleOpenInEditor}
          onViewLatestRun={handleViewLatestRun}
          instancesRefreshKey={instancesRefreshKey}
        />
        {showSharePanel && resourceId && (
          <PermissionGate
            resource={{ kind: "workflow", id: resourceId }}
            relation="can_grant_access"
          >
            <div className="absolute right-0 top-0 z-10 w-80 rounded-lg border border-border bg-popover shadow-lg">
              <SharePanel
                resource={{ kind: "workflow", id: resourceId, resourceKind: ApiResourceKind.workflow }}
                resourceKindString="workflow"
                resourceKind={ApiResourceKind.workflow}
                onClose={() => setShowSharePanel(false)}
              />
            </div>
          </PermissionGate>
        )}
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
