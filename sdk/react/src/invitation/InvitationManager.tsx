"use client";

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { cn } from "@stigmer/design-tokens";
import { UNSTYLED_FIELDSET } from "../internal/element-resets.js";
import {
  getUserMessage,
  iamRoleDisplayName,
} from "@stigmer/client";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { InvitationState } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/enum_pb";
import type { Invitation } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Plus } from "lucide-react";
import { useOrgInvitations } from "./useOrgInvitations.js";
import { useCreateInvitation } from "./useCreateInvitation.js";
import { useRevokeInvitation } from "./useRevokeInvitation.js";
import { InvitationCreatedAlert } from "./InvitationCreatedAlert.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { RoleSelector } from "../grant/RoleSelector.js";
import { useOwnerAssignment } from "../grant/useOwnerAssignment.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { LoadMoreFooter } from "../internal/LoadMoreFooter.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { Button } from "../button/Button.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { IconButton } from "../button/IconButton.js";
import { Card } from "../internal/surface/Card.js";
import { Tag } from "../internal/surface/Tag.js";
import { StatusBadge } from "../status/StatusBadge.js";
import type { StatusPhase } from "../resource-workbench/types.js";
import { List, ListRow } from "../internal/surface/List.js";
import { FIELD_LABEL_CLASSES, FieldError, Radio, TextInput } from "../internal/form/index.js";
import { useOrgDisplayName } from "../organization/useOrgDisplayName.js";
import { countWord } from "../internal/count-words.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link InvitationManager}. */
export interface InvitationManagerProps {
  /** Id of the organization whose invitations to manage (a slug is also accepted). */
  readonly org: string;
  /**
   * Build the full invite URL from a token.
   *
   * Platform builders override this when their invite route differs
   * from the default `/invite/<token>` path or runs on a different
   * domain.
   *
   * @default `${window.location.origin}/invite/${token}`
   */
  readonly buildInviteUrl?: (token: string) => string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

function defaultBuildInviteUrl(token: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/invite/${token}`;
  }
  return `/invite/${token}`;
}

type FlowState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "created"; inviteUrl: string; label: string };

/**
 * Self-contained panel for managing organization invitation links.
 *
 * Displays the organization's invitations, newest first, a page at a
 * time with "Load more" while the server holds more, with inline actions
 * (copy link, revoke) and a create form for generating new invite
 * links. Follows the same pattern as {@link OrgMembersPanel}: a
 * single embeddable component that handles the full management flow.
 *
 * The component composes three invitation hooks internally:
 * - {@link useOrgInvitations} for listing
 * - {@link useCreateInvitation} for creation
 * - {@link useRevokeInvitation} for revocation
 *
 * Each link's row says its role, who it admits and how often it was used
 * ("Member · Anyone with the link · 3 joined") and the day it expires;
 * revoking one says how many people already joined with it and that they
 * stay. A list that failed to load still offers "New invite link", since
 * making one does not need the list.
 *
 * The server serves an organization's invitations only to callers who
 * hold `can_grant_access` on it, so gate the mount on that permission,
 * as the console's `InvitationsSection` (`@stigmer/react-sdk/console`)
 * does with {@link PermissionGate}.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * // Links point at your own join page; omit buildInviteUrl to use this origin's /invite/<token>.
 * <InvitationManager org="acme" buildInviteUrl={(token) => `https://myapp.com/join/${token}`} />
 * ```
 */
export function InvitationManager({
  org,
  buildInviteUrl = defaultBuildInviteUrl,
  className,
}: InvitationManagerProps) {
  const {
    invitations: loaded,
    hasMore,
    loadMore,
    isLoadingMore,
    loadMoreError,
    isLoading,
    error,
    refetch,
  } = useOrgInvitations(org);
  const [flow, setFlow] = useState<FlowState>({ phase: "idle" });
  const startCreate = useCallback(() => setFlow({ phase: "creating" }), []);
  const { revoke } = useRevokeInvitation();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  // A refetch re-reads only the first page, so a link revoked from a page
  // loaded later would keep its stale copy: the revoke's own answer stands
  // in for that row until the list starts again.
  const [revoked, setRevoked] = useState<ReadonlyMap<string, Invitation>>(new Map());
  useEffect(() => setRevoked(new Map()), [org]);
  // The organization by its slug where the console knows it.
  const orgName = useOrgDisplayName();
  const invitations = useMemo(
    () => loaded.map((inv) => revoked.get(inv.metadata?.id ?? "") ?? inv),
    [loaded, revoked],
  );

  const activeCount = invitations.filter(
    (inv) => inv.status?.state === InvitationState.active,
  ).length;

  const handleCreated = useCallback(
    (invitation: Invitation) => {
      const token = invitation.status?.token ?? "";
      const label = invitation.spec?.label || invitation.metadata?.name || "Invite link";
      setFlow({ phase: "created", inviteUrl: buildInviteUrl(token), label });
      refetch();
    },
    [buildInviteUrl, refetch],
  );

  const askToRevoke = useCallback(
    async (invitationId: string, label: string, joined: number) => {
      const done = await confirm({
        title: `Revoke ${label}?`,
        description: revokeLine(joined, orgName),
        confirmLabel: "Revoke link",
        variant: "destructive",
        action: async () => {
          const invitation = await revoke(invitationId);
          setRevoked((previous) => new Map(previous).set(invitation.metadata?.id ?? "", invitation));
        },
        failureTitle: "Couldn't revoke the link.",
      });
      if (done) refetch();
    },
    [confirm, revoke, refetch, orgName],
  );

  if (isLoading) {
    return <SettingsSkeleton label="Loading invitations" rows={3} className={className} />;
  }

  return (
    <div className={cn("stg:space-y-3", className)}>
      {/* Header */}
      <div className="stg:flex stg:items-center stg:justify-between">
        <div className="stg:flex stg:items-center stg:gap-2">
          <span className="stg:text-sm stg:font-semibold stg:text-foreground">
            Invite Links
          </span>
          {/* The count covers the loaded pages only, so it is shown once
              they are all loaded rather than undercount. */}
          {activeCount > 0 && !hasMore && (
            <Tag>{activeCount} active</Tag>
          )}
        </div>
        {flow.phase === "idle" && (
          <Button onClick={startCreate} icon={<Plus className="stg:size-4" aria-hidden="true" />}>
            New invite link
          </Button>
        )}
      </div>

      {/* Created alert */}
      {flow.phase === "created" && (
        <InvitationCreatedAlert
          inviteUrl={flow.inviteUrl}
          label={flow.label}
          onDismiss={() => setFlow({ phase: "idle" })}
        />
      )}

      {/* Create form */}
      {flow.phase === "creating" && (
        <Card>
          <CreateInvitationForm
            org={org}
            onCreated={handleCreated}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </Card>
      )}

      {/* Invitation list: one that failed to load is said in its place,
          and New invite link above still makes a link. */}
      {error ? (
        <ErrorMessage error={error} title="Couldn't load the invite links." retry={refetch} />
      ) : invitations.length === 0 ? (
        <EmptyState
          variant="first-use"
          title="No invite links yet"
          description={`Make a link to bring people into ${orgName} with the role you choose.`}
          action={
            flow.phase === "idle"
              ? { label: "New invite link", onClick: startCreate, icon: <Plus className="stg:size-3.5" aria-hidden="true" /> }
              : undefined
          }
        />
      ) : (
        <List aria-label="Invitation links">
          {invitations.map((inv) => {
            const id = inv.metadata?.id ?? "";
            return (
              <InvitationRow
                key={id}
                invitation={inv}
                buildInviteUrl={buildInviteUrl}
                onRevoke={askToRevoke}
              />
            );
          })}
        </List>
      )}
      {!error && <LoadMoreFooter hasMore={hasMore} loadMore={loadMore} isLoadingMore={isLoadingMore} loadMoreError={loadMoreError} />}
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateInvitationForm (internal)
// ---------------------------------------------------------------------------

type ExpiryOption = "7" | "14" | "30";

const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
];

type RedemptionMode = "unlimited" | "single";

function CreateInvitationForm({
  org,
  onCreated,
  onCancel,
}: {
  org: string;
  onCreated: (invitation: Invitation) => void;
  onCancel: () => void;
}) {
  const { create, isCreating, error, clearError } = useCreateInvitation();
  // An invitation grants with its creator's authority: only an owner may
  // invite an owner, and the server refuses anyone else.
  const { unassignable } = useOwnerAssignment(org);
  const baseId = useId();

  const [label, setLabel] = useState("");
  const [role, setRole] = useState<IamRole>(IamRole.viewer);
  const [expiry, setExpiry] = useState<ExpiryOption>("30");
  const [redemptionMode, setRedemptionMode] = useState<RedemptionMode>("unlimited");

  const canSubmit = !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      clearError();
      try {
        const invitation = await create({
          name: label.trim() || `invite-${Date.now()}`,
          org,
          role,
          expiresAt: daysFromNow(Number(expiry)),
          maxRedemptions: redemptionMode === "single" ? 1 : 0,
          label: label.trim() || undefined,
        });
        onCreated(invitation);
      } catch {
        // error state is managed by useCreateInvitation
      }
    },
    [canSubmit, label, org, role, expiry, redemptionMode, create, clearError, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className="stg:space-y-3">
      {/* Label */}
      <div className="stg:space-y-1">
        <label
          htmlFor={`${baseId}-label`}
          className={FIELD_LABEL_CLASSES}
        >
          Label{" "}
          <span className="stg:font-normal stg:text-muted-foreground">(optional)</span>
        </label>
        <TextInput
          id={`${baseId}-label`}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Engineering team link"
          disabled={isCreating}
          autoFocus
          maxLength={200}
          className="stg:w-full"
        />
      </div>

      {/* Role */}
      <RoleSelector
        kind={ApiResourceKind.organization}
        selected={role}
        onSelect={(r) => setRole(r)}
        omitRoles={unassignable}
        disabled={isCreating}
      />

      {/* Expiry */}
      <fieldset className={cn(UNSTYLED_FIELDSET, "stg:space-y-1.5")}>
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">
          Expires in
        </legend>
        <div className="stg:flex stg:flex-wrap stg:gap-2">
          {/* Radio-group names are minted per mount: a hardcoded name would
              merge two mounted forms into one keyboard group. */}
          {EXPIRY_OPTIONS.map(({ value, label: optLabel }) => (
            <ExpiryRadio
              key={value}
              name={`${baseId}-expiry`}
              value={value}
              label={optLabel}
              checked={expiry === value}
              disabled={isCreating}
              onChange={setExpiry}
            />
          ))}
        </div>
      </fieldset>

      {/* Redemption mode */}
      <fieldset className={cn(UNSTYLED_FIELDSET, "stg:space-y-1.5")}>
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">
          Usage limit
        </legend>
        <div className="stg:flex stg:flex-wrap stg:gap-2">
          <RedemptionRadio
            name={`${baseId}-redemption`}
            value="unlimited"
            label="Unlimited"
            description="Anyone with the link can join"
            checked={redemptionMode === "unlimited"}
            disabled={isCreating}
            onChange={setRedemptionMode}
          />
          <RedemptionRadio
            name={`${baseId}-redemption`}
            value="single"
            label="Single use"
            description="One person only"
            checked={redemptionMode === "single"}
            disabled={isCreating}
            onChange={setRedemptionMode}
          />
        </div>
      </fieldset>

      {error && (
        <FieldError>
          {getUserMessage(error)}
        </FieldError>
      )}

      <div className="stg:flex stg:items-center stg:gap-2">
        <Button type="submit" size="xs" disabled={!canSubmit} icon={isCreating ? <SpinnerIcon size={12} /> : undefined}>
          Create invite link
        </Button>

        <Button variant="ghost" size="xs" onClick={onCancel} disabled={isCreating}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// InvitationRow (internal)
// ---------------------------------------------------------------------------

function InvitationRow({
  invitation,
  buildInviteUrl,
  onRevoke,
}: {
  invitation: Invitation;
  buildInviteUrl: (token: string) => string;
  onRevoke: (invitationId: string, label: string, joined: number) => void;
}) {
  const { copy, copied } = useCopyFeedback();

  const id = invitation.metadata?.id ?? "";
  const label = invitation.spec?.label || invitation.metadata?.name || "Unnamed invite";
  const role = invitation.spec?.role ?? IamRole.iam_role_unspecified;
  const state = invitation.status?.state ?? InvitationState.invitation_state_unspecified;
  const token = invitation.status?.token ?? "";
  const redemptionCount = invitation.status?.redemptionCount ?? 0;
  const maxRedemptions = invitation.spec?.maxRedemptions ?? 0;
  const expiresAt = invitation.spec?.expiresAt;
  const isActive = state === InvitationState.active;

  const handleCopy = useCallback(() => {
    void copy(buildInviteUrl(token));
  }, [copy, token, buildInviteUrl]);

  return (
    <ListRow
      leading={<LinkIcon active={isActive} />}
      name={<span className={isActive ? undefined : "stg:text-muted-foreground"}>{label}</span>}
      description={`${iamRoleDisplayName(role)} · ${formatAudience(maxRedemptions)} · ${formatUse(redemptionCount)}`}
      trailing={
        <>
          {/* Metadata columns */}
          <div className="stg:hidden stg:sm:flex stg:shrink-0 stg:items-center stg:gap-3">
            {/* State: a live link needs no pill; one that no longer lets anyone in says why. */}
            {!isActive && <StateBadge state={state} />}

            {/* Expiry */}
            {expiresAt && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <time
                      dateTime={timestampDate(expiresAt).toISOString()}
                      className="stg:text-xs stg:text-muted-foreground"
                    />
                  }
                >
                  {isActive
                    ? formatExpiry(timestampDate(expiresAt))
                    : formatShortDate(timestampDate(expiresAt))}
                </TooltipTrigger>
                <TooltipContent side="top">
                  {timestampDate(expiresAt).toISOString()}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Actions */}
          <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1">
            {isActive && (
              <IconButton
                size="xs"
                label={copied ? "Link copied" : `Copy the link ${label}`}
                icon={copied ? <CheckIcon /> : <CopyIcon />}
                onClick={handleCopy}
                className={copied ? "stg:text-primary" : undefined}
              />
            )}
            {isActive && (
              <IconButton
                size="xs"
                label={`Revoke ${label}`}
                icon={<RevokeIcon />}
                onClick={() => onRevoke(id, label, redemptionCount)}
                className="stg:hover:text-destructive stg:hover:bg-destructive-subtle"
              />
            )}
          </div>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// StateBadge (internal)
// ---------------------------------------------------------------------------

function StateBadge({ state }: { state: InvitationState }) {
  const config = STATE_BADGE_CONFIG[state] ?? STATE_BADGE_CONFIG[InvitationState.invitation_state_unspecified];
  return <StatusBadge phase={config.phase} label={config.label} />;
}

/** A live link reads as ready; one that no longer lets anyone in, as disabled. */
const STATE_BADGE_CONFIG: Record<InvitationState, { label: string; phase: StatusPhase }> = {
  [InvitationState.invitation_state_unspecified]: { label: "Unknown", phase: "disabled" },
  [InvitationState.active]: { label: "Active", phase: "ready" },
  [InvitationState.expired]: { label: "Expired", phase: "disabled" },
  [InvitationState.revoked]: { label: "Revoked", phase: "disabled" },
  [InvitationState.fully_redeemed]: { label: "Fully redeemed", phase: "disabled" },
};

// ---------------------------------------------------------------------------
// Radio helpers (internal)
// ---------------------------------------------------------------------------

function ExpiryRadio({
  name,
  value,
  label,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  value: ExpiryOption;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: ExpiryOption) => void;
}) {
  return (
    <label
      className={cn(
        "stg:inline-flex stg:cursor-pointer stg:items-center stg:rounded-md stg:border stg:px-2.5 stg:py-1 stg:text-xs stg:transition-colors",
        checked
          ? "stg:border-primary stg:bg-primary-subtle stg:text-primary stg:font-medium"
          : "stg:border-input stg:bg-background stg:text-muted-foreground stg:hover:border-border stg:hover:text-foreground",
        disabled && "stg:pointer-events-none stg:opacity-50",
      )}
    >
      <Radio
        visuallyHidden
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      {label}
    </label>
  );
}

function RedemptionRadio({
  name,
  value,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  value: RedemptionMode;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: RedemptionMode) => void;
}) {
  return (
    <label
      className={cn(
        "stg:inline-flex stg:cursor-pointer stg:flex-col stg:rounded-md stg:border stg:px-3 stg:py-1.5 stg:text-xs stg:transition-colors",
        checked
          ? "stg:border-primary stg:bg-primary-subtle stg:text-primary stg:font-medium"
          : "stg:border-input stg:bg-background stg:text-muted-foreground stg:hover:border-border stg:hover:text-foreground",
        disabled && "stg:pointer-events-none stg:opacity-50",
      )}
    >
      <Radio
        visuallyHidden
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span>{label}</span>
      <span className="stg:text-2xs stg:text-muted-foreground stg:font-normal stg:mt-0.5">
        {description}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/** Who a link admits, by its use limit: one person, anyone, or up to a number. */
function formatAudience(maxRedemptions: number): string {
  if (maxRedemptions === 0) return "Anyone with the link";
  if (maxRedemptions === 1) return "One person only";
  return `Up to ${maxRedemptions} people`;
}

/** How often a link was used: "not used yet" or how many joined with it. */
function formatUse(redemptionCount: number): string {
  return redemptionCount === 0 ? "not used yet" : `${redemptionCount} joined`;
}

/**
 * An active link's expiry as a day: "Expires Aug 1", the year only when it
 * is not this year's; "Expired" once the day has passed.
 */
function formatExpiry(date: Date): string {
  if (date.getTime() <= Date.now()) return "Expired";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `Expires ${day}`;
}

/**
 * What revoking a link does to the people who joined with it, counted (a
 * word up to ten) and named in the organization they stay in.
 */
function revokeLine(joined: number, orgName: string): string {
  if (joined === 0) return "The link stops working at once. No one has joined with it yet.";
  const stay =
    joined === 1
      ? `The one person who joined with it stays in ${orgName}.`
      : `The ${countWord(joined)} people who joined with it stay in ${orgName}.`;
  return `The link stops working at once. ${stay}`;
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function LinkIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "stg:shrink-0",
        active ? "stg:text-primary" : "stg:text-muted-foreground",
      )}
    >
      <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M5 11H3.5A1.5 1.5 0 0 1 2 9.5V3.5A1.5 1.5 0 0 1 3.5 2h6A1.5 1.5 0 0 1 11 3.5V5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5l3.5 3.5L13 5" />
    </svg>
  );
}

function RevokeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M4.5 11.5l7-7" />
    </svg>
  );
}

