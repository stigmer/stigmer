import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  WorkflowDetailView,
  WorkflowEditorView,
  WorkflowRunDialog,
  useWorkflow,
  useWorkflowYaml,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  useElkLayoutEngine,
  ConfirmDialog,
  useBreadcrumbOverride,
  toast,
  type DetailAction,
  type AdditionalTab,
} from "@stigmer/react";

const elkWorkerFactory = () =>
  new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url));

export default function WorkflowDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
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
  const { yaml: initialYaml } = useWorkflowYaml(org ?? "", slug ?? "");
  // The run dialog's own copy: refreshed whenever the detail view saves a
  // change, so the dialog never reads a stale run audience or env.
  const { workflow, refetch: refetchWorkflow } = useWorkflow(
    org ?? "",
    slug ?? "",
  );
  const [showRunDialog, setShowRunDialog] = useState(false);

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
      navigate(`/executions/${executionId}`);
    },
    [navigate],
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
      navigate(`/executions/${executionId}`);
    },
    [navigate],
  );

  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: `Delete ${resourceName}?`,
      description:
        "This permanently removes the workflow. " +
        "Past executions are preserved in the execution history. " +
        "This action cannot be undone.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (confirmed) {
      try {
        await deleteResource();
        navigate("/library/workflows");
      } catch {
        // error toast handled by useDeleteResource
      }
    }
  }, [confirm, deleteResource, navigate, resourceName]);

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
      // Workflows edit YAML in the dedicated Editor tab (graph preview,
      // validation, version messages) — one YAML surface per workflow,
      // wired identically to the web app.
      {
        id: "edit-yaml",
        label: "Edit YAML",
        group: "export",
        onAction: () => setActiveTab("editor"),
        disabled: !initialYaml,
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
    [resourceId, copyId, copyQualifiedSlug, org, slug, initialYaml, handleDelete, isDeleting],
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
                    org={org ?? ""}
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

  if (!org || !slug) return null;

  return (
    <>
      <div className="relative">
        <WorkflowDetailView
          org={org}
          slug={slug}
          onResourceLoad={handleResourceLoad}
          onResourceUpdated={refetchWorkflow}
          editable
          primaryAction={primaryAction}
          actions={actions}
          additionalTabs={additionalTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onExecutionClick={(id) => navigate(`/executions/${id}`)}
          onOpenInEditor={handleOpenInEditor}
          onViewLatestRun={handleViewLatestRun}
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
          onSuccess={handleRunSuccess}
          onError={handleRunError}
        />
      )}
    </>
  );
}
