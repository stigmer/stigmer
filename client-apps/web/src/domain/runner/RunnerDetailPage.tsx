"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RunnerDetailView,
  useStopRunner,
  useDeleteResource,
  useCopyResource,
  useConfirmAction,
  ConfirmDialog,
  toast,
  type DetailAction,
} from "@stigmer/react";

export interface RunnerDetailPageProps {
  readonly id: string;
}

export function RunnerDetailPage({ id }: RunnerDetailPageProps) {
  const router = useRouter();
  const { copyId } = useCopyResource();
  const [runnerName, setRunnerName] = useState<string>("Runner");
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const { deleteResource, isDeleting } = useDeleteResource("runner", id, runnerName);
  const { stop, isStopping } = useStopRunner();

  const handleResourceLoad = useCallback(
    ({ name }: { name: string; id: string }) => {
      setRunnerName(name);
    },
    [],
  );

  const handleStop = useCallback(async () => {
    const confirmed = await confirm({
      title: `Stop ${runnerName}?`,
      description: "The runner will stop accepting new executions. Running executions will be allowed to complete.",
      confirmLabel: "Stop",
      variant: "destructive",
    });
    if (confirmed) {
      try {
        await stop({ runnerId: id, reason: "stopped via web console" });
        toast.success(`${runnerName} stopped`);
      } catch {
        // error state managed by hook
      }
    }
  }, [confirm, stop, id, runnerName]);

  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: `Delete ${runnerName}?`,
      description: "This action cannot be undone. The runner will be permanently removed.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (confirmed) {
      try {
        await deleteResource();
        router.push("/runners");
      } catch {
        // error toast handled by useDeleteResource
      }
    }
  }, [confirm, deleteResource, router, runnerName]);

  const actions: DetailAction[] = useMemo(
    () => [
      {
        id: "copy-id",
        label: "Copy ID",
        group: "clipboard",
        onAction: () => copyId(id),
      },
      {
        id: "stop",
        label: "Stop",
        group: "lifecycle",
        onAction: handleStop,
        disabled: isStopping,
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
    [id, copyId, handleStop, isStopping, handleDelete, isDeleting],
  );

  return (
    <>
      <RunnerDetailView
        id={id}
        onResourceLoad={handleResourceLoad}
        actions={actions}
      />
      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
