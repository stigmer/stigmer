import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AgentCreationWizard,
  CreationPicker,
  ApplyManifestDialog,
  AGENT_TEMPLATES,
  useActiveOrgSlug,
  useBreadcrumbOverride,
} from "@stigmer/react";
import type { CreationPath, AgentWizardData } from "@stigmer/react";

/**
 * `?mcp=<slug>,<slug>`: a plugin's page hands its servers here through
 * "Create a new agent with these tools", and the wizard opens with them
 * preselected, the picker skipped. The same URL the web console reads; the
 * hash router keeps the query inside the hash, so it is read through the
 * router rather than `window.location`.
 */
function initialUsagesFrom(raw: string | null, org: string): Partial<AgentWizardData> | undefined {
  if (!raw) return undefined;
  const slugs = raw.split(",").filter((slug) => slug !== "");
  if (slugs.length === 0) return undefined;
  return { mcpServerUsages: slugs.map((slug) => ({ mcpServerRef: { org, slug } })) };
}

type PageState =
  | { readonly phase: "picking" }
  | {
      readonly phase: "wizard";
      readonly initialData?: Partial<AgentWizardData>;
    };

export default function AgentNewPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setLabel } = useBreadcrumbOverride();

  const [state, setState] = useState<PageState>(() => {
    const initialData = org ? initialUsagesFrom(searchParams.get("mcp"), org) : undefined;
    return initialData ? { phase: "wizard", initialData } : { phase: "picking" };
  });
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    setLabel("New agent");
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
          initialData: path.data as Partial<AgentWizardData>,
        });
        break;
      case "import":
        setImportOpen(true);
        break;
    }
  }, []);

  const handleWizardComplete = useCallback(
    (result: { org: string; slug: string }) => {
      navigate(`/library/agents/${result.org}/${result.slug}`);
    },
    [navigate],
  );

  const handleCancel = useCallback(() => {
    if (state.phase === "wizard") {
      setState({ phase: "picking" });
    } else {
      navigate("/library/agents");
    }
  }, [state.phase, navigate]);

  if (!org) return null;

  return (
    <>
      {state.phase === "picking" ? (
        <CreationPicker
          resourceLabel="agent"
          templates={AGENT_TEMPLATES}
          onSelect={handlePickerSelect}
        />
      ) : (
        <AgentCreationWizard
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
        onApplied={() => navigate("/library/agents")}
      />
    </>
  );
}
