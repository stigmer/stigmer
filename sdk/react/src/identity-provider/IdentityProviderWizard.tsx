"use client";

import { type FormEvent, useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { EXPECTED_AUDIENCE_HINT, EXPECTED_AUDIENCE_PLACEHOLDER } from "./copy.js";
import {
  EMPTY_SIGN_IN_SETTINGS,
  SignInSettingsSection,
  signInSettingsComplete,
  toSignInInput,
  withSsoDefaults,
  type SignInSettings,
} from "./SignInSettings.js";
import { ProviderPicker } from "./ProviderPicker.js";
import { useCreateIdentityProvider } from "./useCreateIdentityProvider.js";
import { useOidcDiscovery } from "./useOidcDiscovery.js";
import type { ProviderPreset, ProviderConfig } from "./presets.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link IdentityProviderWizard}. */
export interface IdentityProviderWizardProps {
  /** Organization id — the IdP will be created in this org (a slug is also accepted). */
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
 *    enable SSO, set what a sign-in does (account creation, sign-in role,
 *    tenant org claim), and submit
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

  const [signIn, setSignIn] = useState(EMPTY_SIGN_IN_SETTINGS);

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

  const handleIsSsoChange = useCallback((next: boolean) => {
    setIsSso(next);
    setSignIn((s) => withSsoDefaults(s, next));
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
          ...toSignInInput(signIn, isSso),
        });
        setCreatedIdp(idp);
        setStep("success");
      } catch {
        // error state is managed by useCreateIdentityProvider
      }
    },
    [
      name, org, jwksUri, issuers, audience, userinfoEndpoint,
      isSso, oidcClientId, signIn, create, clearError,
    ],
  );

  // -- Render ----------------------------------------------------------

  return (
    <div className={cn("stg:space-y-4", className)}>
      {/* Step indicator */}
      <StepIndicator current={step} />

      {step === "pick" && (
        <>
          <p className="stg:text-muted-foreground stg:text-xs">
            Choose your identity provider to get started. Known providers
            will have their OIDC configuration auto-populated.
          </p>
          <ProviderPicker onSelect={handlePickProvider} />
          {onCancel && (
            <div className="stg:pt-1">
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
          onIsSsoChange={handleIsSsoChange}
          oidcClientId={oidcClientId}
          onOidcClientIdChange={setOidcClientId}
          signIn={signIn}
          onSignInChange={setSignIn}
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
          signIn={signIn}
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
    <nav aria-label="Wizard progress" className="stg:flex stg:items-center stg:gap-1.5">
      {STEPS.map((s, i) => {
        const state =
          i < currentIdx ? "done" : i === currentIdx ? "active" : "upcoming";
        return (
          <span key={s.key} className="stg:flex stg:items-center stg:gap-1.5">
            {i > 0 && (
              <span
                className={cn(
                  "stg:h-px stg:w-4",
                  state === "upcoming" ? "stg:bg-border" : "stg:bg-primary-subtle",
                )}
              />
            )}
            <span
              className={cn(
                "stg:text-[0.65rem] stg:font-medium",
                state === "active"
                  ? "stg:text-primary"
                  : state === "done"
                    ? "stg:text-muted-foreground"
                    : "stg:text-muted-foreground-faint",
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
  const baseId = useId();
  const allVarsFilled = preset.variables.every(
    (v) => (vars[v.key] ?? "").trim() !== "",
  );
  const canContinue =
    allVarsFilled &&
    name.trim() !== "" &&
    audience.trim() !== "" &&
    !isLoading;

  return (
    <div className="stg:space-y-3">
      <p className="stg:text-muted-foreground stg:text-xs">
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

      <hr className="stg:border-border-muted" />

      {/* Common fields */}
      <FieldInput
        id={`${baseId}-name`}
        label="Display name"
        value={name}
        onChange={onNameChange}
        placeholder="e.g., Acme Corp SSO"
        hint="Human-readable name shown in the UI"
        disabled={isLoading}
      />

      <FieldInput
        id={`${baseId}-audience`}
        label="Expected audience"
        value={audience}
        onChange={onAudienceChange}
        placeholder={EXPECTED_AUDIENCE_PLACEHOLDER}
        hint={EXPECTED_AUDIENCE_HINT}
        disabled={isLoading}
      />

      {discoveryError && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(discoveryError)}
        </p>
      )}

      <div className="stg:flex stg:items-center stg:gap-2 stg:pt-1">
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isLoading && <SpinnerIcon size={12} />}
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
  signIn,
  onSignInChange,
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
  signIn: SignInSettings;
  onSignInChange: (v: SignInSettings) => void;
  isCreating: boolean;
  createError: Error | null;
  onBack: () => void;
  onSubmit: (e: FormEvent) => void;
  onCancel?: () => void;
}) {
  const baseId = useId();
  const canSubmit =
    jwksUri.trim() !== "" &&
    issuers.trim() !== "" &&
    (!isSso || oidcClientId.trim() !== "") &&
    signInSettingsComplete(signIn, isSso) &&
    !isCreating;

  return (
    <form onSubmit={onSubmit} className="stg:space-y-3">
      {discoveryFailed && (
        <div
          className="stg:rounded-md stg:border stg:border-warning/30 stg:bg-warning/5 stg:px-3 stg:py-2 stg:text-xs stg:text-warning-foreground"
          role="alert"
        >
          Auto-discovery could not reach the provider. Enter the
          configuration manually below.
        </div>
      )}

      <p className="stg:text-muted-foreground stg:text-xs">
        Review the OIDC configuration. All fields are editable.
      </p>

      <FieldInput
        id={`${baseId}-jwks`}
        label="JWKS URI"
        value={jwksUri}
        onChange={onJwksUriChange}
        placeholder="https://example.com/.well-known/jwks.json"
        disabled={isCreating}
        required
      />

      <FieldInput
        id={`${baseId}-issuers`}
        label="Allowed issuers"
        value={issuers}
        onChange={onIssuersChange}
        placeholder="https://issuer.example.com/"
        hint="Comma-separated list of trusted JWT issuer values"
        disabled={isCreating}
        required
      />

      <FieldInput
        id={`${baseId}-userinfo`}
        label="Userinfo endpoint"
        value={userinfoEndpoint}
        onChange={onUserinfoEndpointChange}
        placeholder="https://example.com/userinfo"
        hint="Optional. Read only when Stigmer creates an account from a token with no email claim"
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
          id={`${baseId}-client-id`}
          label="OIDC client ID"
          value={oidcClientId}
          onChange={onOidcClientIdChange}
          placeholder="public-client-id"
          hint="Client ID for the PKCE-based Authorization Code flow"
          disabled={isCreating}
          required
        />
      )}

      <SignInSettingsSection
        isSso={isSso}
        value={signIn}
        onChange={onSignInChange}
        disabled={isCreating}
      />

      {createError && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(createError)}
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
  signIn,
  onDone,
}: {
  identityProvider: IdentityProvider;
  org: string;
  isSso: boolean;
  signIn: SignInSettings;
  onDone: () => void;
}) {
  const displayName =
    identityProvider.spec?.displayName ||
    identityProvider.metadata?.name ||
    "Identity provider";

  const createsAccounts = isSso || signIn.createAccounts;
  const grantsRole = signIn.signInRole !== IamRole.iam_role_unspecified;
  const roleName = IamRole[signIn.signInRole];
  const claim = signIn.tenantOrgClaim.trim();

  return (
    <div className="stg:space-y-4">
      <div className="stg:rounded-md stg:border stg:border-primary/30 stg:bg-primary-subtle stg:px-3 stg:py-2.5">
        <p className="stg:text-xs stg:font-medium stg:text-foreground">
          {displayName} created successfully
        </p>
      </div>

      <div className="stg:space-y-2">
        <p className="stg:text-xs stg:font-medium stg:text-foreground">What happens next</p>

        {isSso && (
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            Users can sign in via SSO at{" "}
            <span className="stg:font-mono stg:text-foreground">
              /login?org={org}
            </span>
            .
          </p>
        )}

        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          {createsAccounts
            ? "A person's first sign-in creates their account."
            : "Accounts must be created through the API before people can sign in."}{" "}
          {grantsRole ? (
            <>
              The first time someone signs in to the organization, they receive
              the{" "}
              <span className="stg:font-medium stg:text-foreground">{roleName}</span>{" "}
              role there.
            </>
          ) : (
            "No role is granted on sign-in: use the Members page to grant access."
          )}
        </p>

        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          {claim ? (
            <>
              Each token is bound to the organization its{" "}
              <span className="stg:font-mono stg:text-foreground">{claim}</span>{" "}
              claim names, and works there only.
            </>
          ) : (
            "Tokens from this provider work in this organization only."
          )}
        </p>

        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          To verify the setup, have a user authenticate with a JWT from this
          provider and confirm they can access the organization&apos;s resources.
        </p>
      </div>

      <button
        type="button"
        onClick={onDone}
        className={cn(
          "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
          "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
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
    <div className="stg:space-y-1">
      <label htmlFor={id} className="stg:text-xs stg:font-medium stg:text-foreground">
        {label}
      </label>
      {type === "select" && options ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        />
      )}
      {hint && (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">{hint}</p>
      )}
    </div>
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
        "stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs",
        "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
        "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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

