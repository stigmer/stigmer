"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
 * pre-filled data. Import opens the `ApplyManifestDialog`.
 */
export function AgentNewPage() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  const [state, setState] = useState<PageState>({ phase: "picking" });
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
      />
    </>
  );
}
