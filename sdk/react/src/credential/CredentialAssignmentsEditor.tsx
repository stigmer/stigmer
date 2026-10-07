"use client";

/**
 * Where the values come from for runs nobody is behind: a schedule, a
 * share link, a channel, a platform client. Such a run takes only what
 * its surface assigns, so this editor lists what the agent's runs need,
 * per declarer (the agent's own keys, each MCP server's, each repository
 * host's), and lets the surface's owner give each one a source:
 *
 * - a field of an organization credential they may use (the list returns
 *   only those), the field named like the key by default;
 * - on a schedule, a field of one of their own credentials (a person's
 *   credential is accepted only on a schedule its owner created);
 * - a plain value typed here, offered only for a value not declared
 *   secret, since a literal is stored as written.
 *
 * The assignment's writer is the server's to stamp: every assignment this
 * editor emits carries no `writer`, including the ones it keeps unchanged,
 * so a client can never claim someone else wrote one. Assignments for
 * requirements the agent no longer declares are listed apart and kept
 * until removed, never dropped silently.
 *
 * Pinned by `__tests__/CredentialAssignmentsEditor.test.tsx`.
 */
import { useCallback, useId, useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { CredentialAssignmentInput } from "@stigmer/sdk";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { INPUT_CLASSES } from "../internal/form-primitives.js";
import {
  credentialDisplayName,
  credentialFieldNames,
  fromTargetInput,
  targetRefKey,
  targetWords,
  toTargetInput,
} from "./model.js";
import {
  assignmentFills,
  assignmentReadiness,
  requirementKey,
  type Requirement,
} from "./requirements.js";
import { useCredentialList } from "./useCredentialList.js";
import { useRunRequirements } from "./useRunRequirements.js";

/** Props for {@link CredentialAssignmentsEditor}. */
export interface CredentialAssignmentsEditorProps {
  /** The surface's organization, whose credentials are offered (an id; a slug is also accepted). */
  readonly org: string;
  /** The agent the surface's runs use; `null` while it loads or before one is picked. */
  readonly agent: Agent | null;
  /** The surface's assignments. */
  readonly value: readonly CredentialAssignmentInput[];
  /** Called with the new assignments, none of which carries a writer. */
  readonly onChange: (next: CredentialAssignmentInput[]) => void;
  /**
   * Offer the caller's own credentials too. Only a schedule accepts a
   * person's credential, and only from the person who created it.
   * @default false
   */
  readonly allowOwnCredentials?: boolean;
  /** Repository URLs the surface's runs clone; each host's token is offered. */
  readonly repositoryUrls?: readonly string[];
  /** Disable every control (while a save is in flight). */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The assignments as a write sends them: the writer left out, always. The
 * server stamps it from the caller for a new assignment and carries it
 * from the stored row for a kept one.
 */
export function assignmentsForWrite(
  assignments: readonly CredentialAssignmentInput[],
): CredentialAssignmentInput[] {
  return assignments.flatMap((assignment) => {
    const declarer = fromTargetInput(assignment.requirement.declarer);
    if (declarer === undefined) return [];
    return [{
    requirement: {
      declarer: toTargetInput(declarer),
      ...(assignment.requirement.key ? { key: assignment.requirement.key } : {}),
    },
    ...(assignment.credential
      ? {
          credential: {
            credential: { org: assignment.credential.credential.org, slug: assignment.credential.credential.slug },
            ...(assignment.credential.field ? { field: assignment.credential.field } : {}),
          },
        }
      : {}),
    ...(assignment.literal !== undefined && !assignment.credential ? { literal: assignment.literal } : {}),
    }];
  });
}

const NOT_ASSIGNED = "";
const LITERAL = "literal";

/**
 * Edits a surface's credential assignments against its agent's
 * requirements.
 *
 * @example
 * ```tsx
 * <CredentialAssignmentsEditor
 *   org={share.metadata.org}
 *   agent={agent}
 *   value={draft.credentials}
 *   onChange={(credentials) => setDraft({ ...draft, credentials })}
 * />
 * ```
 */
export function CredentialAssignmentsEditor({
  org,
  agent,
  value,
  onChange,
  allowOwnCredentials = false,
  repositoryUrls,
  disabled = false,
  className,
}: CredentialAssignmentsEditorProps) {
  const { requirements, isLoading: requirementsLoading } = useRunRequirements(agent, { repositoryUrls });
  const list = useCredentialList(org || null);

  const offered = useMemo(
    () => (allowOwnCredentials ? [...list.organization, ...list.mine] : [...list.organization]),
    [allowOwnCredentials, list.organization, list.mine],
  );

  const groups = useMemo(() => {
    const byDeclarer = new Map<string, Requirement[]>();
    for (const requirement of requirements) {
      const key = targetRefKey(requirement.declarer.target);
      const group = byDeclarer.get(key) ?? [];
      group.push(requirement);
      byDeclarer.set(key, group);
    }
    return [...byDeclarer.values()];
  }, [requirements]);

  const orphans = useMemo(
    () =>
      value.filter(
        (assignment) => !requirements.some((requirement) => assignmentFills(assignment, requirement)),
      ),
    [value, requirements],
  );

  const setAssignment = useCallback(
    (requirement: Requirement, next: CredentialAssignmentInput | null) => {
      const others = value.filter((assignment) => !assignmentFills(assignment, requirement));
      onChange(assignmentsForWrite(next ? [...others, next] : others));
    },
    [value, onChange],
  );

  const removeOrphan = useCallback(
    (orphan: CredentialAssignmentInput) => {
      onChange(assignmentsForWrite(value.filter((assignment) => assignment !== orphan)));
    },
    [value, onChange],
  );

  const { unassigned } = useMemo(() => assignmentReadiness(requirements, value), [requirements, value]);

  if (agent === null) {
    return (
      <p className={cn("stg:text-xs stg:text-muted-foreground", className)}>
        Pick an agent to see the values its runs need.
      </p>
    );
  }

  if (requirementsLoading) {
    return <p className={cn("stg:text-xs stg:text-muted-foreground", className)}>Reading what this agent needs…</p>;
  }

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-3", className)}>
      {groups.length === 0 ? (
        <p className="stg:text-xs stg:text-muted-foreground">
          This agent needs no keys: its runs start with nothing assigned.
        </p>
      ) : (
        <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-3")} aria-label="Values the agent needs">
          {groups.map((group) => {
            const declarer = group[0]!.declarer;
            return (
              <li key={targetRefKey(declarer.target)} className="stg:flex stg:flex-col stg:gap-1.5">
                <p className="stg:text-xs stg:font-medium stg:text-foreground">
                  {targetWords(declarer.target, declarer.name)}
                </p>
                <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-1.5")}>
                  {group.map((requirement) => (
                    <AssignmentRow
                      key={requirementKey(requirement)}
                      requirement={requirement}
                      assignment={value.find((assignment) => assignmentFills(assignment, requirement))}
                      credentials={offered}
                      isMine={(credential) => list.mine.includes(credential)}
                      onChange={(next) => setAssignment(requirement, next)}
                      disabled={disabled}
                    />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {offered.length === 0 && groups.length > 0 && !list.isLoading && (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          No organization keys are available to you yet. An admin adds them in
          Settings, Accounts and keys, and lets you use them.
        </p>
      )}

      {orphans.length > 0 && (
        <div className="stg:flex stg:flex-col stg:gap-1">
          <p className="stg:text-xs stg:font-medium stg:text-foreground">No longer needed</p>
          <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-1")} aria-label="Assignments the agent no longer needs">
            {orphans.map((orphan, index) => (
              <li key={index} className="stg:flex stg:items-center stg:justify-between stg:gap-2 stg:text-xs">
                <span className="stg:font-mono stg:text-muted-foreground">{orphanWords(orphan)}</span>
                <button
                  type="button"
                  onClick={() => removeOrphan(orphan)}
                  disabled={disabled}
                  className="stg:text-muted-foreground stg:hover:text-destructive"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unassigned.length > 0 && (
        <p className="stg:text-xs stg:text-warning" role="status">
          Runs will not start until {unassigned.length === 1 ? "this value is" : "these values are"} assigned:{" "}
          <span className="stg:font-mono">{unassigned.map((requirement) => requirement.key).join(", ")}</span>.
        </p>
      )}
    </div>
  );
}

function orphanWords(assignment: CredentialAssignmentInput): string {
  const declarer = fromTargetInput(assignment.requirement.declarer);
  const who = declarer ? targetWords(declarer) : "unknown";
  return `${assignment.requirement.key ?? ""} (${who})`;
}

function credentialOptionValue(credential: Credential): string {
  return `cred:${credential.metadata?.org ?? ""}/${credential.metadata?.slug ?? ""}`;
}

function AssignmentRow({
  requirement,
  assignment,
  credentials,
  isMine,
  onChange,
  disabled,
}: {
  readonly requirement: Requirement;
  readonly assignment: CredentialAssignmentInput | undefined;
  readonly credentials: readonly Credential[];
  readonly isMine: (credential: Credential) => boolean;
  readonly onChange: (next: CredentialAssignmentInput | null) => void;
  readonly disabled: boolean;
}) {
  const selectId = useId();
  const fieldId = useId();
  const literalId = useId();

  const declarer = toTargetInput(requirement.declarer.target);
  const assignedRef = assignment?.credential?.credential;
  const selectedCredential = assignedRef
    ? credentials.find(
        (credential) =>
          credential.metadata?.slug === assignedRef.slug && credential.metadata?.org === assignedRef.org,
      )
    : undefined;

  const source = assignment?.credential
    ? `cred:${assignedRef?.org ?? ""}/${assignedRef?.slug ?? ""}`
    : assignment?.literal !== undefined
      ? LITERAL
      : NOT_ASSIGNED;

  const fieldName = assignment?.credential?.field || requirement.key;

  const pickCredential = (credential: Credential) => {
    const fields = credentialFieldNames(credential);
    const field = fields.includes(requirement.key) || fields.length === 0 ? "" : fields[0]!;
    onChange({
      requirement: { declarer, key: requirement.key },
      credential: {
        credential: { org: credential.metadata?.org ?? "", slug: credential.metadata?.slug ?? "" },
        ...(field ? { field } : {}),
      },
    });
  };

  const handleSource = (next: string) => {
    if (next === NOT_ASSIGNED) {
      onChange(null);
      return;
    }
    if (next === LITERAL) {
      onChange({ requirement: { declarer, key: requirement.key }, literal: "" });
      return;
    }
    const credential = credentials.find((c) => credentialOptionValue(c) === next);
    if (credential) pickCredential(credential);
  };

  const organization = credentials.filter((credential) => !isMine(credential));
  const mine = credentials.filter(isMine);
  // A credential assigned earlier that the caller can no longer see stays
  // selectable, so the row says what is assigned rather than going blank.
  const unseen = assignedRef && !selectedCredential ? source : undefined;
  const fields = selectedCredential ? credentialFieldNames(selectedCredential) : [];

  return (
    <li className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
      <label htmlFor={selectId} className="stg:w-44 stg:shrink-0 stg:truncate stg:font-mono stg:text-xs stg:text-foreground">
        {requirement.key}
        {requirement.optional && <span className="stg:ml-1 stg:font-sans stg:text-[0.6rem] stg:text-muted-foreground">optional</span>}
      </label>
      <select
        id={selectId}
        value={source}
        onChange={(e) => handleSource(e.target.value)}
        disabled={disabled}
        className={cn(INPUT_CLASSES, "stg:w-auto stg:min-w-40 stg:flex-1")}
      >
        <option value={NOT_ASSIGNED}>Not assigned</option>
        {organization.length > 0 && (
          <optgroup label="Organization keys">
            {organization.map((credential) => (
              <option key={credentialOptionValue(credential)} value={credentialOptionValue(credential)}>
                {credentialDisplayName(credential)}
              </option>
            ))}
          </optgroup>
        )}
        {mine.length > 0 && (
          <optgroup label="Your keys">
            {mine.map((credential) => (
              <option key={credentialOptionValue(credential)} value={credentialOptionValue(credential)}>
                {credentialDisplayName(credential)}
              </option>
            ))}
          </optgroup>
        )}
        {unseen && <option value={unseen}>{assignedRef?.slug} (not available to you)</option>}
        {!requirement.isSecret && <option value={LITERAL}>A plain value…</option>}
      </select>

      {selectedCredential && fields.length > 0 && (
        <>
          <label htmlFor={fieldId} className="stg:sr-only">
            Field of {credentialDisplayName(selectedCredential)} for {requirement.key}
          </label>
          <select
            id={fieldId}
            value={fields.includes(fieldName) ? fieldName : ""}
            onChange={(e) => {
              const field = e.target.value === requirement.key ? "" : e.target.value;
              onChange({
                requirement: { declarer, key: requirement.key },
                credential: {
                  credential: { org: assignedRef?.org ?? "", slug: assignedRef?.slug ?? "" },
                  ...(field ? { field } : {}),
                },
              });
            }}
            disabled={disabled}
            className={cn(INPUT_CLASSES, "stg:w-auto stg:font-mono")}
          >
            {!fields.includes(fieldName) && <option value="">{fieldName} (missing)</option>}
            {fields.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
        </>
      )}

      {source === LITERAL && (
        <>
          <label htmlFor={literalId} className="stg:sr-only">
            Value for {requirement.key}
          </label>
          <input
            id={literalId}
            type="text"
            value={assignment?.literal ?? ""}
            onChange={(e) =>
              onChange({ requirement: { declarer, key: requirement.key }, literal: e.target.value })
            }
            disabled={disabled}
            placeholder="Plain value"
            className={cn(INPUT_CLASSES, "stg:w-auto stg:min-w-40 stg:flex-1 stg:font-mono")}
          />
        </>
      )}
    </li>
  );
}
