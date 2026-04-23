"use client";

import {
  useCallback,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import type { PlatformClientCreateResponse } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import { useUpdatePlatformClient } from "./useUpdatePlatformClient";
import { useRotatePlatformClientSecret } from "./useRotatePlatformClientSecret";
import { useDeletePlatformClient } from "./useDeletePlatformClient";

/** Props for {@link PlatformClientDetailPanel}. */
export interface PlatformClientDetailPanelProps {
  /** The platform client resource to display and edit. */
  readonly platformClient: PlatformClient;
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (pc: PlatformClient) => void;
  /**
   * Fired after a successful secret rotation with the response
   * containing the one-time new raw secret.
   */
  readonly onSecretRotated?: (
    response: PlatformClientCreateResponse,
  ) => void;
  /** Fired after a successful deletion. */
  readonly onDeleted?: () => void;
  /** Fired when the user clicks the back button. */
  readonly onBack?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * View and edit panel for an existing platform client.
 *
 * In **view mode**, displays all configuration fields in a structured
 * label/value layout with "Edit", "Rotate Secret", and "Delete"
 * actions.
 *
 * In **edit mode**, mutable spec fields become editable: JIT
 * provisioning toggles, expiry, auto-grant role, and allowed
 * origins. Credential fields (`clientId`, `secretFingerprint`) are
 * read-only. "Save" submits the update; "Cancel" discards changes.
 *
 * Secret rotation triggers `onSecretRotated` with the full
 * {@link PlatformClientCreateResponse} so the parent can show the
 * one-time secret alert.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <PlatformClientDetailPanel
 *   platformClient={pc}
 *   onUpdated={(updated) => refetch()}
 *   onSecretRotated={(resp) => setFlow({ phase: "revealing", resp })}
 *   onDeleted={() => setFlow({ phase: "idle" })}
 *   onBack={() => setFlow({ phase: "idle" })}
 * />
 * ```
 */
export function PlatformClientDetailPanel({
  platformClient,
  onUpdated,
  onSecretRotated,
  onDeleted,
  onBack,
  className,
}: PlatformClientDetailPanelProps) {
  const spec = platformClient.spec;
  const meta = platformClient.metadata;

  const { update, isUpdating, error: updateError, clearError: clearUpdateError } =
    useUpdatePlatformClient();
  const { rotateSecret, isRotating, error: rotateError, clearError: clearRotateError } =
    useRotatePlatformClientSecret();
  const { deletePlatformClient, isDeleting, error: deleteError } =
    useDeletePlatformClient();

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);

  const isBusy = isUpdating || isRotating || isDeleting;

  // Edit form state
  const [neverExpires, setNeverExpires] = useState(
    spec?.neverExpires ?? true,
  );
  const [expiresAt, setExpiresAt] = useState(() => {
    if (spec?.expiresAt) {
      return toDatetimeLocalValue(timestampDate(spec.expiresAt));
    }
    return "";
  });
  const [autoProvision, setAutoProvision] = useState(
    spec?.autoProvisionAccounts ?? false,
  );
  const [autoGrant, setAutoGrant] = useState(
    spec?.autoGrantOnOrg ?? false,
  );
  const [autoGrantRole, setAutoGrantRole] = useState<IamRole>(
    spec?.autoGrantRole ?? IamRole.iam_role_unspecified,
  );
  const [origins, setOrigins] = useState<string[]>(
    [...(spec?.allowedOrigins ?? [])],
  );
  const [originInput, setOriginInput] = useState("");

  const handleAutoProvisionChange = useCallback((v: boolean) => {
    setAutoProvision(v);
    if (!v) {
      setAutoGrant(false);
      setAutoGrantRole(IamRole.iam_role_unspecified);
    }
  }, []);

  const handleAutoGrantChange = useCallback((v: boolean) => {
    setAutoGrant(v);
    if (v) setAutoProvision(true);
    if (!v) setAutoGrantRole(IamRole.iam_role_unspecified);
  }, []);

  const addOrigin = useCallback(() => {
    const trimmed = originInput.trim();
    if (trimmed && !origins.includes(trimmed)) {
      setOrigins((prev) => [...prev, trimmed]);
    }
    setOriginInput("");
  }, [originInput, origins]);

  const handleOriginKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addOrigin();
      }
    },
    [addOrigin],
  );

  const removeOrigin = useCallback((origin: string) => {
    setOrigins((prev) => prev.filter((o) => o !== origin));
  }, []);

  const enterEdit = useCallback(() => {
    setNeverExpires(spec?.neverExpires ?? true);
    setExpiresAt(
      spec?.expiresAt
        ? toDatetimeLocalValue(timestampDate(spec.expiresAt))
        : "",
    );
    setAutoProvision(spec?.autoProvisionAccounts ?? false);
    setAutoGrant(spec?.autoGrantOnOrg ?? false);
    setAutoGrantRole(
      spec?.autoGrantRole ?? IamRole.iam_role_unspecified,
    );
    setOrigins([...(spec?.allowedOrigins ?? [])]);
    setOriginInput("");
    clearUpdateError();
    setMode("edit");
  }, [spec, clearUpdateError]);

  const cancelEdit = useCallback(() => {
    clearUpdateError();
    setMode("view");
  }, [clearUpdateError]);

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      clearUpdateError();
      try {
        const updated = await update({
          name: meta?.name ?? "",
          slug: meta?.slug,
          org: meta?.org ?? "",
          neverExpires,
          ...(!neverExpires &&
            expiresAt && {
              expiresAt: new Date(expiresAt).toISOString(),
            }),
          autoProvisionAccounts: autoProvision,
          autoGrantOnOrg: autoGrant,
          ...(autoGrant &&
            autoGrantRole !== IamRole.iam_role_unspecified && {
              autoGrantRole,
            }),
          allowedOrigins: origins,
        });
        setMode("view");
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdatePlatformClient
      }
    },
    [
      meta,
      neverExpires,
      expiresAt,
      autoProvision,
      autoGrant,
      autoGrantRole,
      origins,
      update,
      clearUpdateError,
      onUpdated,
    ],
  );

  const handleRotateSecret = useCallback(async () => {
    clearRotateError();
    try {
      const response = await rotateSecret(meta?.id ?? "");
      setConfirmingRotate(false);
      onSecretRotated?.(response);
    } catch {
      // error state is managed by the hook
    }
  }, [meta?.id, rotateSecret, clearRotateError, onSecretRotated]);

  const handleDelete = useCallback(async () => {
    try {
      await deletePlatformClient({ resourceId: meta?.id ?? "" });
      onDeleted?.();
    } catch {
      // error state is surfaced via the hook
    }
  }, [meta?.id, deletePlatformClient, onDeleted]);

  const createdAt = platformClient.status?.audit?.specAudit?.createdAt;
  const updatedAt = platformClient.status?.audit?.specAudit?.updatedAt;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground mb-1 flex items-center gap-1 text-xs transition-colors"
            >
              <ArrowLeftIcon />
              Back to list
            </button>
          )}
          <h3 className="text-foreground truncate text-sm font-semibold">
            {meta?.name ?? "Platform Client"}
          </h3>
          <div className="flex items-center gap-2">
            {meta?.slug && (
              <span className="text-muted-foreground font-mono text-xs">
                {meta.slug}
              </span>
            )}
            {spec?.autoProvisionAccounts && (
              <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary-subtle px-2 py-0.5 text-[0.65rem] font-medium text-primary">
                JIT
              </span>
            )}
          </div>
        </div>

        {mode === "view" && (
          <button
            type="button"
            onClick={enterEdit}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "transition-colors",
            )}
          >
            Edit
          </button>
        )}
      </div>

      {/* Body */}
      {mode === "view" ? (
        <ViewMode
          spec={spec}
          createdAt={createdAt}
          updatedAt={updatedAt}
        />
      ) : (
        <form onSubmit={handleSave} className="space-y-3">
          {/* Read-only credential info */}
          <div className="rounded-md border border-border-muted bg-muted-faint px-3 py-2 space-y-1">
            <p className="text-[0.65rem] font-medium text-muted-foreground">
              Client ID
            </p>
            <p className="font-mono text-xs text-foreground">
              {spec?.clientId ?? "—"}
            </p>
          </div>

          {/* Expiry */}
          <fieldset className="space-y-2" disabled={isUpdating}>
            <legend className="text-xs font-medium text-foreground">
              Expiry
            </legend>
            <ToggleSwitch
              checked={neverExpires}
              onChange={setNeverExpires}
              label="Never expires"
              disabled={isUpdating}
            />
            {!neverExpires && (
              <div className="space-y-1">
                <label
                  htmlFor="stgm-pc-edit-expires-at"
                  className="text-xs font-medium text-foreground"
                >
                  Expires at
                </label>
                <input
                  id="stgm-pc-edit-expires-at"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  disabled={isUpdating}
                  className={cn(
                    "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                />
              </div>
            )}
          </fieldset>

          {/* JIT provisioning */}
          <fieldset className="space-y-2.5" disabled={isUpdating}>
            <hr className="border-border-muted" />
            <legend className="text-xs font-medium text-foreground">
              JIT provisioning
            </legend>

            <ToggleSwitch
              checked={autoProvision}
              onChange={handleAutoProvisionChange}
              label="Auto-provision accounts"
              hint="Create a Stigmer identity account automatically on first token mint"
              disabled={isUpdating}
            />

            <ToggleSwitch
              checked={autoGrant}
              onChange={handleAutoGrantChange}
              label="Auto-grant on organization"
              hint="Grant a role on the owning organization when an account is provisioned"
              disabled={isUpdating || !autoProvision}
            />

            {autoGrant && (
              <div className="space-y-1">
                <label
                  htmlFor="stgm-pc-edit-grant-role"
                  className="text-xs font-medium text-foreground"
                >
                  Auto-grant role
                </label>
                <select
                  id="stgm-pc-edit-grant-role"
                  value={String(autoGrantRole)}
                  onChange={(e) =>
                    setAutoGrantRole(
                      Number(e.target.value) as IamRole,
                    )
                  }
                  disabled={isUpdating}
                  className={cn(
                    "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                >
                  {JIT_ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>

          {/* Allowed origins */}
          <fieldset className="space-y-2" disabled={isUpdating}>
            <hr className="border-border-muted" />
            <legend className="text-xs font-medium text-foreground">
              Allowed origins
            </legend>
            <p className="text-[0.65rem] text-muted-foreground">
              Browser origins permitted to use tokens minted by this
              client. Leave empty to allow all origins.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={originInput}
                onChange={(e) => setOriginInput(e.target.value)}
                onKeyDown={handleOriginKeyDown}
                onBlur={() => {
                  if (originInput.trim()) addOrigin();
                }}
                placeholder="https://example.com"
                disabled={isUpdating}
                className={cn(
                  "min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              />
              <button
                type="button"
                onClick={addOrigin}
                disabled={isUpdating || !originInput.trim()}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
                  "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
                  "disabled:pointer-events-none disabled:opacity-50",
                  "transition-colors",
                )}
              >
                Add
              </button>
            </div>

            {origins.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {origins.map((origin) => (
                  <span
                    key={origin}
                    className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-muted-subtle px-2 py-0.5 text-[0.65rem] font-mono text-foreground"
                  >
                    {origin}
                    <button
                      type="button"
                      onClick={() => removeOrigin(origin)}
                      disabled={isUpdating}
                      aria-label={`Remove ${origin}`}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <XIcon />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </fieldset>

          {updateError && (
            <p className="text-destructive text-[0.65rem]" role="alert">
              {getUserMessage(updateError)}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={isUpdating}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                "bg-primary text-primary-foreground hover:bg-primary-hover",
                "disabled:pointer-events-none disabled:opacity-40",
              )}
            >
              {isUpdating && <SpinnerIcon />}
              Save changes
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={isUpdating}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs",
                "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Actions bar (view mode only) */}
      {mode === "view" && (
        <div className="space-y-2 pt-2">
          <hr className="border-border-muted" />

          {/* Rotate Secret */}
          {confirmingRotate ? (
            <div className="flex items-center justify-between rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
              <p className="text-xs text-foreground">
                Rotate secret? The current secret will be
                <span className="font-medium"> permanently invalidated</span>.
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleRotateSecret}
                  disabled={isBusy}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
                    "bg-primary text-primary-foreground hover:bg-primary-hover",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                >
                  {isRotating && <SpinnerIcon />}
                  Rotate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingRotate(false);
                    clearRotateError();
                  }}
                  disabled={isBusy}
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
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingRotate(true)}
              disabled={isBusy}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium",
                "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
                "disabled:pointer-events-none disabled:opacity-50",
                "transition-colors",
              )}
            >
              Rotate secret
            </button>
          )}
          {rotateError && (
            <p className="text-destructive text-[0.65rem]" role="alert">
              {getUserMessage(rotateError)}
            </p>
          )}

          {/* Delete */}
          {confirmingDelete ? (
            <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-foreground">
                  Delete{" "}
                  <span className="font-medium">{meta?.name}</span>?
                  This action is permanent.
                </p>
                {deleteError && (
                  <p className="mt-0.5 text-[0.65rem] text-destructive">
                    {getUserMessage(deleteError)}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isBusy}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
                    "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                >
                  {isDeleting && <SpinnerIcon />}
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={isBusy}
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
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={isBusy}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium",
                "text-destructive hover:text-destructive-foreground hover:bg-destructive-hover",
                "disabled:pointer-events-none disabled:opacity-50",
                "transition-colors",
              )}
            >
              Delete platform client
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View mode
// ---------------------------------------------------------------------------

function ViewMode({
  spec,
  createdAt,
  updatedAt,
}: {
  spec: PlatformClient["spec"];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}) {
  return (
    <dl className="space-y-2.5">
      <Field label="Client ID" value={spec?.clientId} mono />
      <Field
        label="Secret fingerprint"
        value={
          spec?.secretFingerprint
            ? `••••${spec.secretFingerprint.slice(-4)}`
            : undefined
        }
        mono
      />

      {/* Expiry */}
      {spec?.neverExpires ? (
        <Field label="Expiry" value="Never expires" />
      ) : spec?.expiresAt ? (
        <Field
          label="Expires"
          value={formatDate(timestampDate(spec.expiresAt))}
        />
      ) : null}

      {/* JIT provisioning */}
      <hr className="border-border-muted" />
      <Field
        label="Auto-provision accounts"
        value={spec?.autoProvisionAccounts ? "Enabled" : "Disabled"}
      />
      <Field
        label="Auto-grant on organization"
        value={spec?.autoGrantOnOrg ? "Enabled" : "Disabled"}
      />
      {spec?.autoGrantOnOrg && (
        <Field
          label="Auto-grant role"
          value={formatIamRole(spec.autoGrantRole)}
        />
      )}

      {/* Allowed origins */}
      {(spec?.allowedOrigins.length ?? 0) > 0 && (
        <>
          <hr className="border-border-muted" />
          <div>
            <dt className="text-muted-foreground text-[0.65rem] font-medium">
              Allowed origins
            </dt>
            <dd className="mt-0.5 flex flex-wrap gap-1.5">
              {spec!.allowedOrigins.map((origin) => (
                <span
                  key={origin}
                  className="inline-block rounded-full border border-border-muted bg-muted-subtle px-2 py-0.5 text-[0.65rem] font-mono text-foreground"
                >
                  {origin}
                </span>
              ))}
            </dd>
          </div>
        </>
      )}

      {/* Timestamps */}
      <div className="flex gap-6">
        {createdAt && (
          <Field
            label="Created"
            value={formatDate(timestampDate(createdAt))}
          />
        )}
        {updatedAt && (
          <Field
            label="Updated"
            value={formatDate(timestampDate(updatedAt))}
          />
        )}
      </div>
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-muted-foreground text-[0.65rem] font-medium">
        {label}
      </dt>
      <dd
        className={cn(
          "text-foreground mt-0.5 break-all text-xs",
          mono && "font-mono",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          disabled={disabled}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            checked ? "bg-primary" : "bg-muted",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
              checked ? "translate-x-4" : "translate-x-0",
            )}
          />
        </button>
        <span className="text-xs font-medium text-foreground">{label}</span>
      </div>
      {hint && (
        <p className="pl-11 text-[0.65rem] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JIT_ROLE_OPTIONS: readonly {
  readonly value: string;
  readonly label: string;
}[] = [
  { value: String(IamRole.iam_role_unspecified), label: "Default (viewer)" },
  { value: String(IamRole.viewer), label: "Viewer" },
  { value: String(IamRole.member), label: "Member" },
  { value: String(IamRole.admin), label: "Admin" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatIamRole(role: IamRole): string {
  switch (role) {
    case IamRole.viewer:
      return "Viewer";
    case IamRole.member:
      return "Member";
    case IamRole.admin:
      return "Admin";
    case IamRole.owner:
      return "Owner";
    default:
      return "Viewer (default)";
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function XIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3L5 8l5 5" />
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
