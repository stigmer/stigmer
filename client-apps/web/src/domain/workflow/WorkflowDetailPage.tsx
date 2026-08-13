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
  useDeleteWorkflowInstance,
  useExportResource,
  useElkLayoutEngine,
  ConfirmDialog,
  useBreadcrumbOverride,
  useActiveOrgSlug,
  type DetailAction,
  type AdditionalTab,
} from "@stigmer/react";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
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
  // when no org context is active). This is a separate fetch from the
  // Instances tab's own list, so instance create/delete must refetch it
  // explicitly (alongside the instancesRefreshKey bump) or the picker
  // drifts stale.
  const { instances, refetch: refetchInstances } = useWorkflowInstances(
    workflow?.metadata?.id,
    viewerOrg || org,
  );
  const { deleteInstance } = useDeleteWorkflowInstance();
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [showCreateInstanceDialog, setShowCreateInstanceDialog] = useState(false);
  const [instancesRefreshKey, setInstancesRefreshKey] = useState(0);
  // Instance targeted by a row-level "Run" — preselects the run dialog's
  // picker. null means the header Run button (server-resolved default).
  const [runInstanceId, setRunInstanceId] = useState<string | null>(null);
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
            onAction: () => {
              setRunInstanceId(null);
              setShowRunDialog(true);
            },
          }
        : undefined,
    [workflow],
  );

  const handleInstanceRun = useCallback((instance: WorkflowInstance) => {
    setRunInstanceId(instance.metadata?.id ?? null);
    setShowRunDialog(true);
  }, []);

  const handleInstanceDelete = useCallback(
    async (instance: WorkflowInstance) => {
      const name =
        instance.metadata?.name || instance.metadata?.slug || "this instance";
      // Honest copy: instance deletion does NOT cascade to executions on
      // either edition — they stay visible on the workflow's Executions tab
      // (spec.workflow_id is denormalized onto every execution at create).
      const confirmed = await confirm({
        title: `Delete ${name}?`,
        description:
          "This permanently removes the instance and its environment bindings. " +
          "Executions already run against it are preserved in the workflow's execution history. " +
          "This action cannot be undone.",
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!confirmed) return;
      const id = instance.metadata?.id;
      if (!id) return;
      try {
        await deleteInstance(id);
        toast.success("Instance deleted");
        setInstancesRefreshKey((k) => k + 1);
        refetchInstances();
      } catch {
        toast.error("Failed to delete instance");
      }
    },
    [confirm, deleteInstance, refetchInstances],
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
        "This permanently removes the workflow and all of its instances. " +
        "Past executions are preserved in the execution history. " +
        "This action cannot be undone.",
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
          onInstanceRunClick={handleInstanceRun}
          onInstanceDeleteClick={handleInstanceDelete}
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
          initialInstanceId={runInstanceId}
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
