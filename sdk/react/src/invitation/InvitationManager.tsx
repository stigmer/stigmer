"use client";

import { useCallback, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import {
  getUserMessage,
  iamRoleDisplayName,
} from "@stigmer/sdk";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { InvitationState } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/enum_pb";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useOrgInvitations } from "./useOrgInvitations.js";
import { useCreateInvitation } from "./useCreateInvitation.js";
import { useRevokeInvitation } from "./useRevokeInvitation.js";
import { InvitationCreatedAlert } from "./InvitationCreatedAlert.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { RoleSelector } from "../iam-policy/RoleSelector.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link InvitationManager}. */
export interface InvitationManagerProps {
  /** Organization slug whose invitations to manage. */
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
 * Displays all invitations for the organization with inline actions
 * (copy link, revoke) and a create form for generating new invite
 * links. Follows the same pattern as {@link OrgMembersPanel}: a
 * single embeddable component that handles the full management flow.
 *
 * The component composes three invitation hooks internally:
 * - {@link useOrgInvitations} for listing
 * - {@link useCreateInvitation} for creation
 * - {@link useRevokeInvitation} for revocation
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <InvitationManager org="acme" />
 *
 * <InvitationManager
 *   org="acme"
 *   buildInviteUrl={(token) => `https://myapp.com/join/${token}`}
 * />
 * ```
 */
export function InvitationManager({
  org,
  buildInviteUrl = defaultBuildInviteUrl,
  className,
}: InvitationManagerProps) {
  const { invitations, isLoading, error, refetch } = useOrgInvitations(org);
  const [flow, setFlow] = useState<FlowState>({ phase: "idle" });
  const [revokingId, setRevokingId] = useState<string | null>(null);

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

  const handleRevoked = useCallback(() => {
    setRevokingId(null);
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div
        className={cn("stg:space-y-2", className)}
        aria-busy="true"
        aria-label="Loading invitations"
      >
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="stg:bg-muted-subtle stg:h-14 stg:animate-pulse stg:rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  return (
    <div className={cn("stg:space-y-3", className)}>
      {/* Header */}
      <div className="stg:flex stg:items-center stg:justify-between">
        <div className="stg:flex stg:items-center stg:gap-2">
          <span className="stg:text-sm stg:font-semibold stg:text-foreground">
            Invite Links
          </span>
          {activeCount > 0 && (
            <span className="stg:inline-flex stg:items-center stg:rounded-full stg:bg-muted stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground">
              {activeCount} active
            </span>
          )}
        </div>
        {flow.phase === "idle" && (
          <button
            type="button"
            onClick={() => setFlow({ phase: "creating" })}
            className="stg:text-primary stg:hover:text-foreground stg:text-xs stg:font-medium stg:transition-colors"
          >
            + Create invite link
          </button>
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
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <CreateInvitationForm
            org={org}
            onCreated={handleCreated}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </div>
      )}

      {/* Invitation list */}
      {invitations.length === 0 ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          No invite links yet. Create one to start inviting people.
        </p>
      ) : (
        <div
          role="list"
          aria-label="Invitation links"
          className="stg:space-y-2"
        >
          {invitations.map((inv) => {
            const id = inv.metadata?.id ?? "";
            return (
              <InvitationRow
                key={id}
                invitation={inv}
                buildInviteUrl={buildInviteUrl}
                isRevoking={revokingId === id}
                onStartRevoke={() => setRevokingId(id)}
                onCancelRevoke={() => setRevokingId(null)}
                onRevoked={handleRevoked}
              />
            );
          })}
        </div>
      )}
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
          htmlFor="stgm-new-invite-label"
          className="stg:text-xs stg:font-medium stg:text-foreground"
        >
          Label{" "}
          <span className="stg:font-normal stg:text-muted-foreground">(optional)</span>
        </label>
        <input
          id="stgm-new-invite-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Engineering team link"
          disabled={isCreating}
          autoFocus
          maxLength={200}
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        />
      </div>

      {/* Role */}
      <RoleSelector
        kind={ApiResourceKind.organization}
        selected={role}
        onSelect={(r) => setRole(r)}
        disabled={isCreating}
      />

      {/* Expiry */}
      <fieldset className="stg:space-y-1.5">
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">
          Expires in
        </legend>
        <div className="stg:flex stg:flex-wrap stg:gap-2">
          {EXPIRY_OPTIONS.map(({ value, label: optLabel }) => (
            <ExpiryRadio
              key={value}
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
      <fieldset className="stg:space-y-1.5">
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">
          Usage limit
        </legend>
        <div className="stg:flex stg:flex-wrap stg:gap-2">
          <RedemptionRadio
            value="unlimited"
            label="Unlimited"
            description="Anyone with the link can join"
            checked={redemptionMode === "unlimited"}
            disabled={isCreating}
            onChange={setRedemptionMode}
          />
          <RedemptionRadio
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
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon size={12} />}
          Create invite link
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={isCreating}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          Cancel
        </button>
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
  isRevoking,
  onStartRevoke,
  onCancelRevoke,
  onRevoked,
}: {
  invitation: Invitation;
  buildInviteUrl: (token: string) => string;
  isRevoking: boolean;
  onStartRevoke: () => void;
  onCancelRevoke: () => void;
  onRevoked: () => void;
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

  if (isRevoking) {
    return (
      <RevokeConfirmation
        invitationId={id}
        label={label}
        onRevoked={onRevoked}
        onCancel={onCancelRevoke}
      />
    );
  }

  return (
    <div
      role="listitem"
      className="stg:flex stg:items-center stg:gap-3 stg:rounded-lg stg:border stg:border-border-muted stg:px-3 stg:py-2.5 stg:hover:border-border stg:transition-colors"
    >
      {/* Icon */}
      <LinkIcon active={isActive} />

      {/* Label + redemption info */}
      <div className="stg:min-w-0 stg:flex-1">
        <span
          className={cn(
            "stg:block stg:truncate stg:text-sm stg:font-medium",
            isActive ? "stg:text-foreground" : "stg:text-muted-foreground",
          )}
        >
          {label}
        </span>
        <span className="stg:block stg:text-xs stg:text-muted-foreground">
          {formatRedemptions(redemptionCount, maxRedemptions)}
        </span>
      </div>

      {/* Metadata columns */}
      <div className="stg:hidden stg:sm:flex stg:shrink-0 stg:items-center stg:gap-3">
        {/* Role badge */}
        <span className="stg:inline-flex stg:items-center stg:rounded-md stg:border stg:border-border stg:bg-muted stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-foreground">
          {iamRoleDisplayName(role)}
        </span>

        {/* State badge */}
        <StateBadge state={state} />

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
                ? formatRelativeExpiry(timestampDate(expiresAt))
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
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Link copied" : `Copy invite link for ${label}`}
            className={cn(
              "stg:shrink-0 stg:rounded stg:p-1 stg:transition-colors",
              copied
                ? "stg:text-primary"
                : "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            )}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
        {isActive && (
          <button
            type="button"
            onClick={onStartRevoke}
            aria-label={`Revoke ${label}`}
            className="stg:shrink-0 stg:rounded stg:p-1 stg:text-muted-foreground stg:hover:text-destructive stg:hover:bg-destructive-subtle stg:transition-colors"
          >
            <RevokeIcon />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RevokeConfirmation (internal)
// ---------------------------------------------------------------------------

function RevokeConfirmation({
  invitationId,
  label,
  onRevoked,
  onCancel,
}: {
  invitationId: string;
  label: string;
  onRevoked: () => void;
  onCancel: () => void;
}) {
  const { revoke, isRevoking, error } = useRevokeInvitation();

  const handleConfirm = useCallback(async () => {
    try {
      await revoke(invitationId);
      onRevoked();
    } catch {
      // error state is surfaced via the hook
    }
  }, [invitationId, revoke, onRevoked]);

  return (
    <div
      role="listitem"
      className="stg:flex stg:items-center stg:justify-between stg:rounded-lg stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-3 stg:py-2.5"
    >
      <div className="stg:min-w-0 stg:flex-1">
        <p className="stg:text-xs stg:text-foreground">
          Revoke <span className="stg:font-medium">{label}</span>? The link will
          stop working immediately.
        </p>
        {error && (
          <p className="stg:mt-0.5 stg:text-[0.65rem] stg:text-destructive">
            {getUserMessage(error)}
          </p>
        )}
      </div>

      <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5 stg:ml-3">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isRevoking}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
            "stg:bg-destructive stg:text-destructive-foreground stg:hover:bg-destructive-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          {isRevoking && <SpinnerIcon size={12} />}
          Revoke
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isRevoking}
          className={cn(
            "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StateBadge (internal)
// ---------------------------------------------------------------------------

function StateBadge({ state }: { state: InvitationState }) {
  const config = STATE_BADGE_CONFIG[state] ?? STATE_BADGE_CONFIG[InvitationState.invitation_state_unspecified];
  return (
    <span
      className={cn(
        "stg:inline-flex stg:items-center stg:rounded-full stg:px-2 stg:py-0.5 stg:text-[0.6rem] stg:font-medium",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}

const STATE_BADGE_CONFIG: Record<InvitationState, { label: string; className: string }> = {
  [InvitationState.invitation_state_unspecified]: {
    label: "Unknown",
    className: "stg:bg-muted stg:text-muted-foreground",
  },
  [InvitationState.active]: {
    label: "Active",
    className: "stg:bg-primary-subtle stg:text-primary",
  },
  [InvitationState.expired]: {
    label: "Expired",
    className: "stg:bg-muted stg:text-muted-foreground",
  },
  [InvitationState.revoked]: {
    label: "Revoked",
    className: "stg:bg-muted stg:text-muted-foreground",
  },
  [InvitationState.fully_redeemed]: {
    label: "Fully redeemed",
    className: "stg:bg-muted stg:text-muted-foreground",
  },
};

// ---------------------------------------------------------------------------
// Radio helpers (internal)
// ---------------------------------------------------------------------------

function ExpiryRadio({
  value,
  label,
  checked,
  disabled,
  onChange,
}: {
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
      <input
        type="radio"
        name="stgm-invite-expiry"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="stg:sr-only"
      />
      {label}
    </label>
  );
}

function RedemptionRadio({
  value,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
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
      <input
        type="radio"
        name="stgm-invite-redemption"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="stg:sr-only"
      />
      <span>{label}</span>
      <span className="stg:text-[0.625rem] stg:text-muted-foreground stg:font-normal stg:mt-0.5">
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

function formatRedemptions(count: number, max: number): string {
  if (max === 0) {
    return count === 0 ? "No redemptions yet" : `${count} redeemed`;
  }
  return `${count} / ${max} redeemed`;
}

function formatRelativeExpiry(date: Date): string {
  const now = Date.now();
  const diffMs = date.getTime() - now;

  if (diffMs <= 0) return "Expired";

  const days = Math.ceil(diffMs / 86_400_000);
  if (days === 1) return "Expires tomorrow";
  if (days <= 30) return `Expires in ${days} days`;
  return `Expires ${formatShortDate(date)}`;
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

