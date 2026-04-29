"use client";

import {
  useCallback,
  useState,
  type FormEvent,
} from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ProviderPicker } from "./ProviderPicker";
import { useCreateIdentityProvider } from "./useCreateIdentityProvider";
import { useOidcDiscovery } from "./useOidcDiscovery";
import type { ProviderPreset, ProviderConfig } from "./presets";

/** Props for {@link IdentityProviderWizard}. */
export interface IdentityProviderWizardProps {
  /** Organization slug — the IdP will be created in this org. */
  readonly org: string;
  /** Fired with the newly created identity provider on success. */
  readonly onCreated?: (idp: IdentityProvider) => void;
  /** Fired when the user cancels the wizard. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

type WizardStep = "pick" | "configure" | "review" | "success";

/**
 * Multi-step wizard for creating a new identity provider.
 *
 * Guides the user through three steps:
 *
 * 1. **Pick** — select a well-known provider preset or "Custom OIDC"
 * 2. **Configure** — fill in provider-specific variables (e.g., Auth0
 *    tenant name) plus the IdP display name and expected audience
 * 3. **Review** — verify auto-populated OIDC configuration, optionally
 *    enable SSO, and submit
 *
 * For known presets, URLs are constructed from deterministic templates
 * (no network call). For "Custom OIDC", the wizard attempts OIDC
 * Discovery and falls back to manual entry if the fetch fails.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <IdentityProviderWizard
 *   org="acme"
 *   onCreated={(idp) => { refetch(); setShowWizard(false); }}
 *   onCancel={() => setShowWizard(false)}
 * />
 * ```
 */
export function IdentityProviderWizard({
  org,
  onCreated,
  onCancel,
  className,
}: IdentityProviderWizardProps) {
  const { create, isCreating, error: createError, clearError } =
    useCreateIdentityProvider();
  const { discover, isDiscovering, error: discoveryError } =
    useOidcDiscovery();

  // Step state
  const [step, setStep] = useState<WizardStep>("pick");
  const [preset, setPreset] = useState<ProviderPreset | null>(null);

  // Configure step
  const [vars, setVars] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [audience, setAudience] = useState("");

  // Review step
  const [jwksUri, setJwksUri] = useState("");
  const [issuers, setIssuers] = useState("");
  const [userinfoEndpoint, setUserinfoEndpoint] = useState("");
  const [isSso, setIsSso] = useState(false);
  const [oidcClientId, setOidcClientId] = useState("");
  const [discoveryFailed, setDiscoveryFailed] = useState(false);

  // JIT provisioning
  const [autoProvision, setAutoProvision] = useState(false);
  const [autoGrant, setAutoGrant] = useState(false);
  const [autoGrantRole, setAutoGrantRole] = useState<IamRole>(IamRole.iam_role_unspecified);
  const [tenantOrgClaim, setTenantOrgClaim] = useState("");

  // Success step
  const [createdIdp, setCreatedIdp] = useState<IdentityProvider | null>(null);

  // -- Step transitions ------------------------------------------------

  const handlePickProvider = useCallback((selected: ProviderPreset) => {
    setPreset(selected);
    setVars(
      Object.fromEntries(selected.variables.map((v) => [v.key, v.options?.[0]?.value ?? ""])),
    );
    setName("");
    setAudience("");
    setStep("configure");
  }, []);

  const handleBackToPick = useCallback(() => {
    setStep("pick");
    setPreset(null);
  }, []);

  const populateReview = useCallback((config: ProviderConfig | null) => {
    setJwksUri(config?.jwksUri ?? "");
    setIssuers(config?.allowedIssuers.join(", ") ?? "");
    setUserinfoEndpoint(config?.userinfoEndpoint ?? "");
    setIsSso(false);
    setOidcClientId("");
    setDiscoveryFailed(!config);
  }, []);

  const handleContinueToReview = useCallback(async () => {
    if (!preset) return;

    if (preset.id === "custom") {
      const result = await discover(vars.issuerUrl ?? "");
      populateReview(
        result
          ? { ...result, allowedIssuers: [result.issuer] }
          : null,
      );
    } else {
      populateReview(preset.buildConfig(vars));
    }
    setStep("review");
  }, [preset, vars, discover, populateReview]);

  const handleBackToConfigure = useCallback(() => {
    setStep("configure");
    clearError();
  }, [clearError]);

  // -- Submit ----------------------------------------------------------

  const handleAutoProvisionChange = useCallback((v: boolean) => {
    setAutoProvision(v);
    if (!v) {
      setAutoGrant(false);
      setAutoGrantRole(IamRole.iam_role_unspecified);
      setTenantOrgClaim("");
    }
  }, []);

  const handleAutoGrantChange = useCallback((v: boolean) => {
    setAutoGrant(v);
    if (v) setAutoProvision(true);
    if (!v) {
      setAutoGrantRole(IamRole.iam_role_unspecified);
      setTenantOrgClaim("");
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      clearError();
      try {
        const idp = await create({
          name: name.trim(),
          org,
          displayName: name.trim(),
          jwksUri: jwksUri.trim(),
          allowedIssuers: issuers
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          expectedAudience: audience.trim(),
          userinfoEndpoint: userinfoEndpoint.trim() || undefined,
          ...(isSso && {
            isSsoProvider: true,
            oidcClientId: oidcClientId.trim(),
          }),
          ...(!isSso && {
            autoProvisionAccounts: autoProvision,
            autoGrantOnOrg: autoGrant,
            ...(autoGrant && autoGrantRole !== IamRole.iam_role_unspecified && {
              autoGrantRole,
            }),
            ...(autoGrant && tenantOrgClaim.trim() && {
              tenantOrgClaim: tenantOrgClaim.trim(),
            }),
          }),
        });
        setCreatedIdp(idp);
        setStep("success");
      } catch {
        // error state is managed by useCreateIdentityProvider
      }
    },
    [
      name, org, jwksUri, issuers, audience, userinfoEndpoint,
      isSso, oidcClientId, autoProvision, autoGrant, autoGrantRole,
      tenantOrgClaim, create, clearError,
    ],
  );

  // -- Render ----------------------------------------------------------

  return (
    <div className={cn("space-y-4", className)}>
      {/* Step indicator */}
      <StepIndicator current={step} />

      {step === "pick" && (
        <>
          <p className="text-muted-foreground text-xs">
            Choose your identity provider to get started. Known providers
            will have their OIDC configuration auto-populated.
          </p>
          <ProviderPicker onSelect={handlePickProvider} />
          {onCancel && (
            <div className="pt-1">
              <CancelButton onClick={onCancel} />
            </div>
          )}
        </>
      )}

      {step === "configure" && preset && (
        <ConfigureStep
          preset={preset}
          vars={vars}
          onVarChange={(key, value) =>
            setVars((prev) => ({ ...prev, [key]: value }))
          }
          name={name}
          onNameChange={setName}
          audience={audience}
          onAudienceChange={setAudience}
          isLoading={isDiscovering}
          discoveryError={discoveryError}
          onBack={handleBackToPick}
          onContinue={handleContinueToReview}
          onCancel={onCancel}
        />
      )}

      {step === "review" && (
        <ReviewStep
          discoveryFailed={discoveryFailed}
          jwksUri={jwksUri}
          onJwksUriChange={setJwksUri}
          issuers={issuers}
          onIssuersChange={setIssuers}
          userinfoEndpoint={userinfoEndpoint}
          onUserinfoEndpointChange={setUserinfoEndpoint}
          isSso={isSso}
          onIsSsoChange={setIsSso}
          oidcClientId={oidcClientId}
          onOidcClientIdChange={setOidcClientId}
          autoProvision={autoProvision}
          onAutoProvisionChange={handleAutoProvisionChange}
          autoGrant={autoGrant}
          onAutoGrantChange={handleAutoGrantChange}
          autoGrantRole={autoGrantRole}
          onAutoGrantRoleChange={setAutoGrantRole}
          tenantOrgClaim={tenantOrgClaim}
          onTenantOrgClaimChange={setTenantOrgClaim}
          isCreating={isCreating}
          createError={createError}
          onBack={handleBackToConfigure}
          onSubmit={handleSubmit}
          onCancel={onCancel}
        />
      )}

      {step === "success" && createdIdp && (
        <SuccessStep
          identityProvider={createdIdp}
          org={org}
          isSso={isSso}
          autoProvision={autoProvision}
          autoGrant={autoGrant}
          autoGrantRole={autoGrantRole}
          onDone={() => onCreated?.(createdIdp)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "pick", label: "Provider" },
  { key: "configure", label: "Configure" },
  { key: "review", label: "Review" },
  { key: "success", label: "Done" },
];

function StepIndicator({ current }: { current: WizardStep }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Wizard progress" className="flex items-center gap-1.5">
      {STEPS.map((s, i) => {
        const state =
          i < currentIdx ? "done" : i === currentIdx ? "active" : "upcoming";
        return (
          <span key={s.key} className="flex items-center gap-1.5">
            {i > 0 && (
              <span
                className={cn(
                  "h-px w-4",
                  state === "upcoming" ? "bg-border" : "bg-primary-subtle",
                )}
              />
            )}
            <span
              className={cn(
                "text-[0.65rem] font-medium",
                state === "active"
                  ? "text-primary"
                  : state === "done"
                    ? "text-muted-foreground"
                    : "text-muted-foreground-faint",
              )}
            >
              {s.label}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Configure step (step 2)
// ---------------------------------------------------------------------------

function ConfigureStep({
  preset,
  vars,
  onVarChange,
  name,
  onNameChange,
  audience,
  onAudienceChange,
  isLoading,
  discoveryError,
  onBack,
  onContinue,
  onCancel,
}: {
  preset: ProviderPreset;
  vars: Record<string, string>;
  onVarChange: (key: string, value: string) => void;
  name: string;
  onNameChange: (v: string) => void;
  audience: string;
  onAudienceChange: (v: string) => void;
  isLoading: boolean;
  discoveryError: Error | null;
  onBack: () => void;
  onContinue: () => void;
  onCancel?: () => void;
}) {
  const allVarsFilled = preset.variables.every(
    (v) => (vars[v.key] ?? "").trim() !== "",
  );
  const canContinue =
    allVarsFilled &&
    name.trim() !== "" &&
    audience.trim() !== "" &&
    !isLoading;

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">
        {preset.variables.length > 0
          ? `Enter your ${preset.label} details to auto-populate the OIDC configuration.`
          : `${preset.label} configuration is fully automatic — just provide a name and audience.`}
      </p>

      {/* Provider-specific variables */}
      {preset.variables.map((v) => (
        <FieldInput
          key={v.key}
          id={`stgm-idp-var-${v.key}`}
          label={v.label}
          value={vars[v.key] ?? ""}
          onChange={(val) => onVarChange(v.key, val)}
          placeholder={v.placeholder}
          hint={v.hint}
          disabled={isLoading}
          type={v.type}
          options={v.options}
        />
      ))}

      <hr className="border-border-muted" />

      {/* Common fields */}
      <FieldInput
        id="stgm-idp-wiz-name"
        label="Display name"
        value={name}
        onChange={onNameChange}
        placeholder="e.g., Acme Corp SSO"
        hint="Human-readable name shown in the UI"
        disabled={isLoading}
      />

      <FieldInput
        id="stgm-idp-wiz-audience"
        label="Expected audience"
        value={audience}
        onChange={onAudienceChange}
        placeholder="stigmer-api"
        hint="The aud claim value expected in JWTs from this provider"
        disabled={isLoading}
      />

      {discoveryError && (
        <p className="text-destructive text-[0.65rem]" role="alert">
          {getUserMessage(discoveryError)}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isLoading && <SpinnerIcon />}
          Continue
        </button>
        <TextButton onClick={onBack} disabled={isLoading}>
          Back
        </TextButton>
        {onCancel && (
          <CancelButton onClick={onCancel} disabled={isLoading} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review step (step 3)
// ---------------------------------------------------------------------------

function ReviewStep({
  discoveryFailed,
  jwksUri,
  onJwksUriChange,
  issuers,
  onIssuersChange,
  userinfoEndpoint,
  onUserinfoEndpointChange,
  isSso,
  onIsSsoChange,
  oidcClientId,
  onOidcClientIdChange,
  autoProvision,
  onAutoProvisionChange,
  autoGrant,
  onAutoGrantChange,
  autoGrantRole,
  onAutoGrantRoleChange,
  tenantOrgClaim,
  onTenantOrgClaimChange,
  isCreating,
  createError,
  onBack,
  onSubmit,
  onCancel,
}: {
  discoveryFailed: boolean;
  jwksUri: string;
  onJwksUriChange: (v: string) => void;
  issuers: string;
  onIssuersChange: (v: string) => void;
  userinfoEndpoint: string;
  onUserinfoEndpointChange: (v: string) => void;
  isSso: boolean;
  onIsSsoChange: (v: boolean) => void;
  oidcClientId: string;
  onOidcClientIdChange: (v: string) => void;
  autoProvision: boolean;
  onAutoProvisionChange: (v: boolean) => void;
  autoGrant: boolean;
  onAutoGrantChange: (v: boolean) => void;
  autoGrantRole: IamRole;
  onAutoGrantRoleChange: (v: IamRole) => void;
  tenantOrgClaim: string;
  onTenantOrgClaimChange: (v: string) => void;
  isCreating: boolean;
  createError: Error | null;
  onBack: () => void;
  onSubmit: (e: FormEvent) => void;
  onCancel?: () => void;
}) {
  const canSubmit =
    jwksUri.trim() !== "" &&
    issuers.trim() !== "" &&
    (!isSso || oidcClientId.trim() !== "") &&
    !isCreating;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {discoveryFailed && (
        <div
          className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning-foreground"
          role="alert"
        >
          Auto-discovery could not reach the provider. Enter the
          configuration manually below.
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Review the OIDC configuration. All fields are editable.
      </p>

      <FieldInput
        id="stgm-idp-wiz-jwks"
        label="JWKS URI"
        value={jwksUri}
        onChange={onJwksUriChange}
        placeholder="https://example.com/.well-known/jwks.json"
        disabled={isCreating}
        required
      />

      <FieldInput
        id="stgm-idp-wiz-issuers"
        label="Allowed issuers"
        value={issuers}
        onChange={onIssuersChange}
        placeholder="https://issuer.example.com/"
        hint="Comma-separated list of trusted JWT issuer values"
        disabled={isCreating}
        required
      />

      <FieldInput
        id="stgm-idp-wiz-userinfo"
        label="Userinfo endpoint"
        value={userinfoEndpoint}
        onChange={onUserinfoEndpointChange}
        placeholder="https://example.com/userinfo"
        hint="Optional — used to fetch user profile data during token exchange"
        disabled={isCreating}
      />

      {/* SSO toggle */}
      <ToggleSwitch
        checked={isSso}
        onChange={onIsSsoChange}
        label="SSO provider"
        disabled={isCreating}
      />

      {isSso && (
        <FieldInput
          id="stgm-idp-wiz-client-id"
          label="OIDC client ID"
          value={oidcClientId}
          onChange={onOidcClientIdChange}
          placeholder="public-client-id"
          hint="Client ID for the PKCE-based Authorization Code flow"
          disabled={isCreating}
          required
        />
      )}

      {/* JIT provisioning */}
      <JitProvisioningSection
        isSso={isSso}
        autoProvision={autoProvision}
        onAutoProvisionChange={onAutoProvisionChange}
        autoGrant={autoGrant}
        onAutoGrantChange={onAutoGrantChange}
        autoGrantRole={autoGrantRole}
        onAutoGrantRoleChange={onAutoGrantRoleChange}
        tenantOrgClaim={tenantOrgClaim}
        onTenantOrgClaimChange={onTenantOrgClaimChange}
        disabled={isCreating}
      />

      {createError && (
        <p className="text-destructive text-[0.65rem]" role="alert">
          {getUserMessage(createError)}
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
          Create identity provider
        </button>
        <TextButton onClick={onBack} disabled={isCreating}>
          Back
        </TextButton>
        {onCancel && (
          <CancelButton onClick={onCancel} disabled={isCreating} />
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Success step (step 4)
// ---------------------------------------------------------------------------

function SuccessStep({
  identityProvider,
  org,
  isSso,
  autoProvision,
  autoGrant,
  autoGrantRole,
  onDone,
}: {
  identityProvider: IdentityProvider;
  org: string;
  isSso: boolean;
  autoProvision: boolean;
  autoGrant: boolean;
  autoGrantRole: IamRole;
  onDone: () => void;
}) {
  const displayName =
    identityProvider.spec?.displayName ||
    identityProvider.metadata?.name ||
    "Identity provider";

  const roleName =
    autoGrantRole !== IamRole.iam_role_unspecified
      ? IamRole[autoGrantRole]
      : "viewer";

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-primary/30 bg-primary-subtle px-3 py-2.5">
        <p className="text-xs font-medium text-foreground">
          {displayName} created successfully
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">What happens next</p>

        {isSso ? (
          <p className="text-[0.65rem] text-muted-foreground">
            Users can sign in via SSO at{" "}
            <span className="font-mono text-foreground">
              /login?org={org}
            </span>
            . Accounts are auto-provisioned and granted the{" "}
            <span className="font-medium text-foreground">viewer</span> role on
            this organization.
          </p>
        ) : autoProvision && autoGrant ? (
          <p className="text-[0.65rem] text-muted-foreground">
            Users authenticating with JWTs from this provider will be
            automatically provisioned and granted the{" "}
            <span className="font-medium text-foreground">{roleName}</span> role
            on this organization. No additional setup is required.
          </p>
        ) : autoProvision ? (
          <p className="text-[0.65rem] text-muted-foreground">
            Accounts are auto-provisioned on first authentication, but no
            organization role is granted automatically. Use the Members page to
            grant access.
          </p>
        ) : (
          <p className="text-[0.65rem] text-muted-foreground">
            The trust relationship is configured. Accounts must be created
            manually before users can authenticate.
          </p>
        )}

        <p className="text-[0.65rem] text-muted-foreground">
          To verify the setup, have a user authenticate with a JWT from this
          provider and confirm they can access the organization&apos;s resources.
        </p>
      </div>

      <button
        type="button"
        onClick={onDone}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
          "bg-primary text-primary-foreground hover:bg-primary-hover",
        )}
      >
        Done
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function FieldInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled,
  required,
  type = "text",
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
  type?: "text" | "select";
  options?: readonly { readonly value: string; readonly label: string }[];
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </label>
      {type === "select" && options ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
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
      )}
      {hint && (
        <p className="text-[0.65rem] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JIT provisioning section
// ---------------------------------------------------------------------------

const JIT_ROLE_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: String(IamRole.iam_role_unspecified), label: "Default (viewer)" },
  { value: String(IamRole.viewer), label: "Viewer" },
  { value: String(IamRole.member), label: "Member" },
  { value: String(IamRole.admin), label: "Admin" },
];

function JitProvisioningSection({
  isSso,
  autoProvision,
  onAutoProvisionChange,
  autoGrant,
  onAutoGrantChange,
  autoGrantRole,
  onAutoGrantRoleChange,
  tenantOrgClaim,
  onTenantOrgClaimChange,
  disabled,
}: {
  isSso: boolean;
  autoProvision: boolean;
  onAutoProvisionChange: (v: boolean) => void;
  autoGrant: boolean;
  onAutoGrantChange: (v: boolean) => void;
  autoGrantRole: IamRole;
  onAutoGrantRoleChange: (v: IamRole) => void;
  tenantOrgClaim: string;
  onTenantOrgClaimChange: (v: string) => void;
  disabled?: boolean;
}) {
  if (isSso) {
    return (
      <div className="rounded-md border border-border-muted bg-muted-faint px-3 py-2">
        <p className="text-[0.65rem] text-muted-foreground">
          SSO providers automatically provision accounts and grant the{" "}
          <span className="font-medium text-foreground">viewer</span> role on
          the owning organization. JIT provisioning settings are not applicable.
        </p>
      </div>
    );
  }

  return (
    <fieldset className="space-y-2.5" disabled={disabled}>
      <hr className="border-border-muted" />
      <legend className="text-xs font-medium text-foreground">
        JIT provisioning
      </legend>
      <p className="text-[0.65rem] text-muted-foreground">
        Configure automatic account creation and role assignment for users
        authenticating with this provider.
      </p>

      <ToggleSwitch
        checked={autoProvision}
        onChange={onAutoProvisionChange}
        label="Auto-provision accounts"
        hint="Create a federated account automatically on first authentication"
        disabled={disabled}
      />

      <ToggleSwitch
        checked={autoGrant}
        onChange={onAutoGrantChange}
        label="Auto-grant on organization"
        hint="Grant a role on the owning organization when an account is provisioned"
        disabled={disabled || !autoProvision}
      />

      {autoGrant && (
        <>
          <FieldInput
            id="stgm-idp-wiz-grant-role"
            label="Auto-grant role"
            value={String(autoGrantRole)}
            onChange={(v) => onAutoGrantRoleChange(Number(v) as IamRole)}
            placeholder=""
            hint="Role granted automatically — org admins can upgrade later"
            disabled={disabled}
            type="select"
            options={JIT_ROLE_OPTIONS}
          />

          <FieldInput
            id="stgm-idp-wiz-tenant-claim"
            label="Tenant org claim"
            value={tenantOrgClaim}
            onChange={onTenantOrgClaimChange}
            placeholder="e.g., org_id"
            hint="JWT claim name that maps to a platform-managed organization (max 256 chars)"
            disabled={disabled}
          />
        </>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

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

function TextButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md px-2.5 py-1.5 text-xs",
        "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {children}
    </button>
  );
}

function CancelButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <TextButton onClick={onClick} disabled={disabled}>
      Cancel
    </TextButton>
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
