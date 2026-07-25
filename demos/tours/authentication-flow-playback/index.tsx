import type { CSSProperties, ReactNode } from "react";
import { Check } from "lucide-react";
import { BrowserView, TerminalView, LoginCardPage } from "@scenar/react";
import { APIExchangeView } from "../_shared/api-exchange/APIExchangeView";
import type { AuthFlowStep } from "./steps";
import {
  API_CALL_LINES,
  SUCCESS_LINES,
  ERROR_401_LINES,
  ERROR_403_LINES,
  VALIDATION_CHECKS,
  RESOLVE_CHECKS,
  RESOLVE_RESULT,
} from "./steps";

// ---------------------------------------------------------------------------
// Inline page content for the "JWT issued" browser step
// ---------------------------------------------------------------------------
// Styled with --scenar-* tokens (not Tailwind utilities) so it themes with the
// embed. The accent blue + emerald mirror APIExchangeView's semantic colors.

const ACCENT = "#3b82f6";
const EMERALD = "#10b981";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const claimRow: CSSProperties = { color: "var(--scenar-muted-foreground)" };
const claimKey: CSSProperties = { color: ACCENT };

function JwtClaim({
  name,
  children,
  indent,
  trailing,
}: {
  readonly name: string;
  readonly children: ReactNode;
  readonly indent?: boolean;
  readonly trailing?: ReactNode;
}) {
  return (
    <div style={claimRow}>
      {indent ? "  " : "{ "}
      <span style={claimKey}>&quot;{name}&quot;</span>
      {": "}
      {children}
      {trailing}
    </div>
  );
}

function AuthenticatedPage() {
  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        background:
          "linear-gradient(to bottom, var(--scenar-surface), color-mix(in srgb, var(--scenar-accent) 30%, var(--scenar-surface)))",
      }}
    >
      <div style={{ width: "14rem", textAlign: "center", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div
          style={{
            margin: "0 auto",
            display: "flex",
            height: "1.5rem",
            width: "1.5rem",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "9999px",
            background: "color-mix(in srgb, " + EMERALD + " 12%, transparent)",
          }}
        >
          <Check size={14} style={{ color: EMERALD }} aria-hidden />
        </div>

        <div>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--scenar-foreground)", margin: 0 }}>
            Welcome, Jane!
          </h3>
          <p style={{ fontSize: "0.75rem", color: "var(--scenar-muted-foreground)", margin: 0 }}>
            Authenticated via Auth0
          </p>
        </div>

        <div
          style={{
            borderRadius: "0.375rem",
            border: "1px solid var(--scenar-border)",
            background: "var(--scenar-card)",
            padding: "0.375rem",
            textAlign: "left",
          }}
        >
          <p
            style={{
              marginBottom: "0.125rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--scenar-muted-foreground)",
              marginTop: 0,
            }}
          >
            JWT Access Token
          </p>
          <div style={{ fontFamily: MONO, fontSize: "0.75rem", lineHeight: 1.5 }}>
            <JwtClaim name="iss" trailing=",">
              <span>&quot;acme.us.auth0.com&quot;</span>
            </JwtClaim>
            <JwtClaim name="sub" indent trailing=",">
              <span>&quot;auth0|jane_doe_123&quot;</span>
            </JwtClaim>
            <JwtClaim name="aud" indent trailing=",">
              <span>&quot;https://api.stigmer.ai/&quot;</span>
            </JwtClaim>
            <JwtClaim name="exp" indent trailing=" }">
              <span>1744012800</span>
            </JwtClaim>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer — pure (data) -> ReactNode. The player, cursor, narration, and
// viewport are provided by the packed embed entry.
// ---------------------------------------------------------------------------

export function renderStep(data: AuthFlowStep): ReactNode {
  switch (data.view) {
    case "browser-login":
      return (
        <BrowserView url="acme.cloud/login" contentKey="login">
          <LoginCardPage
            appName="Acme Cloud"
            subtitle="Sign in to your account"
            fields={[
              { label: "Email", value: "jane@acme.com" },
              { label: "Password", type: "password" },
            ]}
            submitLabel="Sign in"
            submitTargetId="sign-in-btn"
          />
        </BrowserView>
      );

    case "browser-jwt":
      return (
        <BrowserView
          url="acme.cloud/dashboard"
          contentKey="dashboard"
          slideDirection="forward"
        >
          <AuthenticatedPage />
        </BrowserView>
      );

    case "api-call":
      return (
        <TerminalView title="Terminal — zsh" contentKey="api-call" lines={API_CALL_LINES} />
      );

    case "validate-token":
      return (
        <APIExchangeView
          title="Stigmer API — Token Validation"
          contentKey="validate"
          request={{
            method: "POST",
            url: "/agentic/v1/sessions",
            header: "Authorization: Bearer eyJhbGciOiJSUzI1NiIs...",
          }}
          checks={VALIDATION_CHECKS}
        />
      );

    case "resolve-authorize":
      return (
        <APIExchangeView
          title="Stigmer API — Identity & Authorization"
          contentKey="resolve"
          slideDirection="forward"
          checks={RESOLVE_CHECKS}
          result={RESOLVE_RESULT}
        />
      );

    case "success-response":
      return (
        <TerminalView title="Terminal — zsh" contentKey="success" lines={SUCCESS_LINES} />
      );

    case "error-401":
      return (
        <TerminalView title="Terminal — Error Scenario" contentKey="error-401" lines={ERROR_401_LINES} />
      );

    case "error-403":
      return (
        <TerminalView
          title="Terminal — Error Scenario"
          contentKey="error-403"
          slideDirection="forward"
          lines={ERROR_403_LINES}
        />
      );
  }
}
