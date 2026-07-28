import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  McpServerCreationWizard,
  CreationPicker,
  ApplyManifestDialog,
  MCP_SERVER_TEMPLATES,
  useActiveOrgSlug,
  useBreadcrumbOverride,
} from "@stigmer/react";
import type { CreationPath, McpServerWizardData } from "@stigmer/react";

type PageState =
  | { readonly phase: "picking" }
  | {
      readonly phase: "wizard";
      readonly initialData?: Partial<McpServerWizardData>;
    };

export default function McpServerNewPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();

  const [state, setState] = useState<PageState>({ phase: "picking" });
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    setLabel("New MCP server");
    return () => setLabel(null);
  }, [setLabel]);

  const handlePickerSelect = useCallback((path: CreationPath) => {
    switch (path.kind) {
      case "scratch":
        setState({ phase: "wizard" });
        break;
      case "template":
        setState({
          phase: "wizard",
          initialData: path.data as Partial<McpServerWizardData>,
        });
        break;
      case "import":
        setImportOpen(true);
        break;
    }
  }, []);

  const handleWizardComplete = useCallback(
    (result: { org: string; slug: string }) => {
      navigate(`/library/mcp-servers/${result.org}/${result.slug}`);
    },
    [navigate],
  );

  const handleCancel = useCallback(() => {
    if (state.phase === "wizard") {
      setState({ phase: "picking" });
    } else {
      navigate("/library/mcp-servers");
    }
  }, [state.phase, navigate]);

  if (!org) return null;

  return (
    <>
      {state.phase === "picking" ? (
        <CreationPicker
          resourceLabel="MCP server"
          templates={MCP_SERVER_TEMPLATES}
          onSelect={handlePickerSelect}
        />
      ) : (
        <McpServerCreationWizard
          org={org}
          initialData={state.initialData}
          onComplete={handleWizardComplete}
          onCancel={handleCancel}
          className="min-h-[480px]"
        />
      )}

      <ApplyManifestDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        org={org}
        onApplied={() => navigate("/library/mcp-servers")}
      />
    </>
  );
}
