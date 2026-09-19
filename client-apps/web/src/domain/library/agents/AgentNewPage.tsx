"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AgentCreationWizard,
  CreationPicker,
  ApplyManifestDialog,
  AGENT_TEMPLATES,
  useActiveOrgSlug,
  useBreadcrumbOverride,
} from "@stigmer/react";
import type { CreationPath } from "@stigmer/react";
import type { AgentWizardData } from "@stigmer/react";

/**
 * `?mcp=<slug>,<slug>`: a plugin's page hands its servers here through
 * "Create a new agent with these tools", and the wizard opens with them
 * preselected, the picker skipped. Read through the router (the billing
 * page's precedent) rather than `window.location`, which a client-side
 * navigation updates only after this page has rendered once.
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

/**
 * Console page for creating a new agent.
 *
 * Mounted at `/library/agents/new`. Shows a creation picker ("step 0")
 * with three paths — blank, template, or import. Selecting blank or a
 * template transitions to the `AgentCreationWizard` with optional
 * pre-filled data. Import opens the `ApplyManifestDialog`. With
 * `?mcp=<slug>,<slug>` in the URL the wizard opens directly with those
 * MCP servers preselected (a plugin's "Create a new agent with these tools").
 */
export function AgentNewPage() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setLabel } = useBreadcrumbOverride();

  // The slugs are read once; the org they belong to resolves a render later,
  // so the usages are built where the wizard is rendered.
  const [preselected] = useState(() => preselectedServerSlugs(searchParams.get("mcp")));
  const [state, setState] = useState<PageState>(() => (preselected.length > 0 ? { phase: "wizard" } : { phase: "picking" }));
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    setLabel("New agent");
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
      router.push(`/library/agents/${result.org}/${result.slug}`);
    },
    [router],
  );

  const handleCancel = useCallback(() => {
    if (state.phase === "wizard") {
      setState({ phase: "picking" });
    } else {
      router.push("/library/agents");
    }
  }, [state.phase, router]);

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
        onApplied={() => router.push("/library/agents")}
      />
    </>
  );
}
