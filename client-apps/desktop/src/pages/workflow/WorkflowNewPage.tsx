import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@stigmer/theme";
import {
  WorkflowEditorView,
  WorkflowArchitectDialog,
  STARTER_WORKFLOW_YAML,
  useActiveOrgSlug,
  useBreadcrumbOverride,
  useElkLayoutEngine,
  toast,
} from "@stigmer/react";
import { useRequestFullViewport } from "../library/full-viewport-layout";

const elkWorkerFactory = () =>
  new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url));

type PagePhase = "picking" | "editor" | "generating";

export default function WorkflowNewPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();
  const elkEngine = useElkLayoutEngine({ workerFactory: elkWorkerFactory });
  const { setLabel } = useBreadcrumbOverride();

  const [phase, setPhase] = useState<PagePhase>("picking");

  useRequestFullViewport(phase === "editor");

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

  const handleGenerateSuccess = useCallback(
    (genOrg: string, slug: string) => {
      navigate(`/library/workflows/${genOrg}/${slug}`);
    },
    [navigate],
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
            initialYaml={STARTER_WORKFLOW_YAML}
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

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <OptionCard
            title="Visual Editor"
            description="Design your workflow visually with drag-and-drop tasks and connections."
            icon={<CanvasIcon />}
            onClick={() => setPhase("editor")}
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
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: React.ReactNode;
  readonly onClick: () => void;
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
    </button>
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
