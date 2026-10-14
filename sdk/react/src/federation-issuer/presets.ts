/**
 * Provider presets for well-known OIDC identity providers.
 *
 * Each preset defines URL templates and required user variables for a
 * specific provider. The {@link ProviderPreset.buildConfig} function
 * constructs the full OIDC configuration from the user's input without
 * any network calls — URL patterns are deterministic for known providers.
 *
 * The "custom" preset is a special case: it collects an issuer URL and
 * delegates to OIDC Discovery for auto-population.
 */

/** OIDC configuration derived from a provider preset or discovery. */
export interface ProviderConfig {
  /** The OIDC issuer URL (e.g. `https://accounts.google.com`). */
  readonly issuer: string;
  /** URL of the JSON Web Key Set endpoint for token verification. */
  readonly jwksUri: string;
  /** Issuer URLs accepted during token validation (may include aliases). */
  readonly allowedIssuers: readonly string[];
  /** OIDC UserInfo endpoint for fetching profile claims. */
  readonly userinfoEndpoint?: string;
}

/** A user-fillable variable required by a provider preset. */
export interface ProviderVariable {
  /** Unique identifier used as the key in the collected values record. */
  readonly key: string;
  /** Human-readable label displayed next to the input field. */
  readonly label: string;
  /** Placeholder text shown inside the empty input field. */
  readonly placeholder: string;
  /** Optional helper text displayed below the input field. */
  readonly hint?: string;
  /** Input type: `"text"` for free-form input, `"select"` for a dropdown. */
  readonly type: "text" | "select";
  /** Available options when `type` is `"select"`. */
  readonly options?: readonly {
    /** Option value submitted to the config builder. */
    readonly value: string;
    /** Display label shown in the dropdown. */
    readonly label: string;
  }[];
}

/** A well-known identity provider preset with URL templates. */
export interface ProviderPreset {
  /** Stable identifier for this preset (e.g. `"auth0"`, `"okta"`, `"custom"`). */
  readonly id: string;
  /** Display name shown in the provider selection UI. */
  readonly label: string;
  /** Short description of the provider, shown below the label. */
  readonly description: string;
  /** Variables the user must fill in to construct the OIDC configuration. */
  readonly variables: readonly ProviderVariable[];
  /**
   * Build the OIDC configuration from the user's variable values.
   *
   * Returns `null` for the "custom" preset — custom providers use OIDC
   * Discovery instead of template-based construction.
   */
  readonly buildConfig: (vars: Record<string, string>) => ProviderConfig | null;
}

// ---------------------------------------------------------------------------
// Auth0
// ---------------------------------------------------------------------------

const auth0Preset: ProviderPreset = {
  id: "auth0",
  label: "Auth0",
  description: "Auth0 by Okta — universal login and identity platform",
  variables: [
    {
      key: "tenant",
      label: "Tenant name",
      placeholder: "acme-prod",
      hint: "The subdomain from your Auth0 tenant URL",
      type: "text",
    },
    {
      key: "region",
      label: "Region",
      placeholder: "us",
      type: "select",
      options: [
        { value: "us", label: "US" },
        { value: "eu", label: "EU" },
        { value: "au", label: "AU" },
        { value: "jp", label: "JP" },
      ],
    },
  ],
  buildConfig(vars) {
    const { tenant, region } = vars;
    if (!tenant || !region) return null;
    const domain = `${tenant}.${region}.auth0.com`;
    const issuer = `https://${domain}/`;
    return {
      issuer,
      jwksUri: `https://${domain}/.well-known/jwks.json`,
      allowedIssuers: [issuer],
      userinfoEndpoint: `https://${domain}/userinfo`,
    };
  },
};

// ---------------------------------------------------------------------------
// Okta
// ---------------------------------------------------------------------------

const oktaPreset: ProviderPreset = {
  id: "okta",
  label: "Okta",
  description: "Okta — enterprise identity and access management",
  variables: [
    {
      key: "domain",
      label: "Okta domain",
      placeholder: "acme.okta.com",
      hint: "Your Okta organization domain (e.g., acme.okta.com)",
      type: "text",
    },
  ],
  buildConfig(vars) {
    const { domain } = vars;
    if (!domain) return null;
    const base = `https://${domain}/oauth2/default`;
    return {
      issuer: base,
      jwksUri: `${base}/v1/keys`,
      allowedIssuers: [base],
      userinfoEndpoint: `${base}/v1/userinfo`,
    };
  },
};

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

const googlePreset: ProviderPreset = {
  id: "google",
  label: "Google",
  description: "Google Identity — Workspace and consumer accounts",
  variables: [],
  buildConfig() {
    return {
      issuer: "https://accounts.google.com",
      jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
      allowedIssuers: ["https://accounts.google.com"],
      userinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    };
  },
};

// ---------------------------------------------------------------------------
// Microsoft Entra ID (Azure AD)
// ---------------------------------------------------------------------------

const azureAdPreset: ProviderPreset = {
  id: "azure-ad",
  label: "Microsoft Entra ID",
  description: "Microsoft Entra ID (formerly Azure AD) — enterprise identity",
  variables: [
    {
      key: "tenantId",
      label: "Tenant ID",
      placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      hint: "Your Entra ID / Azure AD tenant identifier (GUID)",
      type: "text",
    },
  ],
  buildConfig(vars) {
    const { tenantId } = vars;
    if (!tenantId) return null;
    const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    return {
      issuer,
      jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
      allowedIssuers: [issuer],
      userinfoEndpoint: "https://graph.microsoft.com/oidc/userinfo",
    };
  },
};

// ---------------------------------------------------------------------------
// AWS Cognito
// ---------------------------------------------------------------------------

const cognitoPreset: ProviderPreset = {
  id: "aws-cognito",
  label: "AWS Cognito",
  description: "Amazon Cognito — user pools for AWS applications",
  variables: [
    {
      key: "region",
      label: "AWS region",
      placeholder: "us-east-1",
      hint: "The AWS region of your Cognito user pool",
      type: "text",
    },
    {
      key: "userPoolId",
      label: "User Pool ID",
      placeholder: "us-east-1_aBcDeFgHi",
      hint: "Your Cognito user pool identifier",
      type: "text",
    },
  ],
  buildConfig(vars) {
    const { region, userPoolId } = vars;
    if (!region || !userPoolId) return null;
    const base = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
    return {
      issuer: base,
      jwksUri: `${base}/.well-known/jwks.json`,
      allowedIssuers: [base],
    };
  },
};

// ---------------------------------------------------------------------------
// Custom OIDC
// ---------------------------------------------------------------------------

const customPreset: ProviderPreset = {
  id: "custom",
  label: "Custom OIDC",
  description: "Any OpenID Connect compliant identity provider",
  variables: [
    {
      key: "issuerUrl",
      label: "Issuer URL",
      placeholder: "https://idp.example.com",
      hint: "The OIDC issuer URL — configuration will be auto-discovered",
      type: "text",
    },
  ],
  buildConfig() {
    return null;
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All available provider presets in display order. */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  auth0Preset,
  oktaPreset,
  googlePreset,
  azureAdPreset,
  cognitoPreset,
  customPreset,
];

/** Look up a preset by ID. Returns `undefined` if not found. */
export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
