"use client";

// The agent page's Subagents section: the saved agents this agent may hand
// work to (`AgentSpec.subagents`), each a reference the server pins to one
// version of the listed agent when this agent is saved. A row reads the
// listed agent to show what the pin is behind: when the agent has moved on
// since (its `status.versionHash` differs from the pin), the row says a newer
// version exists and offers to update that one pin. Every edit is one save
// that sends the whole list back: the other references keep their versions,
// so their pins hold; the updated one goes without a version, which the
// server pins to the listed agent's latest; an added one goes without a
// version too. The picker never offers the agent itself or an agent the list
// already holds, both of which the server refuses. Pinned by
// `__tests__/AgentDetailView.subagents.test.tsx`.

import { useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { isDeletedReference, type ResourceRef } from "@stigmer/client";
import { Section } from "../resource-detail/Section.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";
import { AgentPicker } from "./AgentPicker.js";
import { useAgent } from "./useAgent.js";
import { keptReference } from "../internal/kept-reference.js";

/** The most agents one agent may list; the server refuses more. */
export const MAX_SUBAGENTS = 20;

/** Characters of a version hash a row shows, as the Versions tab does. */
const SHORT_HASH = 8;

/** Props for {@link AgentSubagentsSection}. */
export interface AgentSubagentsSectionProps {
  /** `AgentSpec.subagents`, as stored: each reference carries its pin. */
  readonly refs: readonly ApiResourceReference[];
  /** Id of the agent's organization: a reference without an org is in it. */
  readonly agentOrg: string;
  /** The agent this page shows, never offered as its own subagent. */
  readonly self: { readonly org: string; readonly slug: string } | null;
  /** When `true`, the list can be edited and a pin updated. */
  readonly editable?: boolean;
  /** `true` while a save is in flight. */
  readonly isSaving?: boolean;
  /** The last failed save's message, when it was this list's. */
  readonly error?: string;
  /** Saves the whole list. Resolves to whether the save succeeded. */
  readonly onSave?: (refs: ResourceRef[]) => Promise<boolean>;
  /** Called when the list is opened for editing, to discard a stale error. */
  readonly onEditStart?: () => void;
  /** Called when a listed agent is selected. The host owns the route. */
  readonly onAgentClick?: (ref: { org: string; slug: string }) => void;
}

/** A stored reference sent back as it is: by its id, its pin included (internal/kept-reference.ts). */
function keptRef(ref: ApiResourceReference): ResourceRef {
  return keptReference(ref);
}

/**
 * Lists an agent's subagents with the version each is pinned to, and, when
 * editable, adds, removes and updates them.
 */
export function AgentSubagentsSection({
  refs,
  agentOrg,
  self,
  editable,
  isSaving,
  error,
  onSave,
  onEditStart,
  onAgentClick,
}: AgentSubagentsSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPicking, setIsPicking] = useState(false);

  const toggleEditing = useCallback(() => {
    setIsEditing((was) => {
      if (!was) onEditStart?.();
      return !was;
    });
    setIsPicking(false);
  }, [onEditStart]);

  const exclude = useMemo<ResourceRef[]>(
    () => [
      ...(self ? [{ org: self.org, slug: self.slug }] : []),
      ...refs.map((r) => ({ org: r.org || agentOrg, slug: r.slug })),
    ],
    [self, refs, agentOrg],
  );

  const handleAdd = useCallback(
    async (picked: ResourceRef | null) => {
      if (!picked || !onSave) return;
      const ok = await onSave([...refs.map(keptRef), { org: picked.org, slug: picked.slug }]);
      if (ok) setIsPicking(false);
    },
    [refs, onSave],
  );

  const handleRemove = useCallback(
    async (index: number) => {
      await onSave?.(refs.filter((_, i) => i !== index).map(keptRef));
    },
    [refs, onSave],
  );

  // An empty version asks the server for the listed agent's latest, and
  // only this reference goes without its pin.
  const handleUpdate = useCallback(
    async (index: number) => {
      await onSave?.(
        refs.map((r, i) => (i === index ? { ...keptReference(r), version: "" } : keptRef(r))),
      );
    },
    [refs, onSave],
  );

  const canAdd = refs.length < MAX_SUBAGENTS;

  return (
    <Section title="Subagents" count={refs.length} onEdit={editable ? toggleEditing : undefined}>
      <div className="stg:flex stg:flex-col">
        {refs.length > 0 ? (
          <ul className="stg:m-0 stg:flex stg:list-none stg:flex-col stg:divide-y stg:divide-border stg:p-0" aria-label="Subagents">
            {refs.map((ref, index) => (
              <SubagentRow
                key={isDeletedReference(ref) ? `deleted/${index}` : `${ref.org || agentOrg}/${ref.slug}`}
                reference={ref}
                agentOrg={agentOrg}
                canUpdate={!!editable && !!onSave}
                canRemove={!!editable && isEditing}
                isSaving={isSaving}
                onUpdate={() => handleUpdate(index)}
                onRemove={() => handleRemove(index)}
                onAgentClick={onAgentClick}
              />
            ))}
          </ul>
        ) : (
          <p className="stg:px-3 stg:py-3 stg:text-xs stg:text-muted-foreground stg:italic">
            No subagents. An agent hands work to the saved agents listed here.
          </p>
        )}

        {editable && isEditing && (
          <div className="stg:border-t stg:border-border stg:px-3 stg:py-2">
            {!canAdd ? (
              <p className="stg:text-xs stg:text-muted-foreground">
                An agent lists at most {MAX_SUBAGENTS} subagents.
              </p>
            ) : isPicking ? (
              <div className="stg:flex stg:flex-col stg:gap-2">
                <AgentPicker
                  org={agentOrg}
                  value={null}
                  onChange={(picked) => void handleAdd(picked)}
                  exclude={exclude}
                  disabled={isSaving}
                />
                <div>
                  <button
                    type="button"
                    onClick={() => setIsPicking(false)}
                    className={cn(
                      "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                      "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent",
                      "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                    )}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsPicking(true)}
                className={cn(
                  "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
                  "stg:border stg:border-dashed stg:border-border stg:text-muted-foreground",
                  "stg:hover:border-muted-foreground stg:hover:text-foreground stg:hover:bg-muted-subtle",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                  "stg:transition-colors",
                )}
              >
                <PlusIcon className="stg:size-3" />
                Add subagent
              </button>
            )}
          </div>
        )}

        {error && (
          <p className="stg:border-t stg:border-border stg:px-3 stg:py-2 stg:text-xs stg:text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// One listed agent
// ---------------------------------------------------------------------------

function SubagentRow({
  reference,
  agentOrg,
  canUpdate,
  canRemove,
  isSaving,
  onUpdate,
  onRemove,
  onAgentClick,
}: {
  readonly reference: ApiResourceReference;
  readonly agentOrg: string;
  readonly canUpdate: boolean;
  readonly canRemove: boolean;
  readonly isSaving?: boolean;
  readonly onUpdate: () => void;
  readonly onRemove: () => void;
  readonly onAgentClick?: (ref: { org: string; slug: string }) => void;
}) {
  const slugForOrg = useOrgSlugForId();
  const refOrg = reference.org || agentOrg;
  // A listed agent deleted since it was listed comes back with no slug: it
  // is named "deleted agent", read from nowhere and linked nowhere, and
  // keeps its remove action.
  const deleted = isDeletedReference(reference);
  const { agent, isLoading, error } = useAgent(
    deleted ? null : refOrg,
    deleted ? null : reference.slug,
  );

  const label = deleted
    ? "deleted agent"
    : reference.org && reference.org !== agentOrg
      ? `${slugForOrg(reference.org)}/${reference.slug}`
      : reference.slug;
  const pin = reference.version;
  const head = agent?.status?.versionHash ?? "";
  const isBehind = pin !== "" && head !== "" && head !== pin;
  const isMissing = !deleted && !isLoading && !error && agent === null;

  const name = (
    <span className="stg:flex stg:min-w-0 stg:items-center stg:gap-3">
      <AgentIcon className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
      <span className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">{label}</span>
    </span>
  );

  return (
    <li className="stg:flex stg:flex-col stg:gap-1 stg:px-3 stg:py-2">
      <div className="stg:flex stg:items-center stg:gap-3">
        {onAgentClick && !deleted ? (
          <button
            type="button"
            onClick={() => onAgentClick({ org: refOrg, slug: reference.slug })}
            className={cn(
              "stg:min-w-0 stg:rounded-md stg:text-left",
              "stg:hover:underline",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            {name}
          </button>
        ) : (
          name
        )}
        {pin && (
          <span
            className="stg:shrink-0 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-[10px] stg:text-muted-foreground"
          >
            <span className="stg:sr-only">Pinned version </span>
            {pin.slice(0, SHORT_HASH)}
          </span>
        )}
        <span className="stg:ml-auto stg:flex stg:shrink-0 stg:items-center stg:gap-2">
          {isBehind && (
            <>
              <span className="stg:text-xs stg:text-muted-foreground">A newer version exists</span>
              {canUpdate && (
                <button
                  type="button"
                  onClick={onUpdate}
                  disabled={isSaving}
                  aria-label={`Update ${label} to its latest version`}
                  className={cn(
                    "stg:rounded-md stg:px-2 stg:py-0.5 stg:text-xs stg:font-medium",
                    "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent",
                    "stg:disabled:opacity-50",
                    "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                  )}
                >
                  Update
                </button>
              )}
            </>
          )}
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              disabled={isSaving}
              aria-label={`Remove ${label}`}
              className={cn(
                "stg:inline-flex stg:size-6 stg:items-center stg:justify-center stg:rounded-md stg:text-muted-foreground",
                "stg:hover:bg-destructive-subtle stg:hover:text-destructive",
                "stg:disabled:opacity-50",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              )}
            >
              <XIcon className="stg:size-3.5" />
            </button>
          )}
        </span>
      </div>
      {agent?.spec?.description && (
        <p className="stg:pl-7 stg:text-xs stg:text-muted-foreground">{agent.spec.description}</p>
      )}
      {isMissing && (
        <p className="stg:pl-7 stg:text-xs stg:text-muted-foreground">
          This agent was not found, or you cannot see it.
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Icons: inline SVGs, as the agent page draws them
// ---------------------------------------------------------------------------

function AgentIcon({ className }: { readonly className?: string }) {
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
      <rect x="3" y="5" width="10" height="8" rx="1.5" />
      <path d="M6 9h.01M10 9h.01" strokeWidth="2" />
      <path d="M8 2v3" />
    </svg>
  );
}

function PlusIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function XIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}
