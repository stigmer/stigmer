"use client";

import { type FormEvent, type KeyboardEvent, useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import type { PlatformClientCreateResponse } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import { useUpdatePlatformClient } from "./useUpdatePlatformClient.js";
import { useRotatePlatformClientSecret } from "./useRotatePlatformClientSecret.js";
import { useDeletePlatformClient } from "./useDeletePlatformClient.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

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
  const baseId = useId();
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
    <div className={cn("stg:space-y-4", className)}>
      {/* Header */}
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="stg:text-muted-foreground stg:hover:text-foreground stg:mb-1 stg:flex stg:items-center stg:gap-1 stg:text-xs stg:transition-colors"
            >
              <ArrowLeftIcon />
              Back to list
            </button>
          )}
          <h3 className="stg:text-foreground stg:truncate stg:text-sm stg:font-semibold">
            {meta?.name ?? "Platform Client"}
          </h3>
          <div className="stg:flex stg:items-center stg:gap-2">
            {meta?.slug && (
              <span className="stg:text-muted-foreground stg:font-mono stg:text-xs">
                {meta.slug}
              </span>
            )}
            {spec?.autoProvisionAccounts && (
              <span className="stg:inline-flex stg:items-center stg:rounded-full stg:border stg:border-primary/30 stg:bg-primary-subtle stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-primary">
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
              "stg:shrink-0 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:transition-colors",
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
        <form onSubmit={handleSave} className="stg:space-y-3">
          {/* Read-only credential info */}
          <div className="stg:rounded-md stg:border stg:border-border-muted stg:bg-muted-faint stg:px-3 stg:py-2 stg:space-y-1">
            <p className="stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground">
              Client ID
            </p>
            <p className="stg:font-mono stg:text-xs stg:text-foreground">
              {spec?.clientId ?? "—"}
            </p>
          </div>

          {/* Expiry */}
          <fieldset className="stg:space-y-2" disabled={isUpdating}>
            <legend className="stg:text-xs stg:font-medium stg:text-foreground">
              Expiry
            </legend>
            <ToggleSwitch
              checked={neverExpires}
              onChange={setNeverExpires}
              label="Never expires"
              disabled={isUpdating}
            />
            {!neverExpires && (
              <div className="stg:space-y-1">
                <label
                  htmlFor={`${baseId}-expires-at`}
                  className="stg:text-xs stg:font-medium stg:text-foreground"
                >
                  Expires at
                </label>
                <input
                  id={`${baseId}-expires-at`}
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  disabled={isUpdating}
                  className={cn(
                    "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
                    "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                    "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                  )}
                />
              </div>
            )}
          </fieldset>

          {/* JIT provisioning */}
          <fieldset className="stg:space-y-2.5" disabled={isUpdating}>
            <hr className="stg:border-border-muted" />
            <legend className="stg:text-xs stg:font-medium stg:text-foreground">
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
              <div className="stg:space-y-1">
                <label
                  htmlFor={`${baseId}-grant-role`}
                  className="stg:text-xs stg:font-medium stg:text-foreground"
                >
                  Auto-grant role
                </label>
                <select
                  id={`${baseId}-grant-role`}
                  value={String(autoGrantRole)}
                  onChange={(e) =>
                    setAutoGrantRole(
                      Number(e.target.value) as IamRole,
                    )
                  }
                  disabled={isUpdating}
                  className={cn(
                    "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
                    "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                    "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
          <fieldset className="stg:space-y-2" disabled={isUpdating}>
            <hr className="stg:border-border-muted" />
            <legend className="stg:text-xs stg:font-medium stg:text-foreground">
              Allowed origins
            </legend>
            <p className="stg:text-[0.65rem] stg:text-muted-foreground">
              Browser origins permitted to use tokens minted by this
              client. Leave empty to allow all origins.
            </p>

            <div className="stg:flex stg:items-center stg:gap-2">
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
                  "stg:min-w-0 stg:flex-1 stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
                  "stg:placeholder:text-muted-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                )}
              />
              <button
                type="button"
                onClick={addOrigin}
                disabled={isUpdating || !originInput.trim()}
                className={cn(
                  "stg:shrink-0 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
                  "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
                  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                  "stg:transition-colors",
                )}
              >
                Add
              </button>
            </div>

            {origins.length > 0 && (
              <div className="stg:flex stg:flex-wrap stg:gap-1.5">
                {origins.map((origin) => (
                  <span
                    key={origin}
                    className="stg:inline-flex stg:items-center stg:gap-1 stg:rounded-full stg:border stg:border-border-muted stg:bg-muted-subtle stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-mono stg:text-foreground"
                  >
                    {origin}
                    <button
                      type="button"
                      onClick={() => removeOrigin(origin)}
                      disabled={isUpdating}
                      aria-label={`Remove ${origin}`}
                      className="stg:text-muted-foreground stg:hover:text-destructive stg:transition-colors"
                    >
                      <XIcon />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </fieldset>

          {updateError && (
            <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
              {getUserMessage(updateError)}
            </p>
          )}

          <div className="stg:flex stg:items-center stg:gap-2 stg:pt-1">
            <button
              type="submit"
              disabled={isUpdating}
              className={cn(
                "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
                "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
                "stg:disabled:pointer-events-none stg:disabled:opacity-40",
              )}
            >
              {isUpdating && <SpinnerIcon size={12} />}
              Save changes
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={isUpdating}
              className={cn(
                "stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs",
                "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              )}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Actions bar (view mode only) */}
      {mode === "view" && (
        <div className="stg:space-y-2 stg:pt-2">
          <hr className="stg:border-border-muted" />

          {/* Rotate Secret */}
          {confirmingRotate ? (
            <div className="stg:flex stg:items-center stg:justify-between stg:rounded-md stg:border stg:border-warning/30 stg:bg-warning/5 stg:px-3 stg:py-2">
              <p className="stg:text-xs stg:text-foreground">
                Rotate secret? The current secret will be
                <span className="stg:font-medium"> permanently invalidated</span>.
              </p>
              <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
                <button
                  type="button"
                  onClick={handleRotateSecret}
                  disabled={isBusy}
                  className={cn(
                    "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                    "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
                    "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                  )}
                >
                  {isRotating && <SpinnerIcon size={12} />}
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
                    "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs",
                    "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
                    "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
                "stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
                "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                "stg:transition-colors",
              )}
            >
              Rotate secret
            </button>
          )}
          {rotateError && (
            <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
              {getUserMessage(rotateError)}
            </p>
          )}

          {/* Delete */}
          {confirmingDelete ? (
            <div className="stg:flex stg:items-center stg:justify-between stg:rounded-md stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-3 stg:py-2">
              <div className="stg:min-w-0 stg:flex-1">
                <p className="stg:text-xs stg:text-foreground">
                  Delete{" "}
                  <span className="stg:font-medium">{meta?.name}</span>?
                  This action is permanent.
                </p>
                {deleteError && (
                  <p className="stg:mt-0.5 stg:text-[0.65rem] stg:text-destructive">
                    {getUserMessage(deleteError)}
                  </p>
                )}
              </div>
              <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isBusy}
                  className={cn(
                    "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                    "stg:bg-destructive stg:text-destructive-foreground stg:hover:bg-destructive-hover",
                    "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                  )}
                >
                  {isDeleting && <SpinnerIcon size={12} />}
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={isBusy}
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
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={isBusy}
              className={cn(
                "stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
                "stg:text-destructive stg:hover:text-destructive-foreground stg:hover:bg-destructive-hover",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                "stg:transition-colors",
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
    <dl className="stg:space-y-2.5">
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
      <hr className="stg:border-border-muted" />
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
          <hr className="stg:border-border-muted" />
          <div>
            <dt className="stg:text-muted-foreground stg:text-[0.65rem] stg:font-medium">
              Allowed origins
            </dt>
            <dd className="stg:mt-0.5 stg:flex stg:flex-wrap stg:gap-1.5">
              {spec!.allowedOrigins.map((origin) => (
                <span
                  key={origin}
                  className="stg:inline-block stg:rounded-full stg:border stg:border-border-muted stg:bg-muted-subtle stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-mono stg:text-foreground"
                >
                  {origin}
                </span>
              ))}
            </dd>
          </div>
        </>
      )}

      {/* Timestamps */}
      <div className="stg:flex stg:gap-6">
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
      <dt className="stg:text-muted-foreground stg:text-[0.65rem] stg:font-medium">
        {label}
      </dt>
      <dd
        className={cn(
          "stg:text-foreground stg:mt-0.5 stg:break-all stg:text-xs",
          mono && "stg:font-mono",
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
    <div className="stg:space-y-0.5">
      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          disabled={disabled}
          className={cn(
            "stg:relative stg:inline-flex stg:h-5 stg:w-9 stg:shrink-0 stg:cursor-pointer stg:rounded-full stg:border-2 stg:border-transparent stg:transition-colors",
            checked ? "stg:bg-primary" : "stg:bg-muted",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          <span
            className={cn(
              "stg:pointer-events-none stg:inline-block stg:h-4 stg:w-4 stg:rounded-full stg:bg-background stg:shadow-sm stg:ring-0 stg:transition-transform",
              checked ? "stg:translate-x-4" : "stg:translate-x-0",
            )}
          />
        </button>
        <span className="stg:text-xs stg:font-medium stg:text-foreground">{label}</span>
      </div>
      {hint && (
        <p className="stg:pl-11 stg:text-[0.65rem] stg:text-muted-foreground">{hint}</p>
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

