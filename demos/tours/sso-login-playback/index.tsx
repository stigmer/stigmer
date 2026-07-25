import type { CSSProperties, ReactNode } from "react";
import { Check, Shield } from "lucide-react";
import { BrowserView, PulseHighlight } from "@scenar/react";
import { ManagementShell } from "../_shared/ManagementShell";
import type { SsoLoginStep } from "./steps";

// BrowserView shells render slightly below 1.0 so the mockup sits comfortably
// in the docs column (ported from the in-repo demo's DEMO_BROWSER_ZOOM).
const BROWSER_ZOOM = 0.9;
// Content zoom for the management detail panel (ported from DEMO_CONTENT_ZOOM).
const CONTENT_ZOOM = 0.82;

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
// Semantic colors — fixed, do not need to theme. Emerald = success; orange is
// the external IdP's (Acme) brand color.
const EMERALD = "#10b981";
const ORANGE = "#ea580c";

const gradientPage: CSSProperties = {
  display: "flex",
  height: "100%",
  alignItems: "center",
  justifyContent: "center",
  background:
    "linear-gradient(to bottom, var(--scenar-surface), color-mix(in srgb, var(--scenar-accent) 30%, var(--scenar-surface)))",
};

// ---------------------------------------------------------------------------
// Step 1: IdP detail panel with SSO URL (ManagementShell content)
// ---------------------------------------------------------------------------

function DetailField({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <dt style={{ fontSize: "0.65rem", fontWeight: 500, color: "var(--scenar-muted-foreground)" }}>
        {label}
      </dt>
      <dd
        style={{
          margin: "0.125rem 0 0",
          wordBreak: "break-all",
          fontSize: "0.75rem",
          color: "var(--scenar-foreground)",
          fontFamily: mono ? MONO : undefined,
        }}
      >
        {value}
      </dd>
    </div>
  );
}

function IdpDetailContent() {
  return (
    <div style={{ padding: "0.75rem", zoom: CONTENT_ZOOM }}>
      {/* Header */}
      <div style={{ marginBottom: "0.75rem" }}>
        <button
          type="button"
          style={{
            marginBottom: "0.25rem",
            display: "flex",
            alignItems: "center",
            gap: "0.25rem",
            border: "none",
            background: "none",
            padding: 0,
            cursor: "pointer",
            fontSize: "0.65rem",
            color: "var(--scenar-muted-foreground)",
          }}
        >
          <svg
            width="10"
            height="10"
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
          Back to list
        </button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "var(--scenar-foreground)" }}>
              Acme SSO
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontFamily: MONO, fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>
                acme-sso
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: "9999px",
                  border: "1px solid color-mix(in srgb, var(--scenar-primary) 30%, transparent)",
                  background: "color-mix(in srgb, var(--scenar-primary) 5%, transparent)",
                  padding: "0.125rem 0.5rem",
                  fontSize: "0.6rem",
                  fontWeight: 500,
                  color: "var(--scenar-primary)",
                }}
              >
                SSO
              </span>
            </div>
          </div>
          <span
            style={{
              flexShrink: 0,
              borderRadius: "0.375rem",
              padding: "0.375rem 0.625rem",
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "var(--scenar-muted-foreground)",
            }}
          >
            Edit
          </span>
        </div>
      </div>

      {/* Fields */}
      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <DetailField label="JWKS URI" value="https://acme.us.auth0.com/.well-known/jwks.json" mono />
        <DetailField label="Allowed issuers" value="https://acme.us.auth0.com/" mono />
        <DetailField label="Expected audience" value="https://api.stigmer.ai/" mono />
        <DetailField label="OIDC client ID" value="abc123def456" mono />

        {/* SSO Login URL — copyable */}
        <div>
          <dt style={{ fontSize: "0.65rem", fontWeight: 500, color: "var(--scenar-muted-foreground)" }}>
            SSO login URL
          </dt>
          <dd style={{ margin: "0.125rem 0 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ wordBreak: "break-all", fontFamily: MONO, fontSize: "0.75rem", color: "var(--scenar-foreground)" }}>
                https://app.stigmer.ai/login?org=acme
              </span>
              <div style={{ position: "relative" }} data-cursor-target="copy-url-btn">
                <button
                  type="button"
                  style={{
                    flexShrink: 0,
                    borderRadius: "0.25rem",
                    border: "none",
                    background: "none",
                    padding: "0.125rem 0.375rem",
                    cursor: "pointer",
                    fontSize: "0.6rem",
                    color: "var(--scenar-muted-foreground)",
                  }}
                >
                  Copy
                </button>
                <PulseHighlight />
              </div>
            </div>
            <p style={{ margin: "0.125rem 0 0", fontSize: "0.65rem", color: "var(--scenar-muted-foreground)" }}>
              Share this URL with your team members to sign in via SSO
            </p>
          </dd>
        </div>

        <div style={{ display: "flex", gap: "1.5rem" }}>
          <DetailField label="Created" value="Apr 7, 2026" />
          <DetailField label="Updated" value="Apr 7, 2026" />
        </div>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: SSO login page (BrowserView)
// ---------------------------------------------------------------------------

function SsoLoginPage() {
  return (
    <div style={gradientPage}>
      <div style={{ width: "14rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              margin: "0 auto 0.375rem",
              display: "flex",
              height: "1.5rem",
              width: "1.5rem",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.5rem",
              background: "color-mix(in srgb, var(--scenar-primary) 10%, transparent)",
            }}
          >
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--scenar-primary)" }}>S</span>
          </div>
          <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "var(--scenar-foreground)" }}>
            Sign in to Stigmer
          </h3>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>
            Signing in to{" "}
            <span style={{ fontWeight: 500, color: "var(--scenar-foreground)" }}>acme</span>
          </p>
        </div>

        {/* SSO button */}
        <div style={{ position: "relative" }} data-cursor-target="sso-sign-in-btn">
          <button
            type="button"
            style={{
              display: "flex",
              width: "100%",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.375rem",
              borderRadius: "0.375rem",
              border: "none",
              background: "var(--scenar-primary)",
              padding: "0.375rem 0.75rem",
              cursor: "pointer",
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "var(--scenar-surface)",
            }}
          >
            <Shield size={12} aria-hidden />
            Sign in with Acme SSO
          </button>
          <PulseHighlight />
        </div>

        {/* Change org link */}
        <p style={{ margin: 0, textAlign: "center", fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>
          Not your organization?{" "}
          <span style={{ color: "var(--scenar-primary)" }}>Change</span>
        </p>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ height: "1px", flex: 1, background: "var(--scenar-border)" }} />
          <span style={{ fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>or</span>
          <div style={{ height: "1px", flex: 1, background: "var(--scenar-border)" }} />
        </div>

        {/* Email fallback */}
        <button
          type="button"
          style={{
            width: "100%",
            borderRadius: "0.375rem",
            border: "1px solid var(--scenar-border)",
            background: "var(--scenar-surface)",
            padding: "0.375rem 0.75rem",
            cursor: "pointer",
            textAlign: "center",
            fontSize: "0.75rem",
            fontWeight: 500,
            color: "var(--scenar-foreground)",
          }}
        >
          Sign in with email
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: External IdP login page (BrowserView)
// ---------------------------------------------------------------------------

function ExternalIdpLogin() {
  return (
    <div style={gradientPage}>
      <div
        style={{
          width: "13rem",
          borderRadius: "0.5rem",
          border: "1px solid var(--scenar-border)",
          background: "var(--scenar-card)",
          padding: "0.75rem",
          boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
        }}
      >
        <div style={{ marginBottom: "0.5rem", textAlign: "center" }}>
          <div
            style={{
              margin: "0 auto 0.25rem",
              display: "flex",
              height: "1.25rem",
              width: "1.25rem",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.375rem",
              background: "color-mix(in srgb, " + ORANGE + " 12%, transparent)",
            }}
          >
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: ORANGE }}>A</span>
          </div>
          <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "var(--scenar-foreground)" }}>
            Acme Identity
          </h3>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>
            Sign in to continue to Stigmer
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <div>
            <label style={{ fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>Email</label>
            <div
              style={{
                borderRadius: "0.375rem",
                border: "1px solid var(--scenar-border)",
                background: "var(--scenar-surface)",
                padding: "0.125rem 0.5rem",
                fontSize: "0.75rem",
                color: "var(--scenar-foreground)",
              }}
            >
              jane@acme.com
            </div>
          </div>
          <div>
            <label style={{ fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>Password</label>
            <div
              style={{
                borderRadius: "0.375rem",
                border: "1px solid var(--scenar-border)",
                background: "var(--scenar-surface)",
                padding: "0.125rem 0.5rem",
                fontSize: "0.75rem",
                color: "var(--scenar-muted-foreground)",
              }}
            >
              ••••••••••
            </div>
          </div>
          <div
            style={{
              borderRadius: "0.375rem",
              background: ORANGE,
              padding: "0.125rem 0",
              textAlign: "center",
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "#ffffff",
            }}
          >
            Sign in
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Console welcome (BrowserView)
// ---------------------------------------------------------------------------

function ConsoleRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>{label}</span>
      {children}
    </div>
  );
}

function ConsoleWelcome() {
  return (
    <div style={gradientPage}>
      <div style={{ width: "15rem", display: "flex", flexDirection: "column", gap: "0.625rem", textAlign: "center" }}>
        <div
          style={{
            margin: "0 auto",
            display: "flex",
            height: "1.75rem",
            width: "1.75rem",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "9999px",
            background: "color-mix(in srgb, " + EMERALD + " 12%, transparent)",
          }}
        >
          <Check size={16} style={{ color: EMERALD }} aria-hidden />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "var(--scenar-foreground)" }}>
            Welcome, Jane!
          </h3>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--scenar-muted-foreground)" }}>
            Authenticated via Acme SSO
          </p>
        </div>

        <div
          style={{
            borderRadius: "0.375rem",
            border: "1px solid var(--scenar-border)",
            background: "var(--scenar-accent)",
            padding: "0.5rem",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
          }}
        >
          <ConsoleRow label="Organization">
            <span style={{ fontFamily: MONO, fontSize: "0.75rem", color: "var(--scenar-foreground)" }}>acme</span>
          </ConsoleRow>
          <ConsoleRow label="Role">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: "9999px",
                background: "color-mix(in srgb, " + EMERALD + " 12%, transparent)",
                padding: "0.125rem 0.375rem",
                fontSize: "0.75rem",
                fontWeight: 500,
                color: EMERALD,
              }}
            >
              viewer
            </span>
          </ConsoleRow>
          <ConsoleRow label="Account">
            <span style={{ fontSize: "0.75rem", color: "var(--scenar-foreground)" }}>Created on first login</span>
          </ConsoleRow>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer — pure (data) -> ReactNode. The player, cursor, narration, and
// viewport are provided by the packed embed entry.
// ---------------------------------------------------------------------------

export function renderStep(data: SsoLoginStep): ReactNode {
  switch (data.view) {
    case "idp-detail":
      return (
        <ManagementShell activeNav="identity-providers" contentKey="idp-detail">
          <IdpDetailContent />
        </ManagementShell>
      );

    case "sso-login":
      return (
        <BrowserView url="app.stigmer.ai/login?org=acme" contentKey="sso-login" zoom={BROWSER_ZOOM}>
          <SsoLoginPage />
        </BrowserView>
      );

    case "idp-redirect":
      return (
        <BrowserView
          url="login.acme.com/authorize"
          contentKey="idp-redirect"
          slideDirection="forward"
          zoom={BROWSER_ZOOM}
        >
          <ExternalIdpLogin />
        </BrowserView>
      );

    case "console-welcome":
      return (
        <BrowserView
          url="app.stigmer.ai/sessions"
          contentKey="console-welcome"
          slideDirection="forward"
          zoom={BROWSER_ZOOM}
        >
          <ConsoleWelcome />
        </BrowserView>
      );
  }
}
