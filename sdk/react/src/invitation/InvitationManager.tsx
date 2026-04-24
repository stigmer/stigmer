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
import { useOrgInvitations } from "./useOrgInvitations";
import { useCreateInvitation } from "./useCreateInvitation";
import { useRevokeInvitation } from "./useRevokeInvitation";
import { InvitationCreatedAlert } from "./InvitationCreatedAlert";
import { RoleSelector } from "../iam-policy/RoleSelector";

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
        className={cn("space-y-2", className)}
        aria-busy="true"
        aria-label="Loading invitations"
      >
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="bg-muted-subtle h-14 animate-pulse rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("text-destructive text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            Invite Links
          </span>
          {activeCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
              {activeCount} active
            </span>
          )}
        </div>
        {flow.phase === "idle" && (
          <button
            type="button"
            onClick={() => setFlow({ phase: "creating" })}
            className="text-primary hover:text-foreground text-xs font-medium transition-colors"
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
        <div className="border-border bg-card rounded-lg border p-4">
          <CreateInvitationForm
            org={org}
            onCreated={handleCreated}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </div>
      )}

      {/* Invitation list */}
      {invitations.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          No invite links yet. Create one to start inviting people.
        </p>
      ) : (
        <div
          role="list"
          aria-label="Invitation links"
          className="space-y-2"
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
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Label */}
      <div className="space-y-1">
        <label
          htmlFor="stgm-new-invite-label"
          className="text-xs font-medium text-foreground"
        >
          Label{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
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
            "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
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
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-foreground">
          Expires in
        </legend>
        <div className="flex flex-wrap gap-2">
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
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-foreground">
          Usage limit
        </legend>
        <div className="flex flex-wrap gap-2">
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
        <p className="text-destructive text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon />}
          Create invite link
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={isCreating}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs",
            "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
            "disabled:pointer-events-none disabled:opacity-50",
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
  const [copied, setCopied] = useState(false);

  const id = invitation.metadata?.id ?? "";
  const label = invitation.spec?.label || invitation.metadata?.name || "Unnamed invite";
  const role = invitation.spec?.role ?? IamRole.iam_role_unspecified;
  const state = invitation.status?.state ?? InvitationState.invitation_state_unspecified;
  const token = invitation.status?.token ?? "";
  const redemptionCount = invitation.status?.redemptionCount ?? 0;
  const maxRedemptions = invitation.spec?.maxRedemptions ?? 0;
  const expiresAt = invitation.spec?.expiresAt;
  const isActive = state === InvitationState.active;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildInviteUrl(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silently fail — copy is a convenience, not critical
    }
  }, [token, buildInviteUrl]);

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
      className="flex items-center gap-3 rounded-lg border border-border-muted px-3 py-2.5 hover:border-border transition-colors"
    >
      {/* Icon */}
      <LinkIcon active={isActive} />

      {/* Label + redemption info */}
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-medium",
            isActive ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        <span className="block text-xs text-muted-foreground">
          {formatRedemptions(redemptionCount, maxRedemptions)}
        </span>
      </div>

      {/* Metadata columns */}
      <div className="hidden sm:flex shrink-0 items-center gap-3">
        {/* Role badge */}
        <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-foreground">
          {iamRoleDisplayName(role)}
        </span>

        {/* State badge */}
        <StateBadge state={state} />

        {/* Expiry */}
        {expiresAt && (
          <span className="text-xs text-muted-foreground" title={timestampDate(expiresAt).toISOString()}>
            {isActive
              ? formatRelativeExpiry(timestampDate(expiresAt))
              : formatShortDate(timestampDate(expiresAt))}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        {isActive && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Link copied" : `Copy invite link for ${label}`}
            className={cn(
              "shrink-0 rounded p-1 transition-colors",
              copied
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
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
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive-subtle transition-colors"
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
      className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive-subtle px-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground">
          Revoke <span className="font-medium">{label}</span>? The link will
          stop working immediately.
        </p>
        {error && (
          <p className="mt-0.5 text-[0.65rem] text-destructive">
            {getUserMessage(error)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 ml-3">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isRevoking}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
            "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {isRevoking && <SpinnerIcon />}
          Revoke
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isRevoking}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs",
            "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
            "disabled:pointer-events-none disabled:opacity-50",
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
        "inline-flex items-center rounded-full px-2 py-0.5 text-[0.6rem] font-medium",
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
    className: "bg-muted text-muted-foreground",
  },
  [InvitationState.active]: {
    label: "Active",
    className: "bg-primary-subtle text-primary",
  },
  [InvitationState.expired]: {
    label: "Expired",
    className: "bg-muted text-muted-foreground",
  },
  [InvitationState.revoked]: {
    label: "Revoked",
    className: "bg-muted text-muted-foreground",
  },
  [InvitationState.fully_redeemed]: {
    label: "Fully redeemed",
    className: "bg-muted text-muted-foreground",
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
        "inline-flex cursor-pointer items-center rounded-md border px-2.5 py-1 text-xs transition-colors",
        checked
          ? "border-primary bg-primary-subtle text-primary font-medium"
          : "border-input bg-background text-muted-foreground hover:border-border hover:text-foreground",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <input
        type="radio"
        name="stgm-invite-expiry"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="sr-only"
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
        "inline-flex cursor-pointer flex-col rounded-md border px-3 py-1.5 text-xs transition-colors",
        checked
          ? "border-primary bg-primary-subtle text-primary font-medium"
          : "border-input bg-background text-muted-foreground hover:border-border hover:text-foreground",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <input
        type="radio"
        name="stgm-invite-redemption"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      <span>{label}</span>
      <span className="text-[0.625rem] text-muted-foreground font-normal mt-0.5">
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
        "shrink-0",
        active ? "text-primary" : "text-muted-foreground",
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

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
