import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  WorkflowEditorView,
  STARTER_WORKFLOW_YAML,
  useActiveOrgSlug,
  useBreadcrumbOverride,
  toast,
} from "@stigmer/react";

export default function WorkflowNewPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("New workflow");
    return () => setLabel(null);
  }, [setLabel]);

  const handleSaveSuccess = useCallback(() => {
    toast.success("Workflow created");
    navigate("/library/workflows");
  }, [navigate]);

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
