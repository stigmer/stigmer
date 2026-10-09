"use client";

/**
 * The agent's shared vaults: the team keys its conversations use after
 * each person's own My vault, for people who may use them. An editor of
 * the agent names vaults they may use; runs with no person (a schedule, a
 * share link, a channel) never use them, and a conversation that lists
 * its own vaults uses those instead. A My vault is never offered.
 */
import { useState } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceRef } from "@stigmer/sdk";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { Section } from "../resource-detail/Section.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";
import { VaultPicker } from "../vault/VaultPicker.js";
import { PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS } from "../vault/styles.js";

/** Props for {@link AgentVaultsSection}. */
export interface AgentVaultsSectionProps {
  /** The agent's organization (vaults are listed from it). */
  readonly org: string;
  /** The vaults the agent names, as stored. */
  readonly vaults: readonly ApiResourceReference[];
  /** Whether the viewer may edit the agent. */
  readonly editable?: boolean;
  /** `true` while a save is in flight. */
  readonly isSaving?: boolean;
  /** The last failed save's message for this section. */
  readonly error?: string;
  /** Persist the new list; resolves `true` on success. */
  readonly onSave?: (refs: ResourceRef[]) => Promise<boolean>;
}

/** The agent's vaults, read-only or edited through the vault picker. */
export function AgentVaultsSection({
  org,
  vaults,
  editable = false,
  isSaving = false,
  error,
  onSave,
}: AgentVaultsSectionProps) {
  const slugForOrg = useOrgSlugForId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ResourceRef[]>([]);

  const startEdit = () => {
    setDraft(vaults.map((ref) => ({ org: ref.org || org, slug: ref.slug })));
    setEditing(true);
  };

  return (
    <Section
      title="Vaults"
      count={vaults.length}
      onEdit={editable && onSave ? () => (editing ? setEditing(false) : startEdit()) : undefined}
    >
      <div className="stg:space-y-2 stg:p-3">
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          Team keys this agent&apos;s conversations use after each person&apos;s
          own My vault, for the people who may use them.
        </p>
        {editing ? (
          <>
            <VaultPicker org={org} value={draft} onChange={setDraft} disabled={isSaving} />
            {error && (
              <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
                {error}
              </p>
            )}
            <div className="stg:flex stg:items-center stg:gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={async () => {
                  if (await onSave?.(draft)) setEditing(false);
                }}
                className={PRIMARY_BUTTON_CLASS}
              >
                Save
              </button>
              <button type="button" onClick={() => setEditing(false)} className={QUIET_BUTTON_CLASS}>
                Cancel
              </button>
            </div>
          </>
        ) : vaults.length === 0 ? (
          <p className="stg:text-xs stg:text-muted-foreground">No vaults.</p>
        ) : (
          <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-0.5")}>
            {vaults.map((ref, i) => (
              <li key={`${ref.org}/${ref.slug}-${i}`} className="stg:font-mono stg:text-xs stg:text-foreground">
                {ref.org && ref.org !== org ? `${slugForOrg(ref.org)}/${ref.slug}` : ref.slug}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
