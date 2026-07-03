"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceTemplate } from "./templates/types.js";
import { TemplateGallery } from "./TemplateGallery.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The creation path the user selected on the picker screen.
 *
 * - `"scratch"` — start the wizard with empty fields
 * - `"template"` — start the wizard with template-provided data
 * - `"import"` — open the import dialog (handled by the consumer)
 */
export type CreationPath =
  | { readonly kind: "scratch" }
  | { readonly kind: "template"; readonly data: Partial<unknown> }
  | { readonly kind: "import" };

/** Props for {@link CreationPicker}. */
export interface CreationPickerProps<TData> {
  /** Label for the resource type (e.g. "agent", "MCP server"). Used in headings. */
  readonly resourceLabel: string;
  /** Available templates for the gallery view. */
  readonly templates: readonly ResourceTemplate<TData>[];
  /** Called when the user selects a creation path. */
  readonly onSelect: (path: CreationPath) => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type PickerView = "options" | "gallery";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * "Step 0" landing screen for resource creation flows.
 *
 * Presents three creation entry points as large option cards:
 * 1. **Start from scratch** — blank wizard
 * 2. **Browse templates** — opens the template gallery inline
 * 3. **Import from file** — triggers the import dialog
 *
 * When the user clicks "Browse templates", the picker transitions
 * to show the `TemplateGallery` inline with a back button. Selecting
 * a template emits `onSelect({ kind: "template", data })`.
 *
 * This component is SDK-first with zero Console dependencies. The
 * consumer (e.g. `AgentNewPage`) handles routing, the import dialog,
 * and mounting the wizard.
 *
 * @typeParam TData - The wizard data shape (e.g. `AgentWizardData`).
 *
 * @example
 * ```tsx
 * <CreationPicker
 *   resourceLabel="agent"
 *   templates={AGENT_TEMPLATES}
 *   onSelect={(path) => {
 *     if (path.kind === "scratch") startWizard();
 *     if (path.kind === "template") startWizard(path.data);
 *     if (path.kind === "import") openImportDialog();
 *   }}
 * />
 * ```
 */
export function CreationPicker<TData>({
  resourceLabel,
  templates,
  onSelect,
  className,
}: CreationPickerProps<TData>) {
  const [view, setView] = useState<PickerView>("options");

  const handleTemplateSelect = useCallback(
    (template: ResourceTemplate<TData>) => {
      onSelect({ kind: "template", data: template.data });
    },
    [onSelect],
  );

  const handleBackToOptions = useCallback(() => {
    setView("options");
  }, []);

  if (view === "gallery") {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleBackToOptions}
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
        <TemplateGallery
          templates={templates}
          onSelect={handleTemplateSelect}
        />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Create a new {resourceLabel}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how you'd like to get started.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Start from scratch */}
        <OptionCard
          title="Start from scratch"
          description={`Create a blank ${resourceLabel} and configure it step by step.`}
          icon={<BlankPageIcon />}
          onClick={() => onSelect({ kind: "scratch" })}
        />

        {/* Browse templates */}
        {templates.length > 0 && (
          <OptionCard
            title="Browse templates"
            description={`Start with a pre-built ${resourceLabel} configuration.`}
            icon={<GridIcon />}
            onClick={() => setView("gallery")}
            badge={`${templates.length} available`}
          />
        )}

        {/* Import from file */}
        <OptionCard
          title="Import from file"
          description="Upload a YAML or JSON configuration file."
          icon={<UploadIcon />}
          onClick={() => onSelect({ kind: "import" })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Icons (inline SVGs — no external dependency)
// ---------------------------------------------------------------------------

function BlankPageIcon() {
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
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function GridIcon() {
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

function UploadIcon() {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
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
