"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  WorkflowEditorView,
  STARTER_WORKFLOW_YAML,
  useActiveOrgSlug,
  useBreadcrumbOverride,
  toast,
} from "@stigmer/react";

export function WorkflowNewPage() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("New workflow");
  }, [setLabel]);

  const handleSaveSuccess = useCallback(() => {
    toast.success("Workflow created");
    router.push("/library/workflows");
  }, [router]);

  const handleSaveError = useCallback((error: Error) => {
    toast.error(error.message);
  }, []);

  if (!org) return null;

  return (
    <div className="h-[calc(100vh-12rem)]">
      <WorkflowEditorView
        initialYaml={STARTER_WORKFLOW_YAML}
        org={org}
        defaultMode="visual"
        onSaveSuccess={handleSaveSuccess}
        onSaveError={handleSaveError}
      />
    </div>
  );
}
