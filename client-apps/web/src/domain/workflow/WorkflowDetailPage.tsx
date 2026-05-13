"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  WorkflowDetailView,
  WorkflowEditorView,
  WorkflowRunDialog,
  useWorkflow,
  useWorkflowYaml,
  useWorkflowInstances,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  type DetailAction,
  type AdditionalTab,
} from "@stigmer/react";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

interface WorkflowDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

export function WorkflowDetailPageInner({
  org,
  slug,
}: WorkflowDetailPageInnerProps) {
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string>("Workflow");
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
      router.push(`/workflows/executions/${executionId}`);
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
        router.push("/workflows");
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
        id: "delete",
        label: "Delete",
        variant: "destructive" as const,
        group: "danger",
        onAction: handleDelete,
        disabled: isDeleting,
      },
    ],
    [resourceId, copyId, copyQualifiedSlug, org, slug, handleDelete, isDeleting],
  );

  const additionalTabs: AdditionalTab[] = useMemo(
    () =>
      initialYaml
        ? [
            {
              id: "editor",
              label: "Editor",
              content: (
                <div className="h-[600px]">
                  <WorkflowEditorView
                    initialYaml={initialYaml}
                    org={org}
                    onSaveSuccess={handleSaveSuccess}
                    onSaveError={handleSaveError}
                  />
                </div>
              ),
            },
          ]
        : [],
    [initialYaml, org, handleSaveSuccess, handleSaveError],
  );

  return (
    <>
      <WorkflowDetailView
        org={org}
        slug={slug}
        onResourceLoad={handleResourceLoad}
        primaryAction={primaryAction}
        actions={actions}
        additionalTabs={additionalTabs}
        onExecutionClick={(id) => router.push(`/workflows/executions/${id}`)}
      />
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
          onSuccess={handleRunSuccess}
          onError={handleRunError}
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
