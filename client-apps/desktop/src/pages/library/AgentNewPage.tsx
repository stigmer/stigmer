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
function preselectedServerSlugs(raw: string | null): readonly string[] {
  return raw ? raw.split(",").filter((slug) => slug !== "") : [];
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

  // The slugs are read once; the org they belong to resolves a render later,
  // so the usages are built where the wizard is rendered.
  const [preselected] = useState(() => preselectedServerSlugs(searchParams.get("mcp")));
  const [state, setState] = useState<PageState>(() => (preselected.length > 0 ? { phase: "wizard" } : { phase: "picking" }));
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
          initialData={
            state.initialData ??
            (preselected.length > 0
              ? { mcpServerUsages: preselected.map((slug) => ({ mcpServerRef: { org, slug } })) }
              : undefined)
          }
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
