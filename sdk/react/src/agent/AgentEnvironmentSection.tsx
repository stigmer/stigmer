"use client";

/**
 * The "Environment" section of the agent detail view: the Environment a
 * conversation on the agent runs in when the conversation names none (its
 * sandbox's packages and network).
 *
 * The read view names it, or says what applies without one: the
 * organization's default when it has one ("None · uses the organization's
 * default, base-tools"), else none. The editor is the shared
 * `EnvironmentPicker`, whose first row is that inherited value; choosing it
 * clears the agent's own. A save writes `spec.environment_ref` alone
 * through the host's `onSave`, and the server's refusal (an Environment the
 * writer may not view, one that is gone) shows under the section, as the
 * other agent edits show theirs. On a server whose conversations run in no
 * sandbox it starts, the section says so beneath.
 *
 * Pinned by `__tests__/AgentEnvironmentSection.test.tsx`.
 */

import { useCallback, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { ResourceRef } from "@stigmer/client";
import { Section } from "../resource-detail/Section.js";
import { EnvironmentPicker } from "../environment/EnvironmentPicker.js";
import { ENVIRONMENTS_NOT_APPLYING_COPY, inheritedRowLabel } from "../environment/copy.js";
import { resolveEnvironmentChoice } from "../environment/resolve.js";
import { environmentName, useEnvironmentList } from "../environment/useEnvironmentList.js";
import { useOrganization } from "../organization/useOrganization.js";
import { useEnvironmentAvailability } from "../server-info.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link AgentEnvironmentSection}. */
export interface AgentEnvironmentSectionProps {
  readonly spec: AgentSpec | undefined;
  /** The agent's organization id: its Environments are listed, and its default read. */
  readonly agentOrg: string;
  readonly editable: boolean;
  readonly isSaving: boolean;
  /** The server's message for the last failed save of this section. */
  readonly error?: string;
  /** Persist `spec.environment_ref` (`undefined` clears it); resolves `true` on success. */
  readonly onSave: (environmentRef: ResourceRef | undefined) => Promise<boolean>;
  /** Called when editing starts, so a stale error from an earlier attempt clears. */
  readonly onEditStart?: () => void;
}

/**
 * Shows an agent's default Environment, and edits it when `editable`.
 *
 * @example
 * ```tsx
 * <AgentEnvironmentSection
 *   spec={agent.spec}
 *   agentOrg={agent.metadata.org}
 *   editable
 *   isSaving={isUpdating}
 *   onSave={(environmentRef) => saveFields("environmentRef", { environmentRef })}
 * />
 * ```
 */
export function AgentEnvironmentSection({
  spec,
  agentOrg,
  editable,
  isSaving,
  error,
  onSave,
  onEditStart,
}: AgentEnvironmentSectionProps) {
  const [draft, setDraft] = useState<ResourceRef | undefined>(undefined);
  const [isEditing, setIsEditing] = useState(false);
  const own = spec?.environmentRef;
  const hasOwn = own !== undefined && (own.slug !== "" || own.id !== "");
  const show = editable || hasOwn;
  const { organization } = useOrganization(show && agentOrg !== "" ? agentOrg : null);
  const { environments } = useEnvironmentList(show && agentOrg !== "" ? agentOrg : null);
  const availability = useEnvironmentAvailability();

  const nameOf = useCallback(
    (ref: { readonly slug: string }) => {
      const found = environments.find((environment) => environment.metadata?.slug === ref.slug);
      return found ? environmentName(found) : ref.slug;
    },
    [environments],
  );

  if (!show) return null;

  const inherited = resolveEnvironmentChoice({ organization: organization?.spec?.preferences?.defaultEnvironmentRef });

  const startEdit = () => {
    onEditStart?.();
    setDraft(hasOwn ? { org: own.org || agentOrg, slug: own.slug } : undefined);
    setIsEditing(true);
  };

  return (
    <Section title="Environment" onEdit={editable && !isEditing ? startEdit : undefined}>
      {isEditing ? (
        <div className="stg:flex stg:flex-col stg:gap-2 stg:p-3">
          <EnvironmentPicker
            org={agentOrg}
            value={draft}
            onChange={setDraft}
            defaultLabel={inheritedRowLabel(inherited, nameOf)}
            disabled={isSaving}
          />
          <p className="stg:text-2xs stg:text-muted-foreground">
            The packages and network a conversation on this agent gets when the conversation names no environment.
          </p>
          <div className="stg:flex stg:items-center stg:justify-end stg:gap-1.5">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              disabled={isSaving}
              className={cn(
                "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent stg:hover:text-accent-foreground",
                "stg:disabled:opacity-50",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                const ok = await onSave(draft);
                if (ok) setIsEditing(false);
              }}
              disabled={isSaving}
              className={cn(
                "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              )}
            >
              {isSaving && <SpinnerIcon size={14} />}
              Save
            </button>
          </div>
          {error && (
            <p className="stg:text-xs stg:text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="stg:flex stg:flex-col stg:gap-1 stg:p-3 stg:text-sm">
          <p className="stg:text-foreground">
            {hasOwn
              ? nameOf(own)
              : inherited.kind === "chosen"
                ? `None · uses the organization's default, ${nameOf(inherited.environment)}`
                : "None"}
          </p>
          {availability?.applies === false && (
            <p className="stg:text-xs stg:text-muted-foreground">{ENVIRONMENTS_NOT_APPLYING_COPY["not-on-server"]}</p>
          )}
        </div>
      )}
    </Section>
  );
}
