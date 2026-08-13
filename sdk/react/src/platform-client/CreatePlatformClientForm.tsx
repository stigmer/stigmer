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
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

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
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
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
      <fieldset className="stg:space-y-2" disabled={isCreating}>
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">
          Expiry
        </legend>
        <ToggleSwitch
          checked={neverExpires}
          onChange={setNeverExpires}
          label="Never expires"
          disabled={isCreating}
        />
        {!neverExpires && (
          <div className="stg:space-y-1">
            <label
              htmlFor="stgm-pc-expires-at"
              className="stg:text-xs stg:font-medium stg:text-foreground"
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
                "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
                "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              )}
            />
          </div>
        )}
      </fieldset>

      {/* JIT provisioning */}
      <fieldset className="stg:space-y-2.5" disabled={isCreating}>
        <hr className="stg:border-border-muted" />
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">
          JIT provisioning
        </legend>
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
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
          <div className="stg:space-y-1">
            <label
              htmlFor="stgm-pc-grant-role"
              className="stg:text-xs stg:font-medium stg:text-foreground"
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
            <p className="stg:text-[0.65rem] stg:text-muted-foreground">
              Role granted automatically — org admins can upgrade later
            </p>
          </div>
        )}
      </fieldset>

      {/* Allowed origins */}
      <fieldset className="stg:space-y-2" disabled={isCreating}>
        <hr className="stg:border-border-muted" />
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">
          Allowed origins
        </legend>
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          Browser origins permitted to use tokens minted by this client.
          Leave empty to allow all origins.
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
            disabled={isCreating}
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
            disabled={isCreating || !originInput.trim()}
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
                  disabled={isCreating}
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

      {error && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="stg:flex stg:items-center stg:gap-2 stg:pt-1">
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
          Create platform client
        </button>

        {onCancel && (
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
    <div className="stg:space-y-1">
      <label htmlFor={id} className="stg:text-xs stg:font-medium stg:text-foreground">
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
          "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
          "stg:placeholder:text-muted-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        )}
      />
      {hint && (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">{hint}</p>
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

