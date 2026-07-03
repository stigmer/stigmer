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
import type { PlatformClientCreateResponse } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/io_pb";
import { useCreatePlatformClient } from "./useCreatePlatformClient.js";

/** Props for {@link CreatePlatformClientForm}. */
export interface CreatePlatformClientFormProps {
  /** Organization slug — the PlatformClient will be created in this org. */
  readonly org: string;
  /**
   * Fired with the full {@link PlatformClientCreateResponse} on
   * success. The response includes the one-time raw `clientSecret`.
   */
  readonly onCreated?: (response: PlatformClientCreateResponse) => void;
  /** Fired when the user cancels creation. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Form for creating a new platform client within an organization.
 *
 * Collects the required metadata (**name**) and optional spec fields:
 * JIT provisioning toggles, expiry configuration, and allowed
 * origins for CORS.
 *
 * On success it fires `onCreated` with the full
 * {@link PlatformClientCreateResponse}, which includes the one-time
 * raw client secret.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <CreatePlatformClientForm
 *   org="acme"
 *   onCreated={(resp) => {
 *     showSecret(resp.clientSecret);
 *     refetch();
 *   }}
 *   onCancel={() => setShowForm(false)}
 * />
 * ```
 */
export function CreatePlatformClientForm({
  org,
  onCreated,
  onCancel,
  className,
}: CreatePlatformClientFormProps) {
  const { create, isCreating, error, clearError } =
    useCreatePlatformClient();

  const [name, setName] = useState("");
  const [neverExpires, setNeverExpires] = useState(true);
  const [expiresAt, setExpiresAt] = useState("");

  // JIT provisioning
  const [autoProvision, setAutoProvision] = useState(true);
  const [autoGrant, setAutoGrant] = useState(true);
  const [autoGrantRole, setAutoGrantRole] = useState<IamRole>(
    IamRole.iam_role_unspecified,
  );

  // CORS
  const [origins, setOrigins] = useState<string[]>([]);
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

  const trimmedName = name.trim();
  const canSubmit = trimmedName !== "" && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      clearError();
      try {
        const response = await create({
          name: trimmedName,
          org,
          neverExpires,
          ...(!neverExpires &&
            expiresAt && { expiresAt: new Date(expiresAt).toISOString() }),
          autoProvisionAccounts: autoProvision,
          autoGrantOnOrg: autoGrant,
          ...(autoGrant &&
            autoGrantRole !== IamRole.iam_role_unspecified && {
              autoGrantRole,
            }),
          ...(origins.length > 0 && { allowedOrigins: origins }),
        });
        onCreated?.(response);
      } catch {
        // error state is managed by useCreatePlatformClient
      }
    },
    [
      canSubmit,
      trimmedName,
      org,
      neverExpires,
      expiresAt,
      autoProvision,
      autoGrant,
      autoGrantRole,
      origins,
      create,
      clearError,
      onCreated,
    ],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-3", className)}>
      <FormField
        id="stgm-pc-name"
        label="Name"
        value={name}
        onChange={setName}
        placeholder="e.g. my-saas-backend"
        disabled={isCreating}
        required
      />

      {/* Expiry */}
      <fieldset className="space-y-2" disabled={isCreating}>
        <legend className="text-xs font-medium text-foreground">
          Expiry
        </legend>
        <ToggleSwitch
          checked={neverExpires}
          onChange={setNeverExpires}
          label="Never expires"
          disabled={isCreating}
        />
        {!neverExpires && (
          <div className="space-y-1">
            <label
              htmlFor="stgm-pc-expires-at"
              className="text-xs font-medium text-foreground"
            >
              Expires at
            </label>
            <input
              id="stgm-pc-expires-at"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={isCreating}
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
      <fieldset className="space-y-2.5" disabled={isCreating}>
        <hr className="border-border-muted" />
        <legend className="text-xs font-medium text-foreground">
          JIT provisioning
        </legend>
        <p className="text-[0.65rem] text-muted-foreground">
          Configure automatic account creation and role assignment for
          users authenticated via this platform client.
        </p>

        <ToggleSwitch
          checked={autoProvision}
          onChange={handleAutoProvisionChange}
          label="Auto-provision accounts"
          hint="Create a Stigmer identity account automatically on first token mint"
          disabled={isCreating}
        />

        <ToggleSwitch
          checked={autoGrant}
          onChange={handleAutoGrantChange}
          label="Auto-grant on organization"
          hint="Grant a role on the owning organization when an account is provisioned"
          disabled={isCreating || !autoProvision}
        />

        {autoGrant && (
          <div className="space-y-1">
            <label
              htmlFor="stgm-pc-grant-role"
              className="text-xs font-medium text-foreground"
            >
              Auto-grant role
            </label>
            <select
              id="stgm-pc-grant-role"
              value={String(autoGrantRole)}
              onChange={(e) =>
                setAutoGrantRole(Number(e.target.value) as IamRole)
              }
              disabled={isCreating}
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
            <p className="text-[0.65rem] text-muted-foreground">
              Role granted automatically — org admins can upgrade later
            </p>
          </div>
        )}
      </fieldset>

      {/* Allowed origins */}
      <fieldset className="space-y-2" disabled={isCreating}>
        <hr className="border-border-muted" />
        <legend className="text-xs font-medium text-foreground">
          Allowed origins
        </legend>
        <p className="text-[0.65rem] text-muted-foreground">
          Browser origins permitted to use tokens minted by this client.
          Leave empty to allow all origins.
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
            disabled={isCreating}
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
            disabled={isCreating || !originInput.trim()}
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
                  disabled={isCreating}
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

      {error && (
        <p className="text-destructive text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
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
          Create platform client
        </button>

        {onCancel && (
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
        )}
      </div>
    </form>
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
// Internal components
// ---------------------------------------------------------------------------

function FormField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
  disabled: boolean;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={cn(
          "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      />
      {hint && (
        <p className="text-[0.65rem] text-muted-foreground">{hint}</p>
      )}
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
