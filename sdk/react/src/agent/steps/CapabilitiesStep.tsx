"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { McpServerPicker } from "../../mcp-server/McpServerPicker.js";
import { SkillPicker } from "../../skill/SkillPicker.js";
import type { AgentWizardData, EnvVarEntry } from "./types.js";

/** Props for {@link CapabilitiesStep}. */
export interface CapabilitiesStepProps {
  readonly org: string;
  readonly data: AgentWizardData;
  readonly updateData: (partial: Partial<AgentWizardData>) => void;
}

/**
 * Wizard step 2: Agent capabilities.
 *
 * All sections are optional and start collapsed. The user expands
 * sections to add MCP servers, skills, and environment variables.
 * No validation gate — the user can proceed with zero capabilities.
 */
export function CapabilitiesStep({
  org,
  data,
  updateData,
}: CapabilitiesStepProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (data.mcpServerUsages.length > 0) initial.add("mcp");
    if (data.skillRefs.length > 0) initial.add("skills");
    if (data.env.length > 0) initial.add("env");
    return initial;
  });

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);

  const handleMcpChange = useCallback(
    (usages: McpServerUsageInput[]) => {
      updateData({ mcpServerUsages: usages });
    },
    [updateData],
  );

  const handleSkillsChange = useCallback(
    (refs: ResourceRef[]) => {
      updateData({ skillRefs: refs });
    },
    [updateData],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-6">
      <div>
        <h2 className="stg:text-lg stg:font-semibold stg:text-foreground">
          Capabilities
        </h2>
        <p className="stg:mt-1 stg:text-sm stg:text-muted-foreground">
          Configure what tools, skills, and secrets this agent can use.
          All sections are optional.
        </p>
      </div>

      {/* MCP Servers */}
      <CollapsibleSection
        id="mcp"
        title="MCP Servers"
        subtitle="Tools and integrations the agent can call"
        count={data.mcpServerUsages.length}
        expanded={expandedSections.has("mcp")}
        onToggle={toggleSection}
      >
        <McpServerPicker
          org={org}
          scope="all"
          value={data.mcpServerUsages}
          onChange={handleMcpChange}
        />
      </CollapsibleSection>

      {/* Skills */}
      <CollapsibleSection
        id="skills"
        title="Skills"
        subtitle="Knowledge and capabilities to attach"
        count={data.skillRefs.length}
        expanded={expandedSections.has("skills")}
        onToggle={toggleSection}
      >
        <SkillPicker
          org={org}
          scope="all"
          value={data.skillRefs}
          onChange={handleSkillsChange}
        />
      </CollapsibleSection>

      {/* Environment Variables */}
      <CollapsibleSection
        id="env"
        title="Environment Variables"
        subtitle="Secrets and config the agent declares"
        count={data.env.length}
        expanded={expandedSections.has("env")}
        onToggle={toggleSection}
      >
        <EnvVarEditor
          entries={data.env}
          onChange={(env) => updateData({ env })}
        />
      </CollapsibleSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleSection
// ---------------------------------------------------------------------------

function CollapsibleSection({
  id,
  title,
  subtitle,
  count,
  expanded,
  onToggle,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly count: number;
  readonly expanded: boolean;
  readonly onToggle: (id: string) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
        aria-controls={`stgm-wizard-section-${id}`}
        className={cn(
          "stg:flex stg:w-full stg:items-center stg:justify-between stg:px-4 stg:py-3 stg:text-left stg:transition-colors",
          "stg:hover:bg-accent-hover",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
        )}
      >
        <div>
          <span className="stg:text-sm stg:font-medium stg:text-foreground">{title}</span>
          {count > 0 && (
            <span className="stg:ml-2 stg:inline-flex stg:items-center stg:justify-center stg:rounded-full stg:bg-primary stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-primary-foreground">
              {count}
            </span>
          )}
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">{subtitle}</p>
        </div>
        <ChevronIcon
          className={cn(
            "stg:size-4 stg:shrink-0 stg:text-muted-foreground stg:transition-transform",
            expanded && "stg:rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div
          id={`stgm-wizard-section-${id}`}
          className="stg:border-t stg:border-border stg:px-4 stg:py-4"
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EnvVarEditor — key-value editor for env var declarations
// ---------------------------------------------------------------------------

function EnvVarEditor({
  entries,
  onChange,
}: {
  readonly entries: readonly EnvVarEntry[];
  readonly onChange: (entries: EnvVarEntry[]) => void;
}) {
  const addEntry = useCallback(() => {
    onChange([
      ...entries,
      { key: "", description: "", isSecret: true, optional: false },
    ]);
  }, [entries, onChange]);

  const updateEntry = useCallback(
    (index: number, partial: Partial<EnvVarEntry>) => {
      const updated = entries.map((entry, i) =>
        i === index ? { ...entry, ...partial } : entry,
      );
      onChange(updated);
    },
    [entries, onChange],
  );

  const removeEntry = useCallback(
    (index: number) => {
      onChange(entries.filter((_, i) => i !== index));
    },
    [entries, onChange],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-3">
      {entries.map((entry, index) => (
        <div
          key={index}
          className="stg:flex stg:flex-col stg:gap-2 stg:rounded-md stg:border stg:border-border stg:p-3"
        >
          <div className="stg:flex stg:items-start stg:gap-2">
            <div className="stg:flex-1 stg:space-y-1.5">
              <input
                type="text"
                value={entry.key}
                onChange={(e) =>
                  updateEntry(index, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })
                }
                placeholder="VARIABLE_NAME"
                aria-label={`Environment variable name ${index + 1}`}
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-2.5 stg:py-1.5 stg:font-mono stg:text-xs stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                )}
              />
              <input
                type="text"
                value={entry.description}
                onChange={(e) => updateEntry(index, { description: e.target.value })}
                placeholder="Description (optional)"
                aria-label={`Description for ${entry.key || `variable ${index + 1}`}`}
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-input-bg stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                )}
              />
            </div>
            <button
              type="button"
              onClick={() => removeEntry(index)}
              aria-label={`Remove ${entry.key || "variable"}`}
              className={cn(
                "stg:mt-1 stg:rounded stg:p-1 stg:text-muted-foreground stg:transition-colors",
                "stg:hover:bg-accent-hover stg:hover:text-destructive",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              )}
            >
              <RemoveIcon className="stg:size-3.5" />
            </button>
          </div>

          <div className="stg:flex stg:items-center stg:gap-4">
            <label className="stg:flex stg:items-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground">
              <input
                type="checkbox"
                checked={entry.isSecret}
                onChange={(e) => updateEntry(index, { isSecret: e.target.checked })}
                className="stg:size-3.5 stg:rounded stg:border-input"
              />
              Secret
            </label>
            <label className="stg:flex stg:items-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground">
              <input
                type="checkbox"
                checked={entry.optional}
                onChange={(e) => updateEntry(index, { optional: e.target.checked })}
                className="stg:size-3.5 stg:rounded stg:border-input"
              />
              Optional
            </label>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addEntry}
        className={cn(
          "stg:inline-flex stg:w-fit stg:items-center stg:gap-1.5 stg:rounded-md stg:border stg:border-dashed stg:border-input stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-muted-foreground stg:transition-colors",
          "stg:hover:border-border stg:hover:text-foreground stg:hover:bg-accent-hover",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        )}
      >
        <PlusIcon className="stg:size-3" />
        Add variable
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function PlusIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function RemoveIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
