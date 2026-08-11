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
      <div className={cn("stg:flex stg:flex-col stg:gap-4", className)}>
        <div className="stg:flex stg:items-center stg:gap-2">
          <button
            type="button"
            onClick={handleBackToOptions}
            aria-label="Back to creation options"
            className={cn(
              "stg:inline-flex stg:items-center stg:justify-center stg:rounded-md stg:p-1.5",
              "stg:text-muted-foreground stg:transition-colors",
              "stg:hover:bg-accent stg:hover:text-accent-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            <BackArrowIcon />
          </button>
          <h2 className="stg:text-base stg:font-semibold stg:text-foreground">
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
    <div className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
      <div>
        <h2 className="stg:text-lg stg:font-semibold stg:text-foreground">
          Create a new {resourceLabel}
        </h2>
        <p className="stg:mt-1 stg:text-sm stg:text-muted-foreground">
          Choose how you'd like to get started.
        </p>
      </div>

      <div className="stg:grid stg:grid-cols-1 stg:gap-3 stg:sm:grid-cols-3">
        {/* Start from scratch */}
        <OptionCard
          title="Start from scratch"
          description={`Create a blank ${resourceLabel} and configure it step by step.`}
          icon={<BlankPageIcon />}
          onClick={() => onSelect({ kind: "scratch" })}
          cursorTarget="creation-path-scratch"
        />

        {/* Browse templates */}
        {templates.length > 0 && (
          <OptionCard
            title="Browse templates"
            description={`Start with a pre-built ${resourceLabel} configuration.`}
            icon={<GridIcon />}
            onClick={() => setView("gallery")}
            badge={`${templates.length} available`}
            cursorTarget="creation-path-template"
          />
        )}

        {/* Import from file */}
        <OptionCard
          title="Import from file"
          description="Upload a YAML or JSON configuration file."
          icon={<UploadIcon />}
          onClick={() => onSelect({ kind: "import" })}
          cursorTarget="creation-path-import"
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
  cursorTarget,
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: React.ReactNode;
  readonly onClick: () => void;
  readonly badge?: string;
  /** `data-cursor-target` hook for guided tours and demo playbacks. */
  readonly cursorTarget?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-cursor-target={cursorTarget}
      className={cn(
        "stg:group stg:flex stg:flex-col stg:items-center stg:gap-3 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-6 stg:text-center",
        "stg:transition-colors stg:hover:border-primary stg:hover:bg-accent",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
      )}
    >
      <span className="stg:text-muted-foreground stg:transition-colors stg:group-hover:text-foreground">
        {icon}
      </span>
      <div className="stg:flex stg:flex-col stg:gap-1">
        <span className="stg:text-sm stg:font-medium stg:text-foreground">{title}</span>
        <span className="stg:text-xs stg:text-muted-foreground">{description}</span>
      </div>
      {badge && (
        <span className="stg:rounded-full stg:bg-muted stg:px-2 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-muted-foreground">
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
      className="stg:size-8"
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
      className="stg:size-8"
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
      className="stg:size-8"
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
      className="stg:size-4"
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
