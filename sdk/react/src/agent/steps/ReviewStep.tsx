"use client";

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import { buildAgentProto, getUserMessage, serializeManifest } from "@stigmer/sdk";
import type { AgentInput } from "@stigmer/sdk";
import type { AgentWizardData } from "./types.js";

/** Props for {@link ReviewStep}. */
export interface ReviewStepProps {
  readonly org: string;
  readonly data: AgentWizardData;
  readonly isCreating: boolean;
  readonly error: Error | null;
}

/**
 * Wizard step 3: Review and create.
 *
 * Shows a summary card with key configuration details and a full
 * YAML preview of the agent that will be created. The "Create" action
 * is in the WizardNav footer, not in this component.
 */
export function ReviewStep({
  org,
  data,
  isCreating,
  error,
}: ReviewStepProps) {
  const agentInput = useMemo(() => buildAgentInput(org, data), [org, data]);
  const yamlPreview = useMemo(
    () => serializeManifest(buildAgentProto(agentInput)),
    [agentInput],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-6">
      <div>
        <h2 className="stg:text-lg stg:font-semibold stg:text-foreground">
          Review & Create
        </h2>
        <p className="stg:mt-1 stg:text-sm stg:text-muted-foreground">
          Review the agent configuration below, then create it.
        </p>
      </div>

      {/* Summary card */}
      <div className="stg:rounded-lg stg:border stg:border-border stg:p-4">
        <dl className="stg:grid stg:gap-x-6 stg:gap-y-3 stg:text-sm stg:sm:grid-cols-2">
          <SummaryItem label="Name" value={data.name} />
          <SummaryItem label="Slug" value={data.slug} mono />
          <SummaryItem label="Organization" value={org} mono />
          <SummaryItem
            label="Visibility"
            value={data.visibility === "public" ? "Public" : "Private"}
          />
          {data.description && (
            <SummaryItem
              label="Description"
              value={data.description}
              className="stg:sm:col-span-2"
            />
          )}
          {data.instructions && (
            <SummaryItem
              label="Instructions"
              value={truncate(data.instructions, 120)}
              className="stg:sm:col-span-2"
            />
          )}
          <SummaryItem
            label="MCP Servers"
            value={
              data.mcpServerUsages.length > 0
                ? `${data.mcpServerUsages.length} configured`
                : "None"
            }
          />
          <SummaryItem
            label="Skills"
            value={
              data.skillRefs.length > 0
                ? `${data.skillRefs.length} attached`
                : "None"
            }
          />
          {data.env.length > 0 && (
            <SummaryItem
              label="Env Variables"
              value={`${data.env.length} declared`}
            />
          )}
        </dl>
      </div>

      {/* YAML preview */}
      <div className="stg:space-y-2">
        <h3 className="stg:text-xs stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
          YAML Preview
        </h3>
        <div className="stg:max-h-80 stg:overflow-auto stg:rounded-lg stg:border stg:border-border stg:bg-muted-faint">
          <pre className="stg:p-4 stg:font-mono stg:text-xs stg:leading-relaxed stg:text-foreground">
            {yamlPreview}
          </pre>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="stg:rounded-md stg:border stg:border-destructive stg:bg-muted-faint stg:px-4 stg:py-3" role="alert">
          <p className="stg:text-sm stg:font-medium stg:text-destructive">
            Failed to create agent
          </p>
          <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
            {getUserMessage(error)}
          </p>
        </div>
      )}

      {/* Creating state */}
      {isCreating && (
        <p className="stg:text-sm stg:text-muted-foreground" aria-live="polite">
          Creating agent…
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary item
// ---------------------------------------------------------------------------

function SummaryItem({
  label,
  value,
  mono,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly className?: string;
}) {
  return (
    <div className={className}>
      <dt className="stg:text-xs stg:text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "stg:mt-0.5 stg:text-sm stg:text-foreground",
          mono && "stg:font-mono",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

/**
 * Transforms wizard data into the SDK `AgentInput` shape for submission.
 * Exported for reuse by `AgentCreationWizard`.
 */
export function buildAgentInput(
  org: string,
  data: AgentWizardData,
): AgentInput {
  const input: AgentInput = {
    name: data.name.trim(),
    org,
    ...(data.slug && { slug: data.slug }),
    ...(data.description && { description: data.description.trim() }),
    ...(data.iconUrl && { iconUrl: data.iconUrl.trim() }),
    ...(data.instructions && { instructions: data.instructions }),
  };

  if (data.mcpServerUsages.length > 0) {
    input.mcpServerUsages = data.mcpServerUsages;
  }

  if (data.skillRefs.length > 0) {
    input.skillRefs = data.skillRefs;
  }

  if (data.env.length > 0) {
    const env: Record<string, { isSecret?: boolean; description?: string; optional?: boolean }> = {};
    for (const entry of data.env) {
      if (!entry.key) continue;
      env[entry.key] = {
        ...(entry.isSecret && { isSecret: true }),
        ...(entry.description && { description: entry.description }),
        ...(entry.optional && { optional: true }),
      };
    }
    if (Object.keys(env).length > 0) {
      input.env = env;
    }
  }

  return input;
}
