"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@stigmer/theme";
import {
  WorkflowEditorView,
  WorkflowArchitectDialog,
  WorkflowTemplateGallery,
  STARTER_WORKFLOW_YAML,
  WORKFLOW_TEMPLATES,
  useActiveOrgSlug,
  useBreadcrumbOverride,
  useElkLayoutEngine,
  toast,
  type WorkflowTemplate,
} from "@stigmer/react";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import { useRequestFullViewport } from "@/domain/library/full-viewport-layout";

const elkWorkerFactory = () =>
  new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url));

type PagePhase = "picking" | "templates" | "editor" | "generating";

export function WorkflowNewPage() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  const elkEngine = useElkLayoutEngine({ workerFactory: elkWorkerFactory });
  const { navigateToDetail } = useLibraryNavigation();
  const { setLabel } = useBreadcrumbOverride();

  const [phase, setPhase] = useState<PagePhase>("picking");
  const [initialYaml, setInitialYaml] = useState(STARTER_WORKFLOW_YAML);

  useRequestFullViewport(phase === "editor");

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

  const handleTemplateSelect = useCallback(
    (template: WorkflowTemplate) => {
      setInitialYaml(template.data.yaml ?? STARTER_WORKFLOW_YAML);
      setPhase("editor");
    },
    [],
  );

  const handleGenerateSuccess = useCallback(
    (genOrg: string, slug: string) => {
      navigateToDetail("workflows", genOrg, slug);
    },
    [navigateToDetail],
  );

  if (!org) return null;

  if (phase === "editor") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => setPhase("picking")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm",
              "text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <BackArrowIcon />
            Back
          </button>
          <span className="text-sm font-medium text-foreground">
            New workflow
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <WorkflowEditorView
            initialYaml={initialYaml}
            org={org}
            defaultMode="visual"
            layoutEngine={elkEngine}
            onSaveSuccess={handleSaveSuccess}
            onSaveError={handleSaveError}
            className="h-full"
          />
        </div>
      </div>
    );
  }

  if (phase === "templates") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPhase("picking")}
            aria-label="Back to creation options"
            className={cn(
              "inline-flex items-center justify-center rounded-md p-1.5",
              "text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <BackArrowIcon />
          </button>
          <h2 className="text-base font-semibold text-foreground">
            Choose a template
          </h2>
        </div>
        <WorkflowTemplateGallery
          templates={WORKFLOW_TEMPLATES}
          onSelect={handleTemplateSelect}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Create a new workflow
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose how you&apos;d like to get started.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <OptionCard
            title="Start from template"
            description="Browse pre-built workflow patterns and customize them."
            icon={<TemplateIcon />}
            onClick={() => setPhase("templates")}
            badge={`${WORKFLOW_TEMPLATES.length} available`}
          />
          <OptionCard
            title="Visual Editor"
            description="Design your workflow visually with drag-and-drop tasks and connections."
            icon={<CanvasIcon />}
            onClick={() => {
              setInitialYaml(STARTER_WORKFLOW_YAML);
              setPhase("editor");
            }}
          />
          <OptionCard
            title="Generate with AI"
            description="Describe what you want and let AI create a workflow for you."
            icon={<SparklesIcon />}
            onClick={() => setPhase("generating")}
          />
        </div>
      </div>

      <WorkflowArchitectDialog
        open={phase === "generating"}
        onOpenChange={(open) => {
          if (!open) setPhase("picking");
        }}
        org={org}
        onSuccess={handleGenerateSuccess}
        onError={(message) => toast.error(message)}
      />
    </>
  );
}

function OptionCard({
  title,
  description,
  icon,
  onClick,
  badge,
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: React.ReactNode;
  readonly onClick: () => void;
  readonly badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-6 text-center",
        "transition-colors hover:border-primary hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span className="text-muted-foreground transition-colors group-hover:text-foreground">
        {icon}
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      {badge && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}

function TemplateIcon() {
  return (
    <svg
      className="size-8"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}

function CanvasIcon() {
  return (
    <svg
      className="size-8"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg
      className="size-8"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
      <path d="M18 15l.75 2.25L21 18l-2.25.75L18 21l-.75-2.25L15 18l2.25-.75z" />
    </svg>
  );
}

function BackArrowIcon() {
  return (
    <svg
      className="size-4"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}
